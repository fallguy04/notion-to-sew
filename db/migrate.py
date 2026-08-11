"""Sheets -> Postgres migration.

Runs in two modes:

    python db/migrate.py            # dry run: transform + reconcile, touches nothing
    python db/migrate.py --load     # dry run, then load into $DATABASE_URL

The dry run is the point. It does every transform, resolves every foreign-key
violation, and reconciles totals against the spreadsheet. If the report is clean,
the load is a formality; if it isn't, nothing has been written yet.
"""
import os
import re
import sys
import json
import collections
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP

import tomli
import gspread
from google.oauth2.service_account import Credentials

SECRETS = os.path.join(os.path.dirname(__file__), "..", ".streamlit", "secrets.toml")

PAYMENT = {
    "cash": "cash", "check": "check", "card": "card", "venmo": "venmo",
    "invoice (pay later)": "invoice", "pay later (invoice)": "invoice",  # same thing, typed two ways
}
STATUS = {"paid": "paid", "pending": "pending", "void": "void",
          "unpaid": "pending", "open": "pending"}

NON_PRODUCT_SKUS = {"FREIGHT", "GIFT-CERT", ""}


def money(v):
    try:
        return Decimal(str(v).strip() or 0).quantize(Decimal("0.01"), ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def as_int(v):
    try:
        return int(float(str(v).strip() or 0))
    except Exception:
        return 0


def truthy(v):
    return str(v).strip().upper() in ("TRUE", "1", "YES")


def connect():
    with open(SECRETS, "rb") as f:
        sa = tomli.load(f)["gcp_service_account"]
    gc = gspread.authorize(Credentials.from_service_account_info(
        sa, scopes=["https://www.googleapis.com/auth/spreadsheets",
                    "https://www.googleapis.com/auth/drive"]))
    return gc.open("NotionToSew_DB")


def extract(sh):
    def rows(tab):
        return [r for r in sh.worksheet(tab).get_all_values()[1:]
                if r and any(c.strip() for c in r)]
    return {t: rows(t) for t in
            ("Inventory", "Transactions", "TransactionItems", "Customers",
             "Vendors", "Expenses", "Settings")}


def transform(raw):
    out, notes = {}, []

    # -- customers ----------------------------------------------------------
    customers, seen = [], set()
    for r in raw["Customers"]:
        cid = r[0].strip()
        if not cid or cid in seen:
            notes.append(f"customer row skipped (blank or duplicate id): {r[:2]}")
            continue
        seen.add(cid)
        g = lambda i: r[i].strip() if len(r) > i else ""
        rate = g(9)
        customers.append(dict(
            id=cid, name=g(1), email=g(2) or None, phone=g(3) or None,
            joined_on=g(4) or None, address=g(5) or None, notes=g(6) or None,
            credit=money(g(7)), is_wholesale=truthy(g(8)),
            tax_rate=(Decimal(rate) if re.fullmatch(r"0?\.\d+", rate) else None),
        ))
    out["customers"] = customers
    known_cust = seen

    # -- products -----------------------------------------------------------
    products, pseen = [], set()
    for r in raw["Inventory"]:
        sku = r[0].strip()
        if not sku or sku in pseen:
            notes.append(f"product row skipped (blank or duplicate sku): {r[:2]}")
            continue
        pseen.add(sku)
        g = lambda i: r[i].strip() if len(r) > i else ""
        products.append(dict(
            sku=sku, name=g(1) or sku, price=money(g(2)), stock_qty=as_int(g(3)),
            vendor=g(4) or None, category=g(5) or None,
            wholesale_price=(money(g(6)) if g(6) else None),
            cost=(money(g(7)) if g(7) else None),
            active=(g(8).upper() != "FALSE"),
        ))

    # 1,056 line items point at 264 SKUs that no longer exist in Inventory.
    # Their names survive on the line items, so rebuild them as inactive
    # products rather than dropping the FK or losing the history.
    line_names = {}
    for r in raw["TransactionItems"]:
        sku = r[1].strip() if len(r) > 1 else ""
        if sku and sku not in NON_PRODUCT_SKUS and sku not in pseen:
            line_names.setdefault(sku, collections.Counter())[
                (r[4].strip() if len(r) > 4 else "") or sku] += 1
    for sku, names in line_names.items():
        products.append(dict(
            sku=sku, name=names.most_common(1)[0][0], price=Decimal("0.00"),
            stock_qty=0, vendor=None, category="Discontinued",
            wholesale_price=None, cost=None, active=False,
        ))
    notes.append(f"recreated {len(line_names)} discontinued products from line-item names")
    out["products"] = products
    known_sku = pseen | set(line_names)

    # -- invoices -----------------------------------------------------------
    invoices, iseen = [], set()
    for r in raw["Transactions"]:
        iid = r[0].strip()
        if not iid or iid in iseen:
            notes.append(f"invoice skipped (blank or duplicate id): {iid!r}")
            continue
        iseen.add(iid)
        g = lambda i: r[i].strip() if len(r) > i else ""
        cust = g(4)
        if cust in ("", "Guest") or cust not in known_cust:
            if cust and cust != "Guest":
                notes.append(f"invoice {iid}: customer {cust} does not exist -> walk-in (NULL)")
            cust = None
        status = STATUS.get(g(5).lower(), "pending")
        pay_raw = g(3).lower()
        pay = PAYMENT.get(pay_raw)
        if pay is None and pay_raw:
            pay = PAYMENT.get(pay_raw.split(" (")[0], None)   # "Check (+$5 Credit)"
            if pay is None:
                notes.append(f"invoice {iid}: unmapped payment {g(3)!r} -> NULL")
        sold = g(1)
        invoices.append(dict(
            id=int(iid) if iid.isdigit() else None, raw_id=iid,
            customer_id=cust, status=status, payment=pay,
            total=money(g(2)), tax=money(g(7)),
            is_wholesale=truthy(g(8)), due_date=g(6)[:10] or None,
            sold_at=sold, paid_at=(sold if status == "paid" else None),
            credit_applied=Decimal("0.00"), discount=Decimal("0.00"), note=None,
        ))
    out["invoices"] = [i for i in invoices if i["id"] is not None]
    dropped = [i["raw_id"] for i in invoices if i["id"] is None]
    if dropped:
        notes.append(f"{len(dropped)} invoices have non-numeric ids: {dropped[:5]}")

    # -- invoice lines ------------------------------------------------------
    # Store credit was sometimes entered as a negative line item instead of in
    # the credit field. On invoice 80 that pushed the recorded total to -$1.36,
    # which no sane schema should accept. Move those amounts into
    # credit_applied where they belong and floor the total at zero, recording a
    # note on the invoice so the adjustment is auditable rather than silent.
    credit_lines = collections.defaultdict(Decimal)
    discount_lines = collections.defaultdict(Decimal)
    for r in raw["TransactionItems"]:
        iid = r[0].strip()
        if not iid.isdigit():
            continue
        price = money(r[3] if len(r) > 3 else 0)
        desc = (r[4].strip() if len(r) > 4 else "").lower()
        if price < 0:
            amount = abs(price * Decimal(r[2] or 1))
            if "credit" in desc:
                credit_lines[int(iid)] += amount
            else:
                discount_lines[int(iid)] += amount   # "Discount", "40% Off Discount", ...

    by_id = {i["id"]: i for i in out["invoices"]}
    for iid, amt in discount_lines.items():
        if iid in by_id:
            by_id[iid]["discount"] = amt
    notes.append(f"moved {len(discount_lines)} negative discount lines into invoices.discount "
                 f"(${sum(discount_lines.values())})")
    for iid, amt in credit_lines.items():
        inv = by_id.get(iid)
        if not inv:
            continue
        inv["credit_applied"] = amt
        original = inv["total"]
        if original < 0:
            inv["total"] = Decimal("0.00")
            inv["note"] = (f"migration: recorded total was {original}; store credit of "
                           f"{amt} had been entered as a negative line item")
            notes.append(f"invoice {iid}: total {original} -> 0.00, ${amt} moved to credit_applied")

    valid_inv = {i["id"] for i in out["invoices"]}
    lines = []
    for r in raw["TransactionItems"]:
        iid = r[0].strip()
        if not iid.isdigit() or int(iid) not in valid_inv:
            notes.append(f"line skipped, no such invoice: {iid!r}")
            continue
        g = lambda i: r[i].strip() if len(r) > i else ""
        sku = g(1)
        qty = Decimal(g(2) or 0)
        if money(g(3)) < 0:
            continue        # moved into invoices.credit_applied / .discount above
        if qty == 0:
            notes.append(f"line skipped, qty 0 on invoice {iid}")
            continue
        lines.append(dict(
            invoice_id=int(iid),
            sku=(sku if sku in known_sku and sku not in NON_PRODUCT_SKUS else None),
            description=g(4) or sku or "Item",
            qty=qty, unit_price=money(g(3)),
        ))
    out["invoice_lines"] = lines

    # -- vendors / expenses / settings --------------------------------------
    out["vendors"] = [dict(id=r[0].strip(), name=(r[1].strip() if len(r) > 1 else "") or r[0].strip(),
                           contact=(r[2].strip() if len(r) > 2 else None) or None,
                           phone=(r[3].strip() if len(r) > 3 else None) or None,
                           email=(r[4].strip() if len(r) > 4 else None) or None,
                           address=(r[5].strip() if len(r) > 5 else None) or None)
                      for r in raw["Vendors"] if r[0].strip()]
    out["expenses"] = [dict(spent_on=r[0].strip(), category=(r[1].strip() if len(r) > 1 else "Other") or "Other",
                            amount=money(r[2] if len(r) > 2 else 0),
                            description=(r[3].strip() if len(r) > 3 else None) or None)
                       for r in raw["Expenses"] if r and r[0].strip()]
    out["settings"] = [dict(key=r[0].strip(), value=(r[1].strip() if len(r) > 1 else ""))
                       for r in raw["Settings"] if r[0].strip()]
    return out, notes


def reconcile(raw, out):
    """Everything that must be true before this is allowed near a database."""
    checks = []

    def check(label, ok, detail=""):
        checks.append((ok, label, detail))

    sheet_inv = [r for r in raw["Transactions"] if r[0].strip()]
    check("every invoice migrated",
          len(out["invoices"]) == len(sheet_inv),
          f"{len(out['invoices'])} of {len(sheet_inv)}")

    sheet_total = sum(money(r[2]) for r in sheet_inv if r[5].strip().lower() == "paid")
    pg_total = sum(i["total"] for i in out["invoices"] if i["status"] == "paid")
    # Every deviation must be an adjustment we chose and recorded on the invoice,
    # never unexplained drift.
    adjust = sum(money(i["total"]) - money(next(
        (r[2] for r in sheet_inv if r[0].strip() == str(i["id"])), 0))
        for i in out["invoices"] if i.get("note"))
    check("paid revenue matches, net of recorded adjustments",
          sheet_total + adjust == pg_total,
          f"sheet ${sheet_total:,} + ${adjust} adjustment = ${sheet_total + adjust:,} "
          f"vs migrated ${pg_total:,}")

    sheet_lines = [r for r in raw["TransactionItems"] if r[0].strip()]
    relocated = sum(1 for r in raw["TransactionItems"]
                    if len(r) > 3 and money(r[3]) < 0)
    check("every line item migrated or relocated to credit_applied",
          len(out["invoice_lines"]) + relocated == len(sheet_lines),
          f"{len(out['invoice_lines'])} lines + {relocated} relocated of {len(sheet_lines)}")

    ids = [i["id"] for i in out["invoices"]]
    check("invoice ids unique", len(ids) == len(set(ids)), f"{len(ids)} ids")
    cids = [c["id"] for c in out["customers"]]
    check("customer ids unique", len(cids) == len(set(cids)), f"{len(cids)} ids")
    skus = [p["sku"] for p in out["products"]]
    check("skus unique", len(skus) == len(set(skus)), f"{len(skus)} skus")

    known_cust = {c["id"] for c in out["customers"]}
    bad = [i["id"] for i in out["invoices"] if i["customer_id"] and i["customer_id"] not in known_cust]
    check("no invoice points at a missing customer", not bad, str(bad[:5]))

    known_sku = {p["sku"] for p in out["products"]}
    bad = [l["invoice_id"] for l in out["invoice_lines"] if l["sku"] and l["sku"] not in known_sku]
    check("no line points at a missing product", not bad, str(bad[:5]))

    valid_inv = {i["id"] for i in out["invoices"]}
    bad = [l["invoice_id"] for l in out["invoice_lines"] if l["invoice_id"] not in valid_inv]
    check("no line points at a missing invoice", not bad, str(bad[:5]))

    check("all paid invoices have a paid_at (CHECK constraint)",
          all(i["paid_at"] for i in out["invoices"] if i["status"] == "paid"))
    check("no negative money",
          all(i["total"] >= 0 and i["tax"] >= 0 for i in out["invoices"]))
    check("no negative line prices (CHECK constraint)",
          all(l["unit_price"] >= 0 for l in out["invoice_lines"]))
    check("no negative customer credit (CHECK constraint)",
          all(c["credit"] >= 0 for c in out["customers"]))

    max_id = max(ids) if ids else 0
    check("invoice sequence starts above every existing id", max_id < 10200,
          f"highest existing {max_id}, sequence starts 10200")
    return checks


def main():
    sh = connect()
    print("reading spreadsheet...")
    raw = extract(sh)
    out, notes = transform(raw)

    print("\n=== TRANSFORM ===")
    for t, rows in out.items():
        print(f"  {t:<16} {len(rows):>6} rows")

    print("\n=== NOTES ===")
    for n in collections.Counter(
            re.sub(r"\d+", "N", x) if x.startswith(("line skipped", "invoice skipped")) else x
            for n_ in [notes] for x in n_).most_common():
        print(f"  {n[1]:>4}x  {n[0]}" if n[1] > 1 else f"        {n[0]}")

    print("\n=== RECONCILIATION ===")
    checks = reconcile(raw, out)
    for ok, label, detail in checks:
        print(f"  {'PASS' if ok else 'FAIL'}  {label}" + (f"  ({detail})" if detail else ""))
    failed = [c for c in checks if not c[0]]

    art = os.path.join(os.path.dirname(__file__), "migration_payload.json")
    with open(art, "w") as f:
        json.dump(out, f, default=str, indent=1)
    print(f"\npayload written to {art}")

    if failed:
        print(f"\n{len(failed)} check(s) FAILED — not safe to load.")
        sys.exit(1)
    print("\nAll checks passed. Safe to load with --load once DATABASE_URL is set.")

    if "--load" in sys.argv:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from load import load          # noqa: separate module, only imported when loading
        print("\n=== LOAD ===")
        load(out)


if __name__ == "__main__":
    main()

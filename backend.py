"""Storage layer — Postgres.

Replaces the Google Sheets backend. Every public function keeps the signature it
had before, and get_data() returns DataFrames with the same column names the UI
already uses, so Home.py and Kiosk.py need no changes at all. The old
implementation is kept in backend_sheets_legacy.py as a rollback path.

What actually changes, beneath identical signatures:
  - a sale is one transaction (record_sale) instead of five sequential writes
  - invoice numbers come from a sequence, not a counter cell
  - duplicate ids, negative credit and orphan rows are refused by the engine
  - reads are indexed queries rather than downloading whole worksheets
"""
import os
import pathlib
from datetime import datetime, timedelta

import pandas as pd
import psycopg
import pytz
import streamlit as st

# Document generation is storage-agnostic; re-exported so `db.create_pdf(...)`
# keeps working for callers that already import it from here.
from documents import (  # noqa: F401
    create_pdf, send_receipt_email, generate_income_statement_pdf,
)

TZ = pytz.timezone("America/Los_Angeles")


# --- CONNECTIVITY ------------------------------------------------------------

def _database_url() -> str:
    """Streamlit Cloud secrets first, then the local .env.local."""
    try:
        url = st.secrets.get("database_url")
        if url:
            return url
    except Exception:
        pass
    if os.environ.get("DATABASE_URL"):
        return os.environ["DATABASE_URL"]
    env = pathlib.Path(__file__).parent / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise RuntimeError("No database_url in secrets, DATABASE_URL or .env.local")


@st.cache_resource
def get_pool():
    from psycopg_pool import ConnectionPool
    # Neon's pooled endpoint handles server-side pooling; this keeps a small
    # client-side pool so a rerun doesn't pay TLS setup every time.
    return ConnectionPool(_database_url(), min_size=1, max_size=4,
                          kwargs={"autocommit": False}, open=True)


def _q(sql, params=None):
    """Read query -> DataFrame."""
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            cols = [d.name for d in cur.description]
            return pd.DataFrame(cur.fetchall(), columns=cols)


def _x(sql, params=None, fetch=False):
    """Write statement, committed."""
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            out = cur.fetchone() if fetch else None
        conn.commit()
        return out


# --- READS -------------------------------------------------------------------
# Column names below deliberately match the old spreadsheet headers. The UI
# indexes DataFrames by those names in dozens of places; renaming them here
# would be a rewrite of Home.py for no benefit.

@st.cache_data(ttl=600)
def _read(table: str) -> pd.DataFrame:
    if table == "inventory":
        return _q("""
            SELECT sku AS "SKU", name AS "Name", price AS "Price",
                   stock_qty AS "StockQty", vendor AS "Vendor", category AS "Category",
                   wholesale_price AS "WholesalePrice", cost AS "Cost",
                   active AS "Active"
              FROM products ORDER BY sku""")
    if table == "transactions":
        return _q("""
            SELECT id AS "TransactionID",
                   to_char(sold_at AT TIME ZONE 'America/Los_Angeles',
                           'YYYY-MM-DD HH24:MI:SS') AS "Timestamp",
                   total AS "TotalAmount",
                   initcap(payment::text) AS "PaymentMethod",
                   COALESCE(customer_id, 'Guest') AS "CustomerID",
                   initcap(status::text) AS "Status",
                   to_char(due_date, 'YYYY-MM-DD') AS "DueDate",
                   tax AS "TaxAmount",
                   CASE WHEN is_wholesale THEN 'TRUE' ELSE 'FALSE' END AS "IsWholesale"
              FROM invoices ORDER BY sold_at""")
    if table == "items":
        return _q("""
            SELECT invoice_id AS "TransactionID", COALESCE(sku, '') AS "SKU",
                   qty AS "QtySold", unit_price AS "Price", description AS "Name"
              FROM invoice_lines ORDER BY invoice_id, id""")
    if table == "customers":
        return _q("""
            SELECT id AS "CustomerID", name AS "Name", COALESCE(email,'') AS "Email",
                   COALESCE(phone,'') AS "Phone",
                   COALESCE(to_char(joined_on,'YYYY-MM-DD'),'') AS "Joined",
                   COALESCE(address,'') AS "Address", COALESCE(notes,'') AS "Notes",
                   credit AS "Credit",
                   CASE WHEN is_wholesale THEN 'TRUE' ELSE 'FALSE' END AS "IsWholesale",
                   COALESCE(tax_rate::text,'') AS "TaxRate"
              FROM customers ORDER BY name""")
    if table == "settings":
        return _q('SELECT key AS "Key", value AS "Value" FROM settings ORDER BY key')
    if table == "expenses":
        return _q("""
            SELECT to_char(spent_on,'YYYY-MM-DD') AS "Date", category AS "Category",
                   amount AS "Amount", COALESCE(description,'') AS "Description"
              FROM expenses ORDER BY spent_on DESC""")
    raise ValueError(table)


def get_data():
    """All tables, each cached independently."""
    try:
        return {k: _read(k) for k in
                ("inventory", "transactions", "items", "customers", "settings", "expenses")}
    except Exception as e:
        st.error(f"🚨 Database Error: {e}")
        return {}


# Tab names are accepted for source compatibility with the Sheets backend, whose
# callers pass things like force_refresh("Customers").
_TAB_TO_TABLE = {
    "Inventory": "inventory", "Transactions": "transactions",
    "TransactionItems": "items", "Customers": "customers",
    "Settings": "settings", "Expenses": "expenses",
}


def force_refresh(*tabs):
    if tabs:
        for t in tabs:
            key = _TAB_TO_TABLE.get(t, t)
            try:
                _read.clear(key)
            except Exception:
                _read.clear()
    else:
        _read.clear()
    return True


def check_integrity():
    """Kept so the admin banner still works. The constraints now make all three
    of these impossible, so a non-empty result means something bypassed the app
    and went at the database directly."""
    problems = []
    try:
        dupes = _q("""
            SELECT 'CustomerID' AS kind, id AS val, count(*) FROM customers GROUP BY 1,2 HAVING count(*)>1
            UNION ALL
            SELECT 'SKU', sku, count(*) FROM products GROUP BY 1,2 HAVING count(*)>1""")
        for _, r in dupes.iterrows():
            problems.append(f"{r['kind']} **{r['val']}** appears {r['count']} times.")
        # Negative stock is deliberately NOT reported here. It belongs in the
        # reorder view as a stock-accuracy problem, not in a corruption banner —
        # and a banner that is always on is a banner nobody reads.
    except Exception:
        return []
    return problems


def get_settings_dict():
    df = _read("settings")
    return {} if df.empty else dict(zip(df["Key"], df["Value"]))


def get_tax_rate() -> float:
    raw = get_settings_dict().get("TaxRate", "0.08")
    try:
        val = float(str(raw).replace("%", "").strip())
        return val / 100 if val > 1 else val
    except Exception:
        return 0.0


# --- WRITES ------------------------------------------------------------------

def add_customer(name, email, is_wholesale=False):
    row = _x("""INSERT INTO customers (id, name, email, joined_on, is_wholesale)
                VALUES ('C-' || substr(md5(random()::text), 1, 8), %s, NULLIF(%s,''),
                        current_date, %s)
                RETURNING id""",
             (name, email or "", bool(is_wholesale)), fetch=True)
    force_refresh("Customers")
    return row[0]


def add_inventory_item(sku, name, price, stock, wholesale_price, cost):
    _x("""INSERT INTO products (sku, name, price, stock_qty, wholesale_price, cost)
          VALUES (%s,%s,%s,%s,NULLIF(%s,0)::numeric,NULLIF(%s,0)::numeric)""",
       (str(sku).strip(), name, price or 0, int(stock or 0),
        wholesale_price or 0, cost or 0))
    return force_refresh("Inventory")


def restock_item(sku, qty_to_add, new_cost=None):
    try:
        with get_pool().connection() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE products SET stock_qty = stock_qty + %s WHERE sku = %s",
                            (int(qty_to_add), str(sku).strip()))
                if cur.rowcount == 0:
                    return False              # unknown SKU: report it, don't invent a product
                if new_cost is not None:
                    cur.execute("UPDATE products SET cost=%s WHERE sku=%s",
                                (new_cost, str(sku).strip()))
                cur.execute("""INSERT INTO stock_moves (sku, delta, reason, note)
                               VALUES (%s,%s,'restock','restocked from the admin portal')""",
                            (str(sku).strip(), int(qty_to_add)))
            conn.commit()
        return force_refresh("Inventory")
    except Exception:
        return False


def update_inventory_batch(df_changes):
    if df_changes is None or df_changes.empty:
        return False
    try:
        with get_pool().connection() as conn:
            with conn.cursor() as cur:
                for _, r in df_changes.iterrows():
                    sku = str(r.get("SKU", "")).strip()
                    if not sku:
                        continue
                    cur.execute("""
                        UPDATE products SET name=%s, price=%s, stock_qty=%s,
                               wholesale_price=NULLIF(%s,0)::numeric,
                               cost=NULLIF(%s,0)::numeric, active=%s
                         WHERE sku=%s""",
                        (r.get("Name") or sku, float(r.get("Price") or 0),
                         int(float(r.get("StockQty") or 0)),
                         float(r.get("WholesalePrice") or 0), float(r.get("Cost") or 0),
                         str(r.get("Active", True)).strip().lower() not in
                         ("false", "0", "no", ""), sku))
            conn.commit()
        return force_refresh("Inventory")
    except Exception:
        return False


_PAYMENT = {"cash": "cash", "check": "check", "card": "card", "venmo": "venmo",
            "invoice (pay later)": "invoice", "pay later (invoice)": "invoice"}


def commit_sale(cart, total, tax, cust_id, payment_method, is_wholesale,
                status="Paid", credit_used=0.0):
    """One transaction. Either the invoice, its lines and the stock movement all
    land, or none of them do — which is what the old reserve-the-number-first
    flow could not promise, and why six sales were lost."""
    import json
    lines = [{"sku": (str(i["sku"]).strip() or None),
              "description": i.get("name") or str(i["sku"]),
              "qty": float(i["qty"]), "unit_price": float(i["price"])} for i in cart]
    pay = _PAYMENT.get(str(payment_method).split(" (+")[0].strip().lower())
    row = _x("SELECT record_sale(%s, %s::jsonb, %s::payment_method, %s::invoice_status,"
             "                   0, 0, %s, %s, %s)",
             (cust_id if cust_id and cust_id != "Guest" else None,
              json.dumps(lines), pay, str(status).strip().lower(),
              float(tax or 0), float(credit_used or 0), bool(is_wholesale)),
             fetch=True)
    invoice_id = row[0]
    if str(status).strip().lower() == "pending":
        days = 30 if is_wholesale else 0
        _x("UPDATE invoices SET due_date = (sold_at + %s)::date WHERE id = %s",
           (timedelta(days=days), invoice_id))
    force_refresh("Transactions", "TransactionItems", "Inventory", "Customers")
    return str(invoice_id)


def record_freight(invoice_id, amount):
    _x("""INSERT INTO invoice_lines (invoice_id, sku, description, qty, unit_price)
          VALUES (%s, NULL, 'Shipping', 1, %s)""", (int(invoice_id), round(float(amount), 2)))
    _x("UPDATE invoices SET freight=%s, total=total+%s WHERE id=%s",
       (round(float(amount), 2), round(float(amount), 2), int(invoice_id)))
    return force_refresh("Transactions", "TransactionItems")


def mark_invoice_paid(invoice_id):
    try:
        out = _x("UPDATE invoices SET status='paid', paid_at=COALESCE(paid_at, now()) "
                 "WHERE id=%s RETURNING id", (int(invoice_id),), fetch=True)
        if out is None:
            return False
        return force_refresh("Transactions")
    except Exception:
        return False


def delete_invoice(invoice_id):
    try:
        # ON DELETE CASCADE removes the lines; no loop, nothing left behind.
        _x("DELETE FROM invoices WHERE id=%s", (int(invoice_id),))
        return force_refresh("Transactions", "TransactionItems")
    except Exception:
        return False


def update_customer_details(cust_id, new_name, address, phone, notes,
                            is_wholesale=None, tax_rate_override=None):
    try:
        out = _x("""UPDATE customers SET name=%s, address=NULLIF(%s,''),
                           phone=NULLIF(%s,''), notes=NULLIF(%s,''),
                           is_wholesale=COALESCE(%s, is_wholesale),
                           tax_rate=%s
                     WHERE id=%s RETURNING id""",
                 (new_name, address or "", phone or "", notes or "",
                  is_wholesale, tax_rate_override, cust_id), fetch=True)
        if out is None:
            return False
        return force_refresh("Customers")
    except Exception:
        return False


def delete_customer(cust_id):
    try:
        # ON DELETE RESTRICT: a customer with invoices cannot be silently removed.
        out = _x("DELETE FROM customers WHERE id=%s RETURNING id", (cust_id,), fetch=True)
        if out is None:
            return False
        return force_refresh("Customers")
    except Exception:
        return False


def sell_gift_certificate(giver_id, receiver_id, amount, pay_method):
    import json
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT name FROM customers WHERE id=%s", (receiver_id,))
            got = cur.fetchone()
            receiver = got[0] if got else "Unknown"
            cur.execute(
                "SELECT record_sale(%s, %s::jsonb, %s::payment_method, 'paid', 0,0,0,0,false)",
                (giver_id, json.dumps([{"sku": None,
                                        "description": f"Gift Certificate for {receiver}",
                                        "qty": 1, "unit_price": float(amount)}]),
                 _PAYMENT.get(str(pay_method).strip().lower(), "cash")))
            invoice_id = cur.fetchone()[0]
            cur.execute("UPDATE customers SET credit = credit + %s WHERE id=%s",
                        (round(float(amount), 2), receiver_id))
        conn.commit()
    force_refresh("Transactions", "TransactionItems", "Customers")
    return str(invoice_id)


def update_settings(updates_dict):
    with get_pool().connection() as conn:
        with conn.cursor() as cur:
            for k, v in updates_dict.items():
                cur.execute("""INSERT INTO settings (key, value) VALUES (%s,%s)
                               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value""",
                            (k, str(v)))
        conn.commit()
    return force_refresh("Settings")


def add_expense(date, category, amount, description):
    _x("INSERT INTO expenses (spent_on, category, amount, description) VALUES (%s,%s,%s,%s)",
       (str(date)[:10], category, round(float(amount), 2), description or None))
    return force_refresh("Expenses")

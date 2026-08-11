"""Loads a transformed payload into Postgres, in one transaction.

Imported by migrate.py --load. Kept separate so the dry run never needs a
database driver installed.
"""
import os
import pathlib

import psycopg


def _url():
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    env = pathlib.Path(__file__).parent.parent / ".env.local"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")
    raise SystemExit("DATABASE_URL not set and .env.local has no value")


def _rows(items, cols):
    return [tuple(i.get(c) for c in cols) for i in items]


def load(out, schema_path=None):
    url = _url()
    schema = pathlib.Path(schema_path or (pathlib.Path(__file__).parent / "schema.sql"))

    with psycopg.connect(url) as conn:
        # Historic timestamps are naive strings written by an app pinned to
        # Pacific. Interpreting them in that zone keeps sale times honest
        # instead of silently shifting the whole ledger by 7-8 hours.
        conn.execute("SET TIME ZONE 'America/Los_Angeles'")

        with conn.cursor() as cur:
            # Idempotent: a re-run rebuilds from scratch. DDL is transactional
            # in Postgres, so a failure anywhere below leaves the database
            # exactly as it was.
            print("  resetting schema...")
            cur.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            print("  applying schema...")
            cur.execute(schema.read_text())

            def copy(table, cols, items):
                if not items:
                    print(f"    {table:<16} 0")
                    return
                with cur.copy(
                    f"COPY {table} ({', '.join(cols)}) FROM STDIN"
                ) as cp:
                    for row in _rows(items, cols):
                        cp.write_row(row)
                print(f"    {table:<16} {len(items)}")

            print("  loading...")
            copy("customers",
                 ["id", "name", "email", "phone", "address", "notes",
                  "joined_on", "credit", "is_wholesale", "tax_rate"],
                 out["customers"])
            copy("products",
                 ["sku", "name", "price", "wholesale_price", "cost",
                  "stock_qty", "vendor", "category", "active"],
                 out["products"])
            copy("invoices",
                 ["id", "customer_id", "status", "payment", "tax",
                  "credit_applied", "discount", "total", "is_wholesale",
                  "due_date", "sold_at", "paid_at", "note"],
                 out["invoices"])
            copy("invoice_lines",
                 ["invoice_id", "sku", "description", "qty", "unit_price"],
                 out["invoice_lines"])
            copy("vendors", ["id", "name", "contact", "phone", "email", "address"],
                 out["vendors"])
            copy("expenses", ["spent_on", "category", "amount", "description"],
                 out["expenses"])
            copy("settings", ["key", "value"], out["settings"])

            # Opening balances, so the stock ledger explains every unit on hand.
            cur.execute("""
                INSERT INTO stock_moves (sku, delta, reason, note)
                SELECT sku, stock_qty, 'migration',
                       'opening balance carried from the spreadsheet'
                  FROM products WHERE stock_qty <> 0
            """)
            print(f"    stock_moves      {cur.rowcount}")

            # Derive subtotal from the lines now that they exist. Historic rows
            # only ever stored a total.
            cur.execute("""
                UPDATE invoices i SET subtotal = COALESCE(s.sum, 0)
                  FROM (SELECT invoice_id, ROUND(SUM(line_total), 2) AS sum
                          FROM invoice_lines GROUP BY invoice_id) s
                 WHERE s.invoice_id = i.id
            """)

            # Never hand out a number that already exists.
            cur.execute("""
                SELECT setval('invoice_no_seq',
                              GREATEST((SELECT COALESCE(MAX(id), 0) FROM invoices) + 1,
                                       10200), false)
            """)
            print(f"    next invoice no  {cur.fetchone()[0]}")

        conn.commit()
    print("  committed.")

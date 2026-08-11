import { sql, type Product, type CartLine } from "./db";

/**
 * The whole active catalogue, sent to the browser once.
 *
 * 1,243 items at roughly 60 bytes each is ~75KB — small enough to ship, and it
 * buys something the old kiosk never had: search keeps working when the shop
 * wifi drops. Typing is then instant with no round trip per keystroke, which is
 * the single most-used interaction on the iPad.
 */
export async function getCatalogue(): Promise<Product[]> {
  const rows = await sql`
    SELECT sku, name, price::float8 AS price, stock_qty,
           wholesale_price::float8 AS wholesale_price
      FROM products
     WHERE active
     ORDER BY name`;
  return rows as Product[];
}

/** Actual best sellers — the old kiosk showed the first four rows of the sheet. */
export async function getTopSellers(limit = 6): Promise<Product[]> {
  const rows = await sql`
    SELECT p.sku, p.name, p.price::float8 AS price, p.stock_qty,
           p.wholesale_price::float8 AS wholesale_price
      FROM invoice_lines l
      JOIN invoices i ON i.id = l.invoice_id
      JOIN products p ON p.sku = l.sku
     WHERE i.sold_at > now() - interval '12 months' AND p.active
     GROUP BY p.sku, p.name, p.price, p.stock_qty, p.wholesale_price
     ORDER BY SUM(l.qty) DESC
     LIMIT ${limit}`;
  return rows as Product[];
}

export async function getCustomers() {
  const rows = await sql`
    SELECT id, name, is_wholesale, credit::float8 AS credit
      FROM customers ORDER BY name`;
  return rows as { id: string; name: string; is_wholesale: boolean; credit: number }[];
}

export async function getTaxRate(): Promise<number> {
  const rows = await sql`SELECT value FROM settings WHERE key = 'TaxRate'`;
  const raw = parseFloat(String(rows[0]?.value ?? "0.08").replace("%", ""));
  if (Number.isNaN(raw)) return 0;
  return raw > 1 ? raw / 100 : raw;
}

/**
 * Records a sale by calling the same record_sale() the Streamlit app uses, so
 * both front ends write through one transaction with one set of rules. Invoice,
 * lines and stock movement land together or not at all.
 */
export async function recordSale(opts: {
  customerId: string | null;
  lines: CartLine[];
  payment: "cash" | "check" | "card" | "venmo" | "invoice";
  status: "paid" | "pending";
  tax: number;
  isWholesale: boolean;
}): Promise<number> {
  const rows = await sql`
    SELECT record_sale(
      ${opts.customerId},
      ${JSON.stringify(opts.lines)}::jsonb,
      ${opts.payment}::payment_method,
      ${opts.status}::invoice_status,
      0, 0, ${opts.tax}, 0, ${opts.isWholesale}
    ) AS id`;
  return Number(rows[0].id);
}

import "server-only";
import {
  sql,
  type Product,
  type ProductFull,
  type Customer,
  type CustomerLite,
  type Invoice,
  type InvoiceLine,
  type Expense,
} from "./db";
import { normaliseRate } from "./format";

/**
 * Every read the app performs, in one place.
 *
 * Two rules hold throughout:
 *  - `numeric` columns are cast to float8 on the way out. Postgres returns
 *    numerics as strings to protect precision, and a string that looks like a
 *    number is exactly how the old app ended up adding "12.50" to "3.00" and
 *    getting "12.503.00".
 *  - aggregation happens in SQL, not in JavaScript. The spreadsheet version
 *    pulled 1,400 invoices into memory to add up one month; here the database
 *    adds them up and sends back a single row.
 *
 * Dates are the shop's, not the server's. Every query below compares `sold_at`
 * — a timestamptz — against a Pacific midnight rather than against a bare date.
 * Neon's HTTP driver gives each query its own session, and those sessions are
 * UTC, so `sold_at >= '2026-08-01'::date` would actually mean "from five in the
 * afternoon on July 31st" and quietly file the last evening of every month into
 * the next one.
 *
 * The conversion is written out in each query rather than shared through a
 * helper: the HTTP driver's tagged templates are whole queries, not composable
 * fragments, so a "reusable" one would be interpolated as a string parameter
 * and silently stop being SQL.
 */

// --------------------------------------------------------------- catalogue --

/**
 * The whole active catalogue, sent to the browser once.
 *
 * ~1,500 items at roughly 60 bytes each is small enough to ship, and it buys
 * something the old kiosk never had: search keeps working when the shop wifi
 * drops. Typing is then instant with no round trip per keystroke, which is the
 * single most-used interaction on the iPad.
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

/** Everything, inactive included — the inventory screen has to show it all. */
export async function getAllProducts(): Promise<ProductFull[]> {
  const rows = await sql`
    SELECT sku, name, price::float8 AS price, stock_qty,
           wholesale_price::float8 AS wholesale_price, cost::float8 AS cost,
           vendor, category, active
      FROM products
     ORDER BY name`;
  return rows as ProductFull[];
}

export async function getProduct(sku: string): Promise<ProductFull | null> {
  const rows = await sql`
    SELECT sku, name, price::float8 AS price, stock_qty,
           wholesale_price::float8 AS wholesale_price, cost::float8 AS cost,
           vendor, category, active
      FROM products WHERE sku = ${sku}`;
  return (rows[0] as ProductFull) ?? null;
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

/** The movement ledger behind one SKU — answers "why is this at -76?". */
export async function getStockHistory(sku: string, limit = 40) {
  const rows = await sql`
    SELECT id, delta, reason::text AS reason, invoice_id, note, created_at
      FROM stock_moves
     WHERE sku = ${sku}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit}`;
  return rows as {
    id: number;
    delta: number;
    reason: string;
    invoice_id: number | null;
    note: string | null;
    created_at: string;
  }[];
}

// --------------------------------------------------------------- customers --

export async function getCustomers(): Promise<CustomerLite[]> {
  const rows = await sql`
    SELECT id, name, email, phone, credit::float8 AS credit, is_wholesale,
           tax_rate::float8 AS tax_rate
      FROM customers ORDER BY name`;
  return rows as CustomerLite[];
}

/**
 * The customer list with the two numbers the list actually needs, computed in
 * SQL. Doing it per row in the page would be 226 extra round trips.
 */
export async function getCustomerIndex() {
  const rows = await sql`
    SELECT c.id, c.name, c.email, c.phone, c.credit::float8 AS credit,
           c.is_wholesale,
           COALESCE(s.spent, 0)::float8      AS spent,
           COALESCE(s.owing, 0)::float8      AS owing,
           s.last_sale
      FROM customers c
      LEFT JOIN (
        SELECT customer_id,
               SUM(total) FILTER (WHERE status = 'paid')    AS spent,
               SUM(total) FILTER (WHERE status = 'pending') AS owing,
               MAX(sold_at)                                 AS last_sale
          FROM invoices GROUP BY customer_id
      ) s ON s.customer_id = c.id
     ORDER BY c.name`;
  return rows as {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    credit: number;
    is_wholesale: boolean;
    spent: number;
    owing: number;
    last_sale: string | null;
  }[];
}

export async function getCustomer(id: string): Promise<Customer | null> {
  const rows = await sql`
    SELECT id, name, email, phone, address, notes, credit::float8 AS credit,
           is_wholesale, tax_rate::float8 AS tax_rate,
           to_char(joined_on, 'YYYY-MM-DD') AS joined_on
      FROM customers WHERE id = ${id}`;
  return (rows[0] as Customer) ?? null;
}

/**
 * Same-name customers are legitimate here (two Willow Overholtzers), so the
 * database allows it. The UI has to disambiguate rather than pretend.
 */
export async function getNamesakes(name: string, excludeId: string) {
  const rows = await sql`
    SELECT id, name FROM customers
     WHERE lower(btrim(name)) = lower(btrim(${name})) AND id <> ${excludeId}`;
  return rows as { id: string; name: string }[];
}

// ---------------------------------------------------------------- invoices --

export async function getCustomerInvoices(customerId: string): Promise<Invoice[]> {
  const rows = await sql`
    SELECT i.id, i.customer_id, c.name AS customer_name, i.status::text AS status,
           i.payment::text AS payment, i.subtotal::float8 AS subtotal,
           i.discount::float8 AS discount, i.freight::float8 AS freight,
           i.tax::float8 AS tax, i.credit_applied::float8 AS credit_applied,
           i.total::float8 AS total, i.is_wholesale,
           to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
           i.sold_at, i.paid_at, i.note, i.returns_id
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.customer_id = ${customerId}
     ORDER BY i.sold_at DESC, i.id DESC`;
  return rows as Invoice[];
}

export async function getInvoice(id: number): Promise<Invoice | null> {
  const rows = await sql`
    SELECT i.id, i.customer_id, c.name AS customer_name, i.status::text AS status,
           i.payment::text AS payment, i.subtotal::float8 AS subtotal,
           i.discount::float8 AS discount, i.freight::float8 AS freight,
           i.tax::float8 AS tax, i.credit_applied::float8 AS credit_applied,
           i.total::float8 AS total, i.is_wholesale,
           to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
           i.sold_at, i.paid_at, i.note, i.returns_id
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.id = ${id}`;
  return (rows[0] as Invoice) ?? null;
}

/**
 * How much of each line has already come back, so nothing is returned twice.
 *
 * Keyed by SKU and description together: a return's lines are copies of the
 * originals, not references to them, and a hand-typed line has no SKU at all.
 */
export async function returnedSoFar(invoiceId: number) {
  const rows = (await sql`
    SELECT l.description, COALESCE(l.sku, '') AS sku, SUM(-l.qty)::float8 AS qty
      FROM invoice_lines l
      JOIN invoices r ON r.id = l.invoice_id
     WHERE r.returns_id = ${invoiceId}
     GROUP BY l.description, COALESCE(l.sku, '')`) as {
    description: string;
    sku: string;
    qty: number;
  }[];
  return new Map(rows.map((r) => [`${r.sku}|${r.description}`, r.qty]));
}

/** The returns written against one sale, newest first. */
export async function getReturns(invoiceId: number) {
  const rows = await sql`
    SELECT id, total::float8 AS total, payment::text AS payment, sold_at
      FROM invoices
     WHERE returns_id = ${invoiceId}
     ORDER BY sold_at DESC, id DESC`;
  return rows as { id: number; total: number; payment: string | null; sold_at: string }[];
}

export async function getInvoiceLines(id: number): Promise<InvoiceLine[]> {
  const rows = await sql`
    SELECT id, sku, description, qty::float8 AS qty,
           unit_price::float8 AS unit_price, line_total::float8 AS line_total
      FROM invoice_lines WHERE invoice_id = ${id} ORDER BY id`;
  return rows as InvoiceLine[];
}

/** Everything still owed, oldest first — the collections worklist. */
export async function getOpenInvoices() {
  const rows = await sql`
    SELECT i.id, COALESCE(c.name, 'Guest') AS customer_name, i.customer_id,
           i.total::float8 AS total, i.sold_at,
           to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
           (i.due_date IS NOT NULL
            AND i.due_date < (now() AT TIME ZONE 'America/Los_Angeles')::date) AS overdue,
           GREATEST(0, (now() AT TIME ZONE 'America/Los_Angeles')::date - i.due_date)::int
             AS days_overdue
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
     WHERE i.status = 'pending'
     ORDER BY i.due_date NULLS LAST, i.sold_at`;
  return rows as {
    id: number;
    customer_name: string;
    customer_id: string | null;
    total: number;
    sold_at: string;
    due_date: string | null;
    overdue: boolean;
    days_overdue: number;
  }[];
}

// --------------------------------------------------------------- dashboard --

/**
 * Every dashboard number in one round trip. `end` is inclusive, so the range
 * runs to the end of that day rather than midnight at its start — a sale made
 * this afternoon belongs in a report that ends today.
 */
export async function getDashboard(start: string, end: string) {
  const rows = await sql`
    WITH period AS (
      SELECT * FROM invoices
       WHERE sold_at >= (${start}::date)::timestamp AT TIME ZONE 'America/Los_Angeles'
         AND sold_at <  ((${end}::date) + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'
         AND status <> 'void'
    )
    SELECT
      (SELECT COALESCE(SUM(total), 0) FROM period)::float8              AS revenue,
      (SELECT COALESCE(SUM(tax), 0)   FROM period)::float8              AS tax,
      (SELECT COUNT(*) FROM period)::int                                AS orders,
      (SELECT COALESCE(SUM(total), 0) FROM invoices
        WHERE status = 'pending')::float8                               AS outstanding,
      (SELECT COUNT(*) FROM invoices WHERE status = 'pending')::int     AS open_count,
      (SELECT COUNT(*) FROM invoices
        WHERE status = 'pending'
          AND due_date < (now() AT TIME ZONE 'America/Los_Angeles')::date)::int AS overdue_count,
      (SELECT COALESCE(SUM(credit), 0) FROM customers)::float8          AS credit_outstanding,
      (SELECT COUNT(*) FROM products WHERE active AND stock_qty <= 0)::int AS out_of_stock`;
  return rows[0] as {
    revenue: number;
    tax: number;
    orders: number;
    outstanding: number;
    open_count: number;
    overdue_count: number;
    credit_outstanding: number;
    out_of_stock: number;
  };
}

export async function getRecentSales(limit = 20) {
  const rows = await sql`
    SELECT i.id, COALESCE(c.name, 'Guest') AS customer_name, i.customer_id,
           i.total::float8 AS total, i.status::text AS status,
           i.payment::text AS payment, i.sold_at
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
     ORDER BY i.sold_at DESC, i.id DESC
     LIMIT ${limit}`;
  return rows as {
    id: number;
    customer_name: string;
    customer_id: string | null;
    total: number;
    status: string;
    payment: string | null;
    sold_at: string;
  }[];
}

/** Daily totals for the dashboard sparkline. Gaps are filled so the line is honest. */
export async function getDailyRevenue(start: string, end: string) {
  const rows = await sql`
    SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
           COALESCE(SUM(i.total), 0)::float8 AS total
      FROM generate_series(${start}::date, ${end}::date, interval '1 day') d(day)
      LEFT JOIN invoices i
        ON i.sold_at >= (d.day::date)::timestamp AT TIME ZONE 'America/Los_Angeles'
       AND i.sold_at <  ((d.day::date) + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'
       AND i.status <> 'void'
     GROUP BY d.day ORDER BY d.day`;
  return rows as { day: string; total: number }[];
}

/** Items at or below zero, worst first. Negative stock is real here, not a bug. */
export async function getLowStock(limit = 12) {
  const rows = await sql`
    SELECT sku, name, stock_qty, price::float8 AS price,
           wholesale_price::float8 AS wholesale_price
      FROM products
     WHERE active AND stock_qty <= 0
     ORDER BY stock_qty, name
     LIMIT ${limit}`;
  return rows as Product[];
}

// -------------------------------------------------------------- financials --

/**
 * The income statement, computed entirely in SQL.
 *
 * Freight is reported on its own line because it is income but not product
 * revenue, and it is excluded from COGS — there is no inventory behind a
 * shipping charge. Gift certificates are excluded for the same reason: the
 * money is a liability until it is spent, and the goods it eventually buys are
 * costed on that later invoice.
 */
export async function getIncomeStatement(start: string, end: string) {
  const rows = await sql`
    WITH period AS (
      SELECT * FROM invoices
       WHERE sold_at >= (${start}::date)::timestamp AT TIME ZONE 'America/Los_Angeles'
         AND sold_at <  ((${end}::date) + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'
         AND status <> 'void'
    ),
    lines AS (
      SELECT l.*, p.is_wholesale,
             (upper(COALESCE(l.sku, '')) = 'FREIGHT'
              OR lower(l.description) LIKE 'shipping%')            AS is_freight,
             (upper(COALESCE(l.sku, '')) LIKE 'GIFT%'
              OR lower(l.description) LIKE 'gift certificate%')    AS is_gift
        FROM invoice_lines l JOIN period p ON p.id = l.invoice_id
    )
    SELECT
      (SELECT COALESCE(SUM(total - tax), 0) FROM period WHERE NOT is_wholesale)::float8 AS retail,
      (SELECT COALESCE(SUM(total - tax), 0) FROM period WHERE is_wholesale)::float8     AS wholesale,
      (SELECT COALESCE(SUM(line_total), 0) FROM lines WHERE is_freight)::float8         AS freight,
      (SELECT COALESCE(SUM(line_total), 0) FROM lines WHERE is_gift)::float8            AS gift_cards,
      (SELECT COALESCE(SUM(tax), 0) FROM period)::float8                                AS tax,
      (SELECT COALESCE(SUM(total), 0) FROM period)::float8                              AS gross_receipts,
      (SELECT COALESCE(SUM(l.qty * COALESCE(pr.cost, 0)), 0)
         FROM lines l JOIN products pr ON pr.sku = l.sku
        WHERE NOT l.is_freight AND NOT l.is_gift)::float8                               AS cogs,
      (SELECT COUNT(DISTINCT l.sku)
         FROM lines l JOIN products pr ON pr.sku = l.sku
        WHERE NOT l.is_freight AND NOT l.is_gift
          AND (pr.cost IS NULL OR pr.cost = 0))::int                                    AS skus_without_cost,
      (SELECT COUNT(*) FROM period p
        WHERE NOT EXISTS (SELECT 1 FROM invoice_lines l WHERE l.invoice_id = p.id))::int AS invoices_without_lines,
      (SELECT COUNT(*) FROM period)::int                                                AS orders,
      -- Records imported from the previous bookkeeping software store the total
      -- *before* sales tax. Revenue below is computed as total - tax, which on
      -- those records subtracts tax that was never in the total to begin with.
      -- Counted rather than corrected: only the shop knows which figure the
      -- customer actually paid.
      (SELECT COUNT(*) FROM period
        WHERE tax > 0 AND abs(total - (subtotal - discount - credit_applied)) < 0.011)::int
                                                                                        AS tax_outside_total,
      (SELECT COALESCE(SUM(tax), 0) FROM period
        WHERE tax > 0 AND abs(total - (subtotal - discount - credit_applied)) < 0.011)::float8
                                                                                        AS tax_outside_total_amount`;
  return rows[0] as {
    retail: number;
    wholesale: number;
    freight: number;
    gift_cards: number;
    tax: number;
    gross_receipts: number;
    cogs: number;
    skus_without_cost: number;
    invoices_without_lines: number;
    orders: number;
    tax_outside_total: number;
    tax_outside_total_amount: number;
  };
}

export async function getExpenseBreakdown(start: string, end: string) {
  const rows = await sql`
    SELECT category, SUM(amount)::float8 AS amount, COUNT(*)::int AS n
      FROM expenses
     WHERE spent_on >= ${start}::date AND spent_on <= ${end}::date
     GROUP BY category ORDER BY SUM(amount) DESC`;
  return rows as { category: string; amount: number; n: number }[];
}

export async function getExpenses(start: string, end: string, limit = 200): Promise<Expense[]> {
  const rows = await sql`
    SELECT id, to_char(spent_on, 'YYYY-MM-DD') AS spent_on, category,
           amount::float8 AS amount, description
      FROM expenses
     WHERE spent_on >= ${start}::date AND spent_on <= ${end}::date
     ORDER BY spent_on DESC, id DESC
     LIMIT ${limit}`;
  return rows as Expense[];
}

/**
 * Sales-tax liability. Taxable sales are derived from tax actually charged
 * rather than from "everything that isn't wholesale" — a customer with a
 * per-customer override or a tax-exempt sale would otherwise be counted in.
 */
export async function getTaxSummary(start: string, end: string) {
  const rows = await sql`
    WITH period AS (
      SELECT * FROM invoices
       WHERE sold_at >= (${start}::date)::timestamp AT TIME ZONE 'America/Los_Angeles'
         AND sold_at <  ((${end}::date) + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'
         AND status <> 'void'
    ),
    freight AS (
      SELECT l.invoice_id, SUM(l.line_total)::numeric AS amt
        FROM invoice_lines l JOIN period p ON p.id = l.invoice_id
       WHERE upper(COALESCE(l.sku, '')) = 'FREIGHT'
          OR lower(l.description) LIKE 'shipping%'
       GROUP BY l.invoice_id
    )
    SELECT
      COALESCE(SUM(p.tax), 0)::float8                                    AS tax_collected,
      COALESCE(SUM(CASE WHEN p.tax > 0
                        THEN p.total - p.tax - COALESCE(f.amt, 0)
                        ELSE 0 END), 0)::float8                          AS taxable_sales,
      COALESCE(SUM(CASE WHEN p.tax = 0
                        THEN p.total - COALESCE(f.amt, 0)
                        ELSE 0 END), 0)::float8                          AS exempt_sales,
      COALESCE(SUM(COALESCE(f.amt, 0)), 0)::float8                       AS freight
      FROM period p LEFT JOIN freight f ON f.invoice_id = p.id`;
  return rows[0] as {
    tax_collected: number;
    taxable_sales: number;
    exempt_sales: number;
    freight: number;
  };
}

/** Product leaderboard. Profit uses the *current* cost — the only one recorded. */
export async function getProductPerformance(start: string, end: string, limit = 100) {
  const rows = await sql`
    SELECT COALESCE(l.sku, '—') AS sku,
           COALESCE(p.name, l.description) AS name,
           SUM(l.qty)::float8                                   AS units,
           SUM(l.line_total)::float8                            AS revenue,
           SUM(l.line_total - l.qty * COALESCE(p.cost, 0))::float8 AS profit,
           bool_or(p.cost IS NULL OR p.cost = 0)                AS cost_missing
      FROM invoice_lines l
      JOIN invoices i ON i.id = l.invoice_id
      LEFT JOIN products p ON p.sku = l.sku
     WHERE i.sold_at >= (${start}::date)::timestamp AT TIME ZONE 'America/Los_Angeles'
       AND i.sold_at <  ((${end}::date) + 1)::timestamp AT TIME ZONE 'America/Los_Angeles'
       AND i.status <> 'void'
       AND upper(COALESCE(l.sku, '')) <> 'FREIGHT'
       AND lower(l.description) NOT LIKE 'shipping%'
       AND lower(l.description) NOT LIKE 'gift certificate%'
     GROUP BY 1, 2
     ORDER BY revenue DESC
     LIMIT ${limit}`;
  return rows as {
    sku: string;
    name: string;
    units: number;
    revenue: number;
    profit: number;
    cost_missing: boolean;
  }[];
}

// ---------------------------------------------------------------- settings --

export async function getSettings(): Promise<Record<string, string>> {
  const rows = (await sql`SELECT key, value FROM settings`) as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getTaxRate(): Promise<number> {
  const rows = await sql`SELECT value FROM settings WHERE key = 'TaxRate'`;
  return normaliseRate((rows[0]?.value as string) ?? "0.08");
}

/**
 * What the next invoice will be numbered, and whether the sequence has drifted
 * ahead of the highest invoice actually issued.
 *
 * Invoice numbers matter here beyond bookkeeping neatness: a gap in them is how
 * the six sales lost by the old code were found in the first place. Worth being
 * able to see at a glance.
 */
export async function getInvoiceNumbering() {
  const rows = await sql`
    SELECT (SELECT COALESCE(MAX(id), 0) FROM invoices)::int AS highest,
           (SELECT last_value FROM invoice_no_seq)::int     AS sequence_at`;
  const r = rows[0] as { highest: number; sequence_at: number };
  return { ...r, gap: Math.max(0, r.sequence_at - r.highest) };
}

/**
 * Who a cheque should be made out to.
 *
 * Printed at the foot of every unpaid invoice. It is not the shop's name —
 * cheques are written to the person who banks them, and "Notion to Sew" isn't
 * what's on the account.
 */
export const payableTo = (settings: Record<string, string>) =>
  settings.PayableTo?.trim() || settings.CompanyName?.trim() || "Notion to Sew";

/**
 * Whether a sale must be attached to somebody.
 *
 * Defaults to yes. Six invoices in the book are filed against nobody because
 * someone forgot their name at the counter, and an unattributed sale can't be
 * chased, credited, or counted towards a customer's history.
 */
export const requiresCustomer = (settings: Record<string, string>) =>
  (settings.RequireCustomer ?? "true") !== "false";

export const DEFAULT_EXPENSE_CATEGORIES =
  "Inventory Purchase, Fabric, Notions, Rent, Marketing, Shipping, Wages, Other";

export function expenseCategories(settings: Record<string, string>): string[] {
  const raw = settings.ExpenseCategories || DEFAULT_EXPENSE_CATEGORIES;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// -------------------------------------------------------------- integrity --

/**
 * The constraints make all of these impossible through the app, so a non-empty
 * result means something went at the database directly. Kept because it is
 * cheap and it is exactly the class of problem that cost a week of confusion.
 */
export async function checkIntegrity(): Promise<string[]> {
  try {
    const rows = (await sql`
      SELECT 'Two customers share the id ' || id AS msg FROM customers GROUP BY id HAVING count(*) > 1
      UNION ALL
      SELECT 'Two products share the SKU ' || sku FROM products GROUP BY sku HAVING count(*) > 1
      UNION ALL
      SELECT 'Invoice ' || id || ' is marked paid with no payment date'
        FROM invoices WHERE status = 'paid' AND paid_at IS NULL
      LIMIT 20`) as { msg: string }[];
    return rows.map((r) => r.msg);
  } catch {
    return [];
  }
}

// ------------------------------------------------------------- email log --

export type EmailLogRow = {
  id: number;
  sent_at: string;
  to_address: string;
  subject: string;
  kind: string;
  source: string;
  invoice_id: number | null;
  status: string;
  error: string | null;
  provider: string;
  delivered_at: string | null;
  opened_at: string | null;
  bounced_at: string | null;
  failure_reason: string | null;
};

/**
 * What the app has tried to send. Failures matter more than successes here —
 * a receipt that didn't arrive is otherwise invisible once the toast fades.
 */
export async function getEmailLog(limit = 50): Promise<EmailLogRow[]> {
  const rows = await sql`
    SELECT id, sent_at, to_address, subject, kind, source, invoice_id, status, error,
           provider, delivered_at, opened_at, bounced_at, failure_reason
      FROM email_log
     ORDER BY sent_at DESC, id DESC
     LIMIT ${limit}`;
  return rows as EmailLogRow[];
}

export async function getEmailCounts() {
  const rows = await sql`
    SELECT COUNT(*)::int                                              AS total,
           COUNT(*) FILTER (WHERE status = 'failed')::int             AS failed,
           COUNT(*) FILTER (WHERE sent_at > now() - interval '30 days')::int AS last_30,
           COUNT(*) FILTER (WHERE delivered_at IS NOT NULL)::int      AS delivered,
           COUNT(*) FILTER (WHERE bounced_at IS NOT NULL)::int        AS bounced,
           MAX(sent_at)                                               AS last_at
      FROM email_log`;
  return rows[0] as {
    total: number;
    failed: number;
    last_30: number;
    delivered: number;
    bounced: number;
    last_at: string | null;
  };
}

// --------------------------------------------------------------- replies --

export type ReplyRow = {
  id: number;
  received_at: string;
  from_address: string;
  from_name: string | null;
  subject: string | null;
  body: string | null;
  attachments: number;
  invoice_id: number | null;
  customer_id: string | null;
  customer_name: string | null;
  read_at: string | null;
};

/** What customers wrote back. Unread first is deliberate — that is the job. */
export async function getReplies(limit = 30): Promise<ReplyRow[]> {
  const rows = await sql`
    SELECT r.id, r.received_at, r.from_address, r.from_name, r.subject, r.body,
           r.attachments, r.invoice_id, r.customer_id, c.name AS customer_name, r.read_at
      FROM email_replies r
      LEFT JOIN customers c ON c.id = r.customer_id
     ORDER BY (r.read_at IS NULL) DESC, r.received_at DESC
     LIMIT ${limit}`;
  return rows as ReplyRow[];
}

export async function getUnreadReplyCount(): Promise<number> {
  const rows = await sql`SELECT COUNT(*)::int AS n FROM email_replies WHERE read_at IS NULL`;
  return (rows[0]?.n as number) ?? 0;
}

/** Replies from one customer, for their profile page. */
export async function getCustomerReplies(customerId: string): Promise<ReplyRow[]> {
  const rows = await sql`
    SELECT r.id, r.received_at, r.from_address, r.from_name, r.subject, r.body,
           r.attachments, r.invoice_id, r.customer_id, c.name AS customer_name, r.read_at
      FROM email_replies r
      LEFT JOIN customers c ON c.id = r.customer_id
     WHERE r.customer_id = ${customerId}
     ORDER BY r.received_at DESC
     LIMIT 20`;
  return rows as ReplyRow[];
}

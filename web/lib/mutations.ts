import "server-only";
import { sql, type CartLine, type PaymentMethod, type InvoiceStatus } from "./db";

/**
 * Every write the app performs.
 *
 * These are plain functions, not server actions: actions live next to the
 * screens that use them and are responsible for auth, validation and cache
 * invalidation. Keeping the SQL here means a rule like "freight is a line item"
 * is stated once instead of in five forms.
 */

// ------------------------------------------------------------------- sales --

export type SaleInput = {
  customerId: string | null;
  lines: CartLine[];
  payment: PaymentMethod;
  status: InvoiceStatus;
  /** Dollar amount, not a percentage. */
  discount?: number;
  freight?: number;
  tax?: number;
  creditApplied?: number;
  isWholesale?: boolean;
  /** Days until due; only meaningful for a pending invoice. */
  termsDays?: number;
};

/**
 * Records a sale through the same record_sale() the Streamlit app calls, so
 * both front ends write with one set of rules. Invoice, lines, stock movement
 * and the customer's credit balance land together or not at all.
 *
 * Freight is passed as an ordinary line rather than through record_sale's
 * p_freight parameter. All 1,374 migrated invoices carry shipping that way, and
 * a total that is partly in a line and partly in a column is how you end up
 * with two answers to "what did this invoice come to".
 */
export async function recordSale(input: SaleInput): Promise<number> {
  const lines = [...input.lines];
  const freight = round2(input.freight ?? 0);
  if (freight > 0) {
    lines.push({ sku: null, description: "Shipping", qty: 1, unit_price: freight });
  }

  const rows = await sql`
    SELECT record_sale(
      ${input.customerId},
      ${JSON.stringify(lines)}::jsonb,
      ${input.payment}::payment_method,
      ${input.status}::invoice_status,
      ${round2(input.discount ?? 0)},
      0,
      ${round2(input.tax ?? 0)},
      ${round2(input.creditApplied ?? 0)},
      ${input.isWholesale ?? false}
    ) AS id`;
  const id = Number(rows[0].id);

  if (input.status === "pending") {
    const days = Math.max(0, Math.round(input.termsDays ?? (input.isWholesale ? 30 : 0)));
    // ::date on a timestamptz uses the session's timezone, and the HTTP
    // driver's sessions are UTC — so an evening sale would fall due a day early.
    await sql`
      UPDATE invoices
         SET due_date = ((sold_at + make_interval(days => ${days}))
                          AT TIME ZONE 'America/Los_Angeles')::date
       WHERE id = ${id}`;
  }
  return id;
}

export async function markInvoicePaid(id: number, payment?: PaymentMethod) {
  const rows = await sql`
    UPDATE invoices
       SET status  = 'paid',
           paid_at = COALESCE(paid_at, now()),
           payment = COALESCE(${payment ?? null}::payment_method, payment)
     WHERE id = ${id} AND status <> 'void'
     RETURNING id`;
  return rows.length > 0;
}

/**
 * Deleting a sale must put the stock back. record_sale took it out and wrote a
 * ledger row; this writes the mirror-image row so the ledger still explains the
 * on-hand number, then lets ON DELETE CASCADE take the lines.
 */
export async function deleteInvoice(id: number) {
  const lines = (await sql`
    SELECT sku, qty::float8 AS qty FROM invoice_lines
     WHERE invoice_id = ${id} AND sku IS NOT NULL`) as { sku: string; qty: number }[];

  const credit = (await sql`
    SELECT customer_id, credit_applied::float8 AS credit_applied, note,
           payment::text AS payment, total::float8 AS total, returns_id
      FROM invoices WHERE id = ${id}`) as {
    customer_id: string | null;
    credit_applied: number;
    note: string | null;
    payment: string | null;
    total: number;
    returns_id: number | null;
  }[];

  const statements = [];
  for (const l of lines) {
    // Negative on a return, and that is the right sign: undoing a return takes
    // the goods back off the shelf, because they were never really given back.
    const delta = Math.round(l.qty);
    if (delta === 0) continue;
    statements.push(
      sql`UPDATE products SET stock_qty = stock_qty + ${delta} WHERE sku = ${l.sku}`,
      sql`INSERT INTO stock_moves (sku, delta, reason, note)
          VALUES (${l.sku}, ${delta}, 'adjustment',
                  ${(delta > 0 ? "returned to stock — invoice " : "taken back off — return ") + id + " deleted"})`,
    );
  }
  const c = credit[0];
  if (c?.customer_id && c.credit_applied > 0) {
    statements.push(
      sql`UPDATE customers SET credit = credit + ${c.credit_applied} WHERE id = ${c.customer_id}`,
    );
  }

  // A return refunded as store credit put money on the account without going
  // through credit_applied, so it has to be taken back the same way. Clamped at
  // zero: they may already have spent some of it.
  if (c?.returns_id && c.payment === "credit" && c.customer_id && c.total < 0) {
    statements.push(
      sql`UPDATE customers SET credit = GREATEST(0, credit - ${-c.total})
           WHERE id = ${c.customer_id}`,
    );
  }

  // If this sale *granted* credit — a gift certificate — take it back with the
  // sale. Clamped at zero, because the recipient may already have spent some of
  // it, and a negative balance is refused by the engine anyway.
  const gift = GIFT_NOTE.exec(c?.note ?? "");
  if (gift) {
    const [, recipientId, amount] = gift;
    statements.push(
      sql`UPDATE customers SET credit = GREATEST(0, credit - ${Number(amount)})
           WHERE id = ${recipientId}`,
    );
  }

  statements.push(sql`DELETE FROM invoices WHERE id = ${id}`);
  await sql.transaction(statements);
  return true;
}

/** Adds a shipping line to an invoice that has already been recorded. */
export async function addFreight(invoiceId: number, amount: number) {
  const amt = round2(amount);
  if (amt <= 0) return false;
  await sql.transaction([
    sql`INSERT INTO invoice_lines (invoice_id, sku, description, qty, unit_price)
        VALUES (${invoiceId}, NULL, 'Shipping', 1, ${amt})`,
    sql`UPDATE invoices SET total = total + ${amt} WHERE id = ${invoiceId}`,
  ]);
  return true;
}

// --------------------------------------------------------------- customers --

export async function addCustomer(input: {
  name: string;
  email?: string;
  phone?: string;
  isWholesale?: boolean;
}) {
  const rows = await sql`
    INSERT INTO customers (id, name, email, phone, joined_on, is_wholesale)
    VALUES ('C-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
            ${input.name.trim()}, NULLIF(${input.email ?? ""}, ''),
            NULLIF(${input.phone ?? ""}, ''), (now() AT TIME ZONE 'America/Los_Angeles')::date, ${input.isWholesale ?? false})
    RETURNING id`;
  return rows[0].id as string;
}

export async function updateCustomer(
  id: string,
  input: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    notes?: string;
    isWholesale: boolean;
    /** Decimal (0.07875), or null to fall back to the shop-wide rate. */
    taxRate: number | null;
  },
) {
  const rows = await sql`
    UPDATE customers
       SET name = ${input.name.trim()},
           email = NULLIF(${input.email ?? ""}, ''),
           phone = NULLIF(${input.phone ?? ""}, ''),
           address = NULLIF(${input.address ?? ""}, ''),
           notes = NULLIF(${input.notes ?? ""}, ''),
           is_wholesale = ${input.isWholesale},
           tax_rate = ${input.taxRate}
     WHERE id = ${id}
     RETURNING id`;
  return rows.length > 0;
}

/** ON DELETE RESTRICT means a customer with history cannot be quietly removed. */
export async function deleteCustomer(id: string) {
  const rows = await sql`DELETE FROM customers WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/** How a gift certificate records who received the credit, so it can be undone. */
const GIFT_NOTE = /^gift-credit:([^:]+):([0-9.]+)$/;

/**
 * A gift certificate is a paid sale plus a credit balance for the recipient.
 *
 * One statement, so it is one transaction: taking the money and recording the
 * credit cannot come apart. It was two statements until a live end-to-end test
 * showed the other half of the problem — deleting the invoice refunded nothing,
 * because nothing recorded who had been given the credit. The note now says,
 * and deleteInvoice reads it back.
 */
export async function sellGiftCertificate(input: {
  buyerId: string;
  recipientId: string;
  amount: number;
  payment: PaymentMethod;
}) {
  const amount = round2(input.amount);
  const recipient = (await sql`
    SELECT name FROM customers WHERE id = ${input.recipientId}`) as { name: string }[];
  const name = recipient[0]?.name ?? "a customer";
  const note = `gift-credit:${input.recipientId}:${amount.toFixed(2)}`;

  const rows = await sql`
    WITH sale AS (
      SELECT record_sale(
        ${input.buyerId},
        ${JSON.stringify([
          { sku: null, description: `Gift Certificate for ${name}`, qty: 1, unit_price: amount },
        ])}::jsonb,
        ${input.payment}::payment_method, 'paid', 0, 0, 0, 0, false) AS id
    ),
    noted AS (
      UPDATE invoices SET note = ${note} WHERE id = (SELECT id FROM sale) RETURNING id
    ),
    granted AS (
      UPDATE customers SET credit = credit + ${amount}
       WHERE id = ${input.recipientId} RETURNING id
    )
    SELECT id FROM sale`;
  return Number(rows[0].id);
}

/** Manual credit change — a refund, a goodwill gesture, a correction. */
export async function adjustCredit(id: string, delta: number) {
  const rows = await sql`
    UPDATE customers SET credit = GREATEST(0, credit + ${round2(delta)})
     WHERE id = ${id} RETURNING credit::float8 AS credit`;
  return rows[0]?.credit as number | undefined;
}

// ----------------------------------------------------------------- product --

export async function addProduct(input: {
  sku: string;
  name: string;
  price: number;
  stock: number;
  wholesalePrice?: number | null;
  cost?: number | null;
  vendor?: string;
  category?: string;
}) {
  const sku = input.sku.trim();
  await sql.transaction([
    sql`INSERT INTO products (sku, name, price, stock_qty, wholesale_price, cost, vendor, category)
        VALUES (${sku}, ${input.name.trim()}, ${round2(input.price)}, ${Math.round(input.stock)},
                ${input.wholesalePrice || null}, ${input.cost || null},
                NULLIF(${input.vendor ?? ""}, ''), NULLIF(${input.category ?? ""}, ''))`,
    ...(Math.round(input.stock) !== 0
      ? [
          sql`INSERT INTO stock_moves (sku, delta, reason, note)
              VALUES (${sku}, ${Math.round(input.stock)}, 'count', 'opening stock')`,
        ]
      : []),
  ]);
  return sku;
}

/** Returns false for an unknown SKU rather than inventing a product for it. */
export async function restockProduct(sku: string, qtyToAdd: number, newCost?: number | null) {
  const key = sku.trim();
  const delta = Math.round(qtyToAdd);
  if (delta === 0) return false;

  const exists = await sql`SELECT 1 FROM products WHERE sku = ${key}`;
  if (exists.length === 0) return false;

  await sql.transaction([
    sql`UPDATE products
           SET stock_qty = stock_qty + ${delta},
               cost = COALESCE(${newCost ?? null}, cost)
         WHERE sku = ${key}`,
    sql`INSERT INTO stock_moves (sku, delta, reason, note)
        VALUES (${key}, ${delta}, 'restock', 'restocked from the admin portal')`,
  ]);
  return true;
}

export async function updateProduct(
  sku: string,
  input: {
    name: string;
    price: number;
    wholesalePrice: number | null;
    cost: number | null;
    vendor?: string;
    category?: string;
    active: boolean;
  },
) {
  const rows = await sql`
    UPDATE products
       SET name = ${input.name.trim()}, price = ${round2(input.price)},
           wholesale_price = ${input.wholesalePrice},
           cost = ${input.cost},
           vendor = NULLIF(${input.vendor ?? ""}, ''),
           category = NULLIF(${input.category ?? ""}, ''),
           active = ${input.active}
     WHERE sku = ${sku}
     RETURNING sku`;
  return rows.length > 0;
}

/**
 * Setting the on-hand figure to a counted number. Recorded as a movement with
 * the difference, so a stocktake is as traceable as a sale — the old app
 * overwrote the cell and the reason was lost.
 */
export async function setStockCount(sku: string, counted: number, note?: string) {
  const rows = (await sql`SELECT stock_qty FROM products WHERE sku = ${sku}`) as {
    stock_qty: number;
  }[];
  if (rows.length === 0) return false;
  const delta = Math.round(counted) - rows[0].stock_qty;
  if (delta === 0) return true;
  await sql.transaction([
    sql`UPDATE products SET stock_qty = ${Math.round(counted)} WHERE sku = ${sku}`,
    sql`INSERT INTO stock_moves (sku, delta, reason, note)
        VALUES (${sku}, ${delta}, 'count', ${note ?? "counted in the admin portal"})`,
  ]);
  return true;
}

export type ImportRow = {
  sku: string;
  name: string;
  price: number;
  stock: number;
  wholesalePrice: number | null;
  cost: number | null;
};

/**
 * Bulk import, upserting on SKU.
 *
 * The old version concatenated the upload onto the existing sheet, which is
 * what put four different books under the SKU "Book". ON CONFLICT makes a
 * repeated SKU an update to that product instead of a second row claiming
 * the same identity.
 */
export async function importProducts(rows: ImportRow[]) {
  let inserted = 0;
  let updated = 0;
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const results = await sql.transaction(
      chunk.map(
        (r) => sql`
          INSERT INTO products (sku, name, price, stock_qty, wholesale_price, cost)
          VALUES (${r.sku.trim()}, ${r.name.trim()}, ${round2(r.price)}, ${Math.round(r.stock)},
                  ${r.wholesalePrice}, ${r.cost})
          ON CONFLICT (sku) DO UPDATE
             SET name = EXCLUDED.name,
                 price = EXCLUDED.price,
                 stock_qty = EXCLUDED.stock_qty,
                 wholesale_price = COALESCE(EXCLUDED.wholesale_price, products.wholesale_price),
                 cost = COALESCE(EXCLUDED.cost, products.cost)
          RETURNING (xmax = 0) AS is_insert`,
      ),
    );
    for (const res of results) {
      const row = (res as unknown as { is_insert: boolean }[])[0];
      if (row?.is_insert) inserted++;
      else updated++;
    }
  }
  return { inserted, updated };
}

// ---------------------------------------------------------------- expenses --

export async function addExpense(input: {
  spentOn: string;
  category: string;
  amount: number;
  description?: string;
}) {
  const rows = await sql`
    INSERT INTO expenses (spent_on, category, amount, description)
    VALUES (${input.spentOn}::date, ${input.category}, ${round2(input.amount)},
            NULLIF(${input.description ?? ""}, ''))
    RETURNING id`;
  return Number(rows[0].id);
}

export async function deleteExpense(id: number) {
  const rows = await sql`DELETE FROM expenses WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------- settings --

export async function updateSettings(updates: Record<string, string>) {
  const entries = Object.entries(updates);
  if (entries.length === 0) return;
  await sql.transaction(
    entries.map(
      ([key, value]) => sql`
        INSERT INTO settings (key, value) VALUES (${key}, ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ),
  );
}

/**
 * Closes the gap between the highest invoice ever issued and the next number
 * the sequence will hand out. Purely cosmetic, but invoice-number continuity is
 * how the missing 2026 sale was found in the first place, so the gaps are worth
 * not creating.
 */
export async function tidyInvoiceSequence() {
  const rows = await sql`
    SELECT setval('invoice_no_seq',
                  GREATEST((SELECT COALESCE(MAX(id), 10199) FROM invoices), 10199))::int AS next_at`;
  return Number(rows[0].next_at) + 1;
}

const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// ----------------------------------------------------------------- returns --

export type ReturnLine = { sku: string | null; description: string; qty: number; unit_price: number };

/**
 * Money and goods going back the other way.
 *
 * Recorded as a sale with negative quantities, linked to the invoice it came
 * from. Nothing special has to be taught to the reports: revenue falls, sales
 * tax falls, stock climbs, and the customer's history shows both halves.
 *
 * Tax is worked out at the rate the original sale actually charged rather than
 * today's rate — refunding 7.875% on something sold at 7.75% would hand back
 * money that was never collected.
 */
export async function recordReturn(input: {
  originalId: number;
  customerId: string | null;
  lines: ReturnLine[];
  /** How the money goes back. 'credit' adds to their balance instead. */
  refund: PaymentMethod | "credit";
  tax: number;
}): Promise<number> {
  const negative = input.lines.map((l) => ({ ...l, qty: -Math.abs(l.qty) }));
  const asPayment: PaymentMethod = input.refund === "credit" ? "credit" : input.refund;

  const rows = await sql`
    SELECT record_sale(
      ${input.customerId},
      ${JSON.stringify(negative)}::jsonb,
      ${asPayment}::payment_method,
      'paid'::invoice_status,
      0, 0, ${-Math.abs(round2(input.tax))}, 0, false
    ) AS id`;
  const id = Number(rows[0].id);

  const goodsBack = round2(negative.reduce((s, l) => s + l.qty * l.unit_price, 0));
  const owed = round2(Math.abs(goodsBack) + Math.abs(round2(input.tax)));

  const statements = [
    sql`UPDATE invoices SET returns_id = ${input.originalId} WHERE id = ${id}`,
  ];
  // Store credit instead of cash: the invoice still records the refund, and the
  // balance goes up by the same amount.
  if (input.refund === "credit" && input.customerId) {
    statements.push(
      sql`UPDATE customers SET credit = credit + ${owed} WHERE id = ${input.customerId}`,
    );
  }
  await sql.transaction(statements);
  return id;
}

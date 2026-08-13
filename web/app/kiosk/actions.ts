"use server";

import { revalidatePath } from "next/cache";
import { sql, type PaymentMethod } from "@/lib/db";
import { recordSale } from "@/lib/mutations";
import { getCustomer, getTaxRate, getSettings, getInvoice, getInvoiceLines } from "@/lib/queries";
import { explain } from "@/lib/action-result";
import { receiptToken } from "@/lib/receipt-token";
import { buildInvoicePdf } from "@/lib/pdf";
import { sendReceipt, mailConfigured } from "@/lib/mail";
import { money } from "@/lib/format";

/**
 * The kiosk's server side.
 *
 * These endpoints are deliberately unauthenticated — the kiosk is a shared
 * terminal in the shop with no login, which is how the shop wants it. That
 * makes the trust model explicit: the browser sends item numbers and
 * quantities, never prices. Every amount of money is looked up here. A tampered
 * request can at worst buy something at its real price.
 */

const MAX_LINES = 60;
const MAX_QTY = 500;
const MAX_TOTAL = 25_000;

export type KioskLine = { sku: string; qty: number };

export type KioskSaleResult = {
  ok: boolean;
  message: string;
  invoiceId?: number;
  token?: string;
  total?: number;
  customerName?: string;
  customerEmail?: string | null;
};

export async function recordKioskSale(input: {
  customerId: string;
  lines: KioskLine[];
  payment: "cash" | "check" | "venmo" | "invoice";
  useCredit: boolean;
}): Promise<KioskSaleResult> {
  try {
    const lines = (input.lines ?? []).filter(
      (l) => l && typeof l.sku === "string" && Number.isFinite(l.qty) && l.qty > 0,
    );
    if (lines.length === 0) return { ok: false, message: "The basket is empty." };
    if (lines.length > MAX_LINES) {
      return { ok: false, message: "That's more items than one basket can hold. Please ask for help." };
    }
    if (lines.some((l) => l.qty > MAX_QTY)) {
      return { ok: false, message: "That's a very large quantity — please ask for help at the counter." };
    }

    const customer = await getCustomer(input.customerId);
    if (!customer) {
      return { ok: false, message: "We couldn't find that customer. Please search again." };
    }

    // Prices come from the catalogue, not from the browser.
    const skus = [...new Set(lines.map((l) => l.sku))];
    const rows = (await sql`
      SELECT sku, name, price::float8 AS price, wholesale_price::float8 AS wholesale_price
        FROM products WHERE active AND sku = ANY(${skus})`) as {
      sku: string;
      name: string;
      price: number;
      wholesale_price: number | null;
    }[];
    const bySku = new Map(rows.map((r) => [r.sku, r]));

    const missing = skus.filter((s) => !bySku.has(s));
    if (missing.length > 0) {
      return {
        ok: false,
        message:
          "Something in the basket is no longer available. Please ask for help at the counter.",
      };
    }

    const priced = lines.map((l) => {
      const p = bySku.get(l.sku)!;
      const unit =
        customer.is_wholesale && p.wholesale_price && p.wholesale_price > 0
          ? p.wholesale_price
          : p.price;
      return { sku: l.sku, description: p.name, qty: Math.round(l.qty), unit_price: unit };
    });

    const shopRate = await getTaxRate();
    const rate = customer.tax_rate ?? shopRate;
    const subtotal = round2(priced.reduce((s, l) => s + l.qty * l.unit_price, 0));
    const tax = customer.is_wholesale ? 0 : round2(subtotal * rate);
    const beforeCredit = round2(subtotal + tax);

    if (beforeCredit > MAX_TOTAL) {
      return { ok: false, message: "That's a large order — please check out at the counter." };
    }

    const credit =
      input.useCredit && customer.credit > 0
        ? round2(Math.min(customer.credit, beforeCredit))
        : 0;
    const total = round2(Math.max(0, beforeCredit - credit));

    const payment = (["cash", "check", "venmo", "invoice"] as const).includes(input.payment)
      ? input.payment
      : "cash";
    const status = payment === "invoice" ? "pending" : "paid";

    const invoiceId = await recordSale({
      customerId: customer.id,
      lines: priced,
      payment: payment as PaymentMethod,
      status,
      tax,
      creditApplied: credit,
      isWholesale: customer.is_wholesale,
      termsDays: customer.is_wholesale ? 30 : 0,
    });

    revalidatePath("/admin");
    revalidatePath(`/admin/customers/${customer.id}`);
    revalidatePath("/kiosk");

    return {
      ok: true,
      message:
        status === "pending"
          ? `Invoice #${invoiceId} — we'll send it to you.`
          : `Order #${invoiceId}`,
      invoiceId,
      token: receiptToken(invoiceId),
      total,
      customerName: customer.name,
      customerEmail: customer.email,
    };
  } catch (e) {
    return { ok: false, message: explain(e) };
  }
}

/** A customer signing themselves up at the kiosk. */
export async function kioskJoin(input: {
  name: string;
  email?: string;
  phone?: string;
}): Promise<{ ok: boolean; message: string; id?: string; name?: string }> {
  try {
    const name = String(input.name ?? "").trim().slice(0, 120);
    if (name.length < 2) return { ok: false, message: "Please enter your name." };
    const email = String(input.email ?? "").trim().slice(0, 160);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, message: "That email address doesn't look right." };
    }
    // Someone tapping "that's me" twice shouldn't create two of themselves. An
    // exact name match with no purchases yet is reused instead.
    const existing = (await sql`
      SELECT c.id FROM customers c
       WHERE lower(btrim(c.name)) = lower(btrim(${name}))
         AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.id)
       LIMIT 1`) as { id: string }[];
    if (existing.length > 0) {
      if (email) {
        await sql`UPDATE customers SET email = COALESCE(email, ${email}) WHERE id = ${existing[0].id}`;
      }
      return { ok: true, message: `Welcome back, ${name}.`, id: existing[0].id, name };
    }

    const rows = await sql`
      INSERT INTO customers (id, name, email, phone, joined_on)
      VALUES ('C-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
              ${name}, NULLIF(${email}, ''), NULLIF(${String(input.phone ?? "").trim().slice(0, 40)}, ''),
              (now() AT TIME ZONE 'America/Los_Angeles')::date)
      RETURNING id, name`;
    revalidatePath("/admin/customers");
    return { ok: true, message: `Welcome, ${name}.`, id: rows[0].id as string, name };
  } catch (e) {
    return { ok: false, message: explain(e) };
  }
}

/**
 * The kiosk's customer search runs on the server rather than shipping 226
 * names, phone numbers and email addresses to a screen anyone in the shop can
 * read. Two characters minimum, ten results, name only.
 */
export type KioskCustomer = {
  id: string;
  name: string;
  is_wholesale: boolean;
  credit: number;
  tax_rate: number | null;
};

/**
 * Each word has to appear somewhere in the name, rather than the whole thing
 * appearing as one run of characters.
 *
 * 207 of the 227 names in the book are filed "Flory, Claudia". Claudia types
 * "Claudia Flory", because that is her name — and a plain substring match
 * found nobody, and then offered to add her as a second account. Matching word
 * by word means either order works, and so does a middle name she has and the
 * book doesn't.
 */
export async function kioskFindCustomers(query: string): Promise<KioskCustomer[]> {
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (terms.length === 0) return [];
  const patterns = terms.map((t) => `%${t}%`);
  const rows = await sql`
    SELECT id, name, is_wholesale, credit::float8 AS credit, tax_rate::float8 AS tax_rate
      FROM customers
     WHERE name ILIKE ALL(${patterns}::text[])
     ORDER BY (lower(name) LIKE ${terms[0] + "%"}) DESC, name
     LIMIT 10`;
  return rows as KioskCustomer[];
}

export async function kioskEmailReceipt(
  invoiceId: number,
  token: string,
  to: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const { validReceiptToken } = await import("@/lib/receipt-token");
    if (!validReceiptToken(invoiceId, token)) {
      return { ok: false, message: "That receipt link has expired. Please ask at the counter." };
    }
    const address = to.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      return { ok: false, message: "That email address doesn't look right." };
    }
    if (!(await mailConfigured())) {
      return { ok: false, message: "Emailed receipts aren't switched on yet — please ask at the counter." };
    }

    const [invoice, lines, settings] = await Promise.all([
      getInvoice(invoiceId),
      getInvoiceLines(invoiceId),
      getSettings(),
    ]);
    if (!invoice) return { ok: false, message: "We couldn't find that order." };
    const customer = invoice.customer_id ? await getCustomer(invoice.customer_id) : null;

    const pdf = await buildInvoicePdf({
      invoice,
      lines,
      company: {
        name: settings.CompanyName || "Notion to Sew",
        address: settings.Address || "",
      },
      customer: {
        name: customer?.name ?? "Guest",
        address: customer?.address,
        email: customer?.email,
      },
    });

    await sendReceipt({
      to: address,
      invoiceId,
      pdf,
      companyName: settings.CompanyName || "Notion to Sew",
      total: money(invoice.total),
      paid: invoice.status === "paid",
      source: "kiosk",
    });
    return { ok: true, message: `Sent to ${address}.` };
  } catch (e) {
    return { ok: false, message: explain(e) };
  }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

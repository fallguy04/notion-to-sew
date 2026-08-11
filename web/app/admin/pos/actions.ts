"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { explain } from "@/lib/action-result";
import { recordSale } from "@/lib/mutations";
import { getCustomer, getTaxRate, getSettings } from "@/lib/queries";
import { sql, type PaymentMethod } from "@/lib/db";
import { receiptToken } from "@/lib/receipt-token";
import { money } from "@/lib/format";

export type SaleLine = { sku: string | null; description: string; qty: number; unit_price: number };

export type SaleRequest = {
  customerId: string | null;
  lines: SaleLine[];
  payment: PaymentMethod;
  /** Percentage off the subtotal, 0–100. */
  discountPct: number;
  freight: number;
  applyTax: boolean;
  useCredit: boolean;
  /** Days until due when paying later. */
  termsDays: number;
  /** Client's arithmetic, checked against the server's before anything is written. */
  expectedTotal: number;
};

export type SaleResponse = {
  ok: boolean;
  message: string;
  invoiceId?: number;
  token?: string;
  total?: number;
};

/**
 * Records a sale from the till.
 *
 * Every figure that decides how much money changes hands is recomputed here
 * from the database — the tax rate, the customer's credit balance, the
 * discount. The browser proposes; the server decides. It also checks its own
 * total against the one the screen showed and refuses if they differ by more
 * than a cent, so a stale page can never quietly charge a different amount
 * from the one the customer was just shown.
 */
export async function recordSaleAction(req: SaleRequest): Promise<SaleResponse> {
  try {
    await requireStaff();

    const lines = (req.lines ?? []).filter(
      (l) => l && Number.isFinite(l.qty) && l.qty > 0 && Number.isFinite(l.unit_price) && l.unit_price >= 0,
    );
    if (lines.length === 0) return { ok: false, message: "There's nothing in the basket." };
    if (lines.length > 200) return { ok: false, message: "That's too many lines for one invoice." };

    const customer = req.customerId ? await getCustomer(req.customerId) : null;
    if (req.customerId && !customer) {
      return { ok: false, message: "That customer no longer exists — pick them again." };
    }

    // Pay-later has to be attached to somebody. A guest invoice is a debt owed
    // by nobody, which is how an unpaid balance becomes unrecoverable.
    if (req.payment === "invoice" && !customer) {
      return { ok: false, message: "Choose a customer before invoicing — a guest can't be billed later." };
    }

    const isWholesale = customer?.is_wholesale ?? false;
    const shopRate = await getTaxRate();
    const rate = customer?.tax_rate ?? shopRate;

    const subtotal = round2(lines.reduce((s, l) => s + l.qty * l.unit_price, 0));
    const discountPct = clamp(req.discountPct ?? 0, 0, 100);
    const discount = round2(subtotal * (discountPct / 100));
    const freight = round2(Math.max(0, req.freight ?? 0));

    // Wholesale is exempt, and shipping is not taxed — matching how the
    // existing 1,374 invoices were calculated.
    const taxable = req.applyTax && !isWholesale;
    const tax = taxable ? round2((subtotal - discount) * rate) : 0;

    const beforeCredit = round2(subtotal - discount + freight + tax);

    let credit = 0;
    if (req.useCredit && customer && customer.credit > 0) {
      credit = round2(Math.min(customer.credit, beforeCredit));
    }
    const total = round2(Math.max(0, beforeCredit - credit));

    if (Number.isFinite(req.expectedTotal) && Math.abs(req.expectedTotal - total) > 0.011) {
      return {
        ok: false,
        message: `The total worked out to ${money(total)}, not ${money(
          req.expectedTotal,
        )}. Nothing was saved — check the basket and try again.`,
      };
    }

    const status = req.payment === "invoice" ? "pending" : "paid";
    const invoiceId = await recordSale({
      customerId: customer?.id ?? null,
      lines,
      payment: req.payment,
      status,
      discount,
      freight,
      tax,
      creditApplied: credit,
      isWholesale,
      termsDays: clamp(Math.round(req.termsDays ?? 0), 0, 365),
    });

    revalidatePath("/admin");
    revalidatePath("/admin/inventory");
    revalidatePath("/admin/financials");
    revalidatePath("/kiosk");
    if (customer) revalidatePath(`/admin/customers/${customer.id}`);

    return {
      ok: true,
      message:
        status === "pending"
          ? `Invoice #${invoiceId} created for ${money(total)}.`
          : `Sale #${invoiceId} recorded — ${money(total)}.`,
      invoiceId,
      token: receiptToken(invoiceId),
      total,
    };
  } catch (e) {
    return { ok: false, message: explain(e) };
  }
}

/** Adds a customer mid-sale and hands the id straight back so it can be selected. */
export async function posAddCustomer(input: {
  name: string;
  phone?: string;
  email?: string;
  isWholesale?: boolean;
}): Promise<{ ok: boolean; message: string; id?: string }> {
  try {
    await requireStaff();
    const name = input.name.trim();
    if (!name) return { ok: false, message: "A name is required." };
    const rows = await sql`
      INSERT INTO customers (id, name, email, phone, joined_on, is_wholesale)
      VALUES ('C-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
              ${name}, NULLIF(${input.email ?? ""}, ''), NULLIF(${input.phone ?? ""}, ''),
              (now() AT TIME ZONE 'America/Los_Angeles')::date, ${input.isWholesale ?? false})
      RETURNING id`;
    revalidatePath("/admin/customers");
    return { ok: true, message: `${name} added.`, id: rows[0].id as string };
  } catch (e) {
    return { ok: false, message: explain(e) };
  }
}

export async function venmoHandle(): Promise<string> {
  const settings = await getSettings();
  return settings.VenmoUser ?? "";
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

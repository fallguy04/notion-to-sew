"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { ok, fail, explain, type ActionResult } from "@/lib/action-result";
import { markInvoicePaid, deleteInvoice, addFreight, recordReturn } from "@/lib/mutations";
import {
  getInvoice,
  getInvoiceLines,
  getSettings,
  getCustomer,
  getReturns,
  returnedSoFar,
} from "@/lib/queries";
import { buildInvoicePdf } from "@/lib/pdf";
import { sendReceipt, mailConfigured } from "@/lib/mail";
import { money } from "@/lib/format";
import type { PaymentMethod } from "@/lib/db";

/**
 * Invoice actions, shared by the dashboard, the customer profile, the invoice
 * page and the receivables list. One implementation means "mark paid" behaves
 * the same everywhere — in the old app each screen had its own copy.
 */

function touch(customerId?: string | null) {
  revalidatePath("/admin");
  revalidatePath("/admin/financials");
  if (customerId) revalidatePath(`/admin/customers/${customerId}`);
}

export async function markPaidAction(
  id: number,
  payment?: PaymentMethod,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const invoice = await getInvoice(id);
    if (!invoice) return fail("That invoice no longer exists.");
    if (invoice.status === "paid") return ok("That one was already marked paid.");
    const done = await markInvoicePaid(id, payment);
    if (!done) return fail("Couldn't mark it paid.");
    touch(invoice.customer_id);
    revalidatePath(`/admin/invoices/${id}`);
    return ok(`Invoice #${id} marked paid — ${money(invoice.total)}.`);
  } catch (e) {
    return fail(explain(e));
  }
}

export async function deleteInvoiceAction(id: number): Promise<ActionResult> {
  try {
    await requireStaff();
    const invoice = await getInvoice(id);
    if (!invoice) return fail("That invoice no longer exists.");

    // Deleting the sale out from under a return would leave the return
    // pointing at nothing, reading as a sale of minus one thread.
    const returns = await getReturns(id);
    if (returns.length > 0) {
      return fail(
        `There's a return against this sale (#${returns.map((r) => r.id).join(", #")}). ` +
          "Delete the return first, then this.",
      );
    }

    await deleteInvoice(id);
    touch(invoice.customer_id);
    revalidatePath("/admin/inventory");
    return ok(`Invoice #${id} deleted. Stock and store credit were put back.`);
  } catch (e) {
    return fail(explain(e));
  }
}

export async function addFreightAction(id: number, amount: number): Promise<ActionResult> {
  try {
    await requireStaff();
    if (!(amount > 0)) return fail("Enter a shipping amount greater than zero.");
    const invoice = await getInvoice(id);
    if (!invoice) return fail("That invoice no longer exists.");
    await addFreight(id, amount);
    touch(invoice.customer_id);
    revalidatePath(`/admin/invoices/${id}`);
    return ok(`Added ${money(amount)} of shipping.`);
  } catch (e) {
    return fail(explain(e));
  }
}

export async function emailInvoiceAction(
  id: number,
  to: string,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const address = to.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      return fail("That doesn't look like an email address.");
    }
    if (!(await mailConfigured())) {
      return fail("Email isn't set up yet — add a Gmail app password in Settings first.");
    }

    const [invoice, lines, settings] = await Promise.all([
      getInvoice(id),
      getInvoiceLines(id),
      getSettings(),
    ]);
    if (!invoice) return fail("That invoice no longer exists.");
    const customer = invoice.customer_id ? await getCustomer(invoice.customer_id) : null;

    const pdf = await buildInvoicePdf({
      invoice,
      lines,
      company: {
        name: settings.CompanyName || "Notion to Sew",
        address: settings.Address || "",
      },
      customer: {
        name: customer?.name ?? invoice.customer_name ?? "Guest",
        address: customer?.address,
        email: customer?.email,
      },
    });

    await sendReceipt({
      to: address,
      invoiceId: id,
      pdf,
      companyName: settings.CompanyName || "Notion to Sew",
      total: money(invoice.total),
      paid: invoice.status === "paid",
      source: "admin",
    });
    return ok(`Sent to ${address}.`);
  } catch (e) {
    return fail(explain(e));
  }
}

/**
 * Puts a name on an invoice that was rung up as a guest — or corrects one filed
 * against the wrong person.
 *
 * Only the attribution moves. The money has already changed hands, so prices,
 * tax and totals stay exactly as they were recorded; re-pricing a settled sale
 * against a wholesale account would quietly rewrite history.
 */
export async function assignCustomerAction(
  invoiceId: number,
  customerId: string | null,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const invoice = await getInvoice(invoiceId);
    if (!invoice) return fail("That invoice no longer exists.");

    const previous = invoice.customer_id;
    const { sql } = await import("@/lib/db");

    if (customerId) {
      const rows = (await sql`SELECT name FROM customers WHERE id = ${customerId}`) as {
        name: string;
      }[];
      if (rows.length === 0) return fail("That customer no longer exists.");
      await sql`UPDATE invoices SET customer_id = ${customerId} WHERE id = ${invoiceId}`;
      revalidatePath(`/admin/customers/${customerId}`);
      if (previous) revalidatePath(`/admin/customers/${previous}`);
      touch(customerId);
      revalidatePath(`/admin/invoices/${invoiceId}`);
      return ok(`Invoice #${invoiceId} is now filed under ${rows[0].name}.`);
    }

    await sql`UPDATE invoices SET customer_id = NULL WHERE id = ${invoiceId}`;
    if (previous) revalidatePath(`/admin/customers/${previous}`);
    touch(previous);
    revalidatePath(`/admin/invoices/${invoiceId}`);
    return ok(`Invoice #${invoiceId} is no longer attached to anyone.`);
  } catch (e) {
    return fail(explain(e));
  }
}

/**
 * Records a return against a sale.
 *
 * The prices come from the original invoice, never from the browser — a refund
 * is money leaving the till, and it should only ever be for what was actually
 * charged. Quantities are capped at what was bought, less anything already
 * brought back.
 */
export async function recordReturnAction(input: {
  invoiceId: number;
  lines: { lineId: number; qty: number }[];
  refund: "cash" | "check" | "card" | "venmo" | "credit";
}): Promise<ActionResult> {
  try {
    await requireStaff();
    const original = await getInvoice(input.invoiceId);
    if (!original) return fail("That invoice no longer exists.");
    if (original.returns_id) return fail("That's already a return — you can't return a return.");

    const [lines, already] = await Promise.all([
      getInvoiceLines(input.invoiceId),
      returnedSoFar(input.invoiceId),
    ]);

    const chosen: { sku: string | null; description: string; qty: number; unit_price: number }[] = [];
    for (const want of input.lines ?? []) {
      const line = lines.find((l) => l.id === want.lineId);
      if (!line) continue;
      const qty = Math.abs(Number(want.qty) || 0);
      if (qty <= 0) continue;

      const done = already.get(`${line.sku ?? ""}|${line.description}`) ?? 0;
      const left = round2(line.qty - done);
      if (qty > left + 0.001) {
        return fail(
          left <= 0
            ? `${line.description} has already been returned in full.`
            : `Only ${trim(left)} of ${line.description} left to return.`,
        );
      }
      chosen.push({
        sku: line.sku,
        description: line.description,
        qty,
        unit_price: line.unit_price,
      });
    }

    if (chosen.length === 0) return fail("Choose at least one thing to give back.");

    // At the rate this invoice actually charged, not today's.
    const goods = round2(chosen.reduce((s, l) => s + l.qty * l.unit_price, 0));
    const rate = original.subtotal > 0 ? original.tax / original.subtotal : 0;
    const tax = round2(goods * rate);

    const returnId = await recordReturn({
      originalId: input.invoiceId,
      customerId: original.customer_id,
      lines: chosen,
      refund: input.refund,
      tax,
    });

    touch(original.customer_id);
    revalidatePath(`/admin/invoices/${input.invoiceId}`);
    revalidatePath("/admin/inventory");

    const back = money(round2(goods + tax));
    return ok(
      input.refund === "credit"
        ? `Return #${returnId} recorded — ${back} added to their store credit.`
        : `Return #${returnId} recorded — ${back} back by ${input.refund}.`,
    );
  } catch (e) {
    return fail(explain(e));
  }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

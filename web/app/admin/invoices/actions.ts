"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { ok, fail, explain, type ActionResult } from "@/lib/action-result";
import { markInvoicePaid, deleteInvoice, addFreight } from "@/lib/mutations";
import { getInvoice, getInvoiceLines, getSettings, getCustomer } from "@/lib/queries";
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

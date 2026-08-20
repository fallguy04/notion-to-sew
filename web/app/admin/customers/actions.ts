"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { ok, fail, explain, multiline, type ActionResult } from "@/lib/action-result";
import {
  addCustomer,
  updateCustomer,
  deleteCustomer,
  sellGiftCertificate,
  adjustCredit,
  payOutCredit,
} from "@/lib/mutations";
import { getCustomer } from "@/lib/queries";
import { today } from "@/lib/format";
import type { PaymentMethod } from "@/lib/db";

const num = (v: FormDataEntryValue | null) => {
  const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export async function createCustomerAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const name = String(form.get("name") ?? "").trim();
    if (!name) return fail("A name is required.");
    await addCustomer({
      name,
      email: String(form.get("email") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      isWholesale: form.get("is_wholesale") === "on",
    });
    revalidatePath("/admin/customers");
    revalidatePath("/admin/pos");
    return ok(`${name} added.`);
  } catch (e) {
    return fail(explain(e));
  }
}

/**
 * The same thing, for callers that need the new id back so they can select the
 * customer they just typed in — the point of sale, and the kiosk. Handing back
 * the name instead is what made a sale land on the wrong namesake.
 */
export async function quickAddCustomer(input: {
  name: string;
  email?: string;
  phone?: string;
}): Promise<{ ok: boolean; message: string; id?: string }> {
  try {
    await requireStaff();
    const name = input.name.trim();
    if (!name) return { ok: false, message: "A name is required." };
    const id = await addCustomer({ name, email: input.email, phone: input.phone });
    revalidatePath("/admin/customers");
    return { ok: true, message: `${name} added.`, id };
  } catch (e) {
    return { ok: false, message: explain(e) };
  }
}

export async function saveCustomerAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const id = String(form.get("id") ?? "");
    const name = String(form.get("name") ?? "").trim();
    if (!id) return fail("Missing customer.");
    if (!name) return fail("A name is required.");

    // Entered as a percentage because that is how a tax rate is written down.
    // Zero means "use the shop-wide rate", which is why it stores as NULL
    // rather than as an override of 0%.
    const ratePct = num(form.get("tax_rate"));
    const taxRate = ratePct > 0 ? Math.min(ratePct, 100) / 100 : null;

    const done = await updateCustomer(id, {
      name,
      email: String(form.get("email") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
      address: multiline(form.get("address")),
      notes: multiline(form.get("notes")),
      isWholesale: form.get("is_wholesale") === "on",
      taxRate,
    });
    if (!done) return fail("That customer no longer exists.");

    revalidatePath("/admin/customers");
    revalidatePath(`/admin/customers/${id}`);
    revalidatePath("/admin/pos");
    return ok("Saved.");
  } catch (e) {
    return fail(explain(e));
  }
}

export async function deleteCustomerAction(id: string): Promise<ActionResult> {
  try {
    await requireStaff();
    const done = await deleteCustomer(id);
    if (!done) return fail("That customer no longer exists.");
    revalidatePath("/admin/customers");
    return ok("Customer deleted.");
  } catch (e) {
    return fail(explain(e));
  }
}

export async function addCreditAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const recipientId = String(form.get("recipient_id") ?? "");
    const amount = num(form.get("amount"));
    if (!recipientId) return fail("Missing customer.");
    if (amount <= 0) return fail("Enter an amount greater than zero.");

    const buyerId = String(form.get("buyer_id") ?? "") || recipientId;
    const mode = String(form.get("mode") ?? "sold");

    if (mode === "adjust") {
      // A correction, not a sale: no invoice, no money changing hands.
      await adjustCredit(recipientId, amount);
      revalidatePath(`/admin/customers/${recipientId}`);
      return ok(`Added ${fmt(amount)} of credit.`);
    }

    if (mode === "payout") {
      // Money out of the drawer against a balance the customer already held.
      const customer = await getCustomer(recipientId);
      if (!customer) return fail("That customer no longer exists.");
      if (customer.credit <= 0) return fail("There's no credit on this account to pay out.");
      if (amount > customer.credit + 0.001) {
        return fail(
          `That's more than they have. The balance is ${fmt(customer.credit)}.`,
        );
      }
      const method = (String(form.get("payment") ?? "cash") as PaymentMethod) || "cash";
      await payOutCredit({
        customerId: recipientId,
        customerName: customer.name,
        amount,
        method,
        spentOn: String(form.get("spent_on") || "") || today(),
      });
      revalidatePath(`/admin/customers/${recipientId}`);
      revalidatePath("/admin");
      revalidatePath("/admin/financials");
      const left = round2(customer.credit - amount);
      return ok(
        left > 0
          ? `Paid out ${fmt(amount)}. ${fmt(left)} of credit left.`
          : `Paid out ${fmt(amount)}. Their credit is now zero, and it's on the books as an expense.`,
      );
    }

    const payment = (String(form.get("payment") ?? "cash") as PaymentMethod) || "cash";
    const invoiceId = await sellGiftCertificate({
      buyerId,
      recipientId,
      amount,
      payment,
    });
    revalidatePath(`/admin/customers/${recipientId}`);
    revalidatePath(`/admin/customers/${buyerId}`);
    revalidatePath("/admin");
    return ok(`Recorded as invoice #${invoiceId} and added ${fmt(amount)} of credit.`);
  } catch (e) {
    return fail(explain(e));
  }
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

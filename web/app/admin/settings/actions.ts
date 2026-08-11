"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { ok, fail, explain, multiline, type ActionResult } from "@/lib/action-result";
import { updateSettings, tidyInvoiceSequence } from "@/lib/mutations";

export async function saveSettingsAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();

    const name = String(form.get("company_name") ?? "").trim();
    if (!name) return fail("The shop needs a name — it goes on every invoice.");

    const payable = String(form.get("payable_to") ?? "").trim();
    if (!payable) return fail("Say who cheques should be made out to.");

    // Entered as a percentage, stored as a decimal. The old settings screen
    // stored whichever the box happened to contain, so the same field meant
    // 7.875% on one save and 787.5% on the next.
    const ratePct = parseFloat(String(form.get("tax_rate") ?? "").replace("%", "").trim());
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 99) {
      return fail("Enter the tax rate as a percentage between 0 and 99 — for example 7.875.");
    }

    const categories = String(form.get("expense_categories") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (categories.length === 0) {
      return fail("Keep at least one expense category.");
    }

    await updateSettings({
      CompanyName: name,
      PayableTo: payable,
      Address: multiline(form.get("address")),
      TaxRate: String(ratePct / 100),
      VenmoUser: String(form.get("venmo_user") ?? "").trim().replace(/^@/, ""),
      ExpenseCategories: categories.join(", "),
      RequireCustomer: form.get("require_customer") === "on" ? "true" : "false",
    });

    revalidatePath("/admin/settings");
    revalidatePath("/admin/pos");
    revalidatePath("/admin/financials");
    revalidatePath("/kiosk");
    return ok("Settings saved.");
  } catch (e) {
    return fail(explain(e));
  }
}

export async function tidySequenceAction(): Promise<ActionResult> {
  try {
    await requireStaff();
    const next = await tidyInvoiceSequence();
    revalidatePath("/admin/settings");
    return ok(`The next invoice will be number ${next}.`);
  } catch (e) {
    return fail(explain(e));
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { ok, fail, explain, type ActionResult } from "@/lib/action-result";
import { addExpense, deleteExpense, setExpenseAmount } from "@/lib/mutations";
import { money } from "@/lib/format";

export async function addExpenseAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const amount = parseFloat(String(form.get("amount") ?? "").replace(/[$,\s]/g, ""));
    const category = String(form.get("category") ?? "").trim();
    const spentOn = String(form.get("spent_on") ?? "").trim();

    if (!Number.isFinite(amount) || amount <= 0) return fail("Enter an amount greater than zero.");
    if (!category) return fail("Pick a category.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn)) return fail("Pick a date.");

    await addExpense({
      spentOn,
      category,
      amount,
      description: String(form.get("description") ?? "").trim(),
    });
    revalidatePath("/admin/financials");
    revalidatePath("/admin");
    return ok(`Logged ${money(amount)} under ${category}.`);
  } catch (e) {
    return fail(explain(e));
  }
}

export async function deleteExpenseAction(id: number): Promise<ActionResult> {
  try {
    await requireStaff();
    const done = await deleteExpense(id);
    if (!done) return fail("That expense is already gone.");
    revalidatePath("/admin/financials");
    return ok("Expense removed.");
  } catch (e) {
    return fail(explain(e));
  }
}

/**
 * Fills in the amount on one of the imported vendor payments.
 *
 * Only ever fills a blank — an expense that already carries a figure is left
 * alone, so a stray keystroke on a settled row cannot quietly rewrite it.
 */
export async function setExpenseAmountAction(
  id: number,
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const amount = parseFloat(String(form.get("amount") ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      return fail("Enter an amount greater than zero.");
    }
    const done = await setExpenseAmount(id, amount);
    if (!done) {
      return fail("That one already has an amount on it — remove it and log it again to change it.");
    }
    revalidatePath("/admin/financials");
    revalidatePath("/admin");
    return ok(`Recorded ${money(amount)}.`);
  } catch (e) {
    return fail(explain(e));
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { ok, fail, explain, type ActionResult } from "@/lib/action-result";
import { addExpense, deleteExpense } from "@/lib/mutations";
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

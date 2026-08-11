"use client";

import { useActionState, useEffect, useRef } from "react";
import { Field } from "@/components/ui";
import { Submit, Result } from "@/components/form";
import { isoDate } from "@/lib/format";
import { addExpenseAction } from "./actions";

export default function ExpenseForm({ categories }: { categories: string[] }) {
  const [result, action] = useActionState(addExpenseAction, null);
  const ref = useRef<HTMLFormElement>(null);

  // Clear the amount and description but keep the date and category — the next
  // expense is usually the next receipt in the same pile.
  useEffect(() => {
    if (result?.ok) {
      const form = ref.current;
      if (!form) return;
      (form.elements.namedItem("amount") as HTMLInputElement).value = "";
      (form.elements.namedItem("description") as HTMLInputElement).value = "";
      (form.elements.namedItem("amount") as HTMLInputElement).focus();
    }
  }, [result]);

  return (
    <form ref={ref} action={action} className="px-5 py-5">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Date">
          <input
            type="date"
            name="spent_on"
            defaultValue={isoDate(new Date())}
            required
            className="field"
          />
        </Field>
        <Field label="Category">
          <select name="category" className="field" defaultValue={categories[0]}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint">
              $
            </span>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              required
              className="field pl-7"
            />
          </div>
        </Field>
        <Field label="What was it for" hint="Optional.">
          <input name="description" placeholder="e.g. thread from JoAnn" className="field" />
        </Field>
      </div>

      <Result result={result} />

      <div className="mt-4 flex justify-end">
        <Submit pendingLabel="Saving…">Log expense</Submit>
      </div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { Submit } from "@/components/form";
import { setExpenseAmountAction } from "./actions";

/**
 * The missing figure on an imported vendor payment.
 *
 * 34 of these came over from the spreadsheet with a supplier and a date but a
 * blank amount — the old sheet had a column for it that nobody filled in. The
 * number exists only on a cheque stub or a bank statement, so the row stays
 * where it is and offers somewhere to type it rather than being guessed at or
 * quietly deleted.
 */
export default function AmountBox({ id }: { id: number }) {
  const [result, action] = useActionState(setExpenseAmountAction.bind(null, id), null);

  if (result?.ok) {
    return <span className="text-[13px] text-spruce">{result.message}</span>;
  }

  return (
    <form action={action} className="flex items-center justify-end gap-1.5">
      <span className="relative">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">
          $
        </span>
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="0.00"
          required
          aria-label={`Amount for expense ${id}`}
          className="no-spin tabular h-9 w-24 rounded-lg border border-line bg-surface pl-5 pr-1.5 text-right text-[14px]"
        />
      </span>
      <Submit className="btn btn-quiet btn-sm" pendingLabel="…">
        Save
      </Submit>
      {result && !result.ok && (
        <span className="text-[12px] text-clay">{result.message}</span>
      )}
    </form>
  );
}

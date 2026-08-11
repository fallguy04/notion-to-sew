"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Modal from "@/components/modal";
import { Spinner } from "@/components/form";
import { useToast } from "@/components/toast";
import { money, unitPrice } from "@/lib/format";
import type { InvoiceLine } from "@/lib/db";
import { recordReturnAction } from "../actions";

type Refund = "cash" | "check" | "card" | "venmo" | "credit";

const REFUNDS: { value: Refund; label: string }[] = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
  { value: "venmo", label: "Venmo" },
  { value: "credit", label: "Store credit" },
];

/**
 * Taking something back.
 *
 * Virginia Skiles bought five serger threads and brought one back, and there
 * was no way to say so — the only options were deleting a sale that really did
 * happen or leaving the books wrong. This records the return as its own small
 * invoice against the original, so the thread goes back on the shelf, the
 * sales tax comes back off, and her history shows both halves of what happened.
 *
 * Prices are never sent from here. The screen shows what she paid so the
 * refund is checkable at the counter, but the server reads the real numbers off
 * the original invoice before it gives any money back.
 */
export default function ReturnItems({
  invoiceId,
  lines,
  alreadyReturned,
  taxRate,
  hasCustomer,
}: {
  invoiceId: number;
  lines: InvoiceLine[];
  /** Keyed `sku|description`, matching what the server counts. */
  alreadyReturned: Record<string, number>;
  /** The rate this invoice actually charged, not today's. */
  taxRate: number;
  hasCustomer: boolean;
}) {
  const [open, setOpen] = useState(false);

  const remaining = lines.map((l) => ({
    line: l,
    left: round2(l.qty - (alreadyReturned[`${l.sku ?? ""}|${l.description}`] ?? 0)),
  }));
  const returnable = remaining.filter((r) => r.left > 0.001);
  if (returnable.length === 0) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm">
        Return items
      </button>

      {open && (
        <Dialog
          invoiceId={invoiceId}
          rows={returnable}
          taxRate={taxRate}
          hasCustomer={hasCustomer}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function Dialog({
  invoiceId,
  rows,
  taxRate,
  hasCustomer,
  onClose,
}: {
  invoiceId: number;
  rows: { line: InvoiceLine; left: number }[];
  taxRate: number;
  hasCustomer: boolean;
  onClose: () => void;
}) {
  const [qty, setQty] = useState<Record<number, number>>({});
  const [refund, setRefund] = useState<Refund>("cash");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const chosen = rows
    .map((r) => ({ ...r, want: qty[r.line.id] ?? 0 }))
    .filter((r) => r.want > 0);
  const goods = round2(chosen.reduce((s, r) => s + r.want * r.line.unit_price, 0));
  const tax = round2(goods * taxRate);
  const back = round2(goods + tax);

  function set(id: number, want: number, max: number) {
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, want)) }));
  }

  function submit() {
    start(async () => {
      const res = await recordReturnAction({
        invoiceId,
        lines: chosen.map((r) => ({ lineId: r.line.id, qty: r.want })),
        refund,
      });
      toast(res!.message, res!.ok ? "good" : "bad");
      if (res!.ok) {
        onClose();
        router.refresh();
      }
    });
  }

  return (
    <Modal onClose={onClose} labelledBy="return-title">
      <div className="pop flex max-h-[88vh] w-[min(94vw,520px)] flex-col rounded-2xl border border-line bg-surface shadow-[var(--shadow-float)]">
        <div className="border-b border-line-soft px-6 pb-4 pt-6">
          <h2 id="return-title" className="font-display text-[20px] font-semibold">
            Return from #{invoiceId}
          </h2>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-faint">
            How many of each is coming back? Anything you leave at zero stays sold.
          </p>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-line-soft overflow-y-auto px-6">
          {rows.map(({ line, left }) => {
            const want = qty[line.id] ?? 0;
            return (
              <li key={line.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-medium">
                    {line.description}
                  </span>
                  <span className="block text-[12px] text-ink-faint">
                    {unitPrice(line.unit_price)} each · {trim(left)} to return
                  </span>
                </span>

                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`One fewer ${line.description}`}
                    onClick={() => set(line.id, want - 1, left)}
                    disabled={want <= 0}
                    className="tap flex h-9 w-9 items-center justify-center rounded-lg border border-line text-[18px] leading-none disabled:opacity-35"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={left}
                    step="1"
                    value={want === 0 ? "" : trim(want)}
                    placeholder="0"
                    aria-label={`How many ${line.description} to return`}
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => set(line.id, parseFloat(e.target.value) || 0, left)}
                    className="no-spin tabular h-9 w-16 rounded-lg border border-line bg-surface text-center text-[15px]"
                  />
                  <button
                    type="button"
                    aria-label={`One more ${line.description}`}
                    onClick={() => set(line.id, want + 1, left)}
                    disabled={want >= left}
                    className="tap flex h-9 w-9 items-center justify-center rounded-lg border border-line text-[18px] leading-none disabled:opacity-35"
                  >
                    +
                  </button>
                </span>

                <button
                  type="button"
                  onClick={() => set(line.id, want >= left ? 0 : left, left)}
                  className="btn btn-quiet btn-sm w-14 shrink-0 text-ink-faint"
                >
                  {want >= left ? "None" : "All"}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="border-t border-line-soft px-6 pb-6 pt-4">
          <div className="label">Money goes back as</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {REFUNDS.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={refund === r.value}
                disabled={r.value === "credit" && !hasCustomer}
                title={
                  r.value === "credit" && !hasCustomer
                    ? "Store credit needs a name on the sale"
                    : undefined
                }
                onClick={() => setRefund(r.value)}
                className={`btn btn-sm ${
                  refund === r.value ? "btn-primary" : "btn-ghost"
                } disabled:opacity-35`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <dl className="mt-4 text-[14px]">
            <div className="flex items-baseline justify-between py-0.5">
              <dt className="text-ink-soft">Goods</dt>
              <dd className="tabular">{money(goods)}</dd>
            </div>
            {tax > 0 && (
              <div className="flex items-baseline justify-between py-0.5">
                <dt className="text-ink-soft">Sales tax</dt>
                <dd className="tabular">{money(tax)}</dd>
              </div>
            )}
            <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-2">
              <dt className="font-display text-[15px] font-semibold">Give back</dt>
              <dd className="tabular font-display text-[20px] font-semibold">{money(back)}</dd>
            </div>
          </dl>

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || chosen.length === 0}
              onClick={submit}
            >
              {pending && <Spinner />}
              {chosen.length === 0 ? "Nothing selected" : `Give back ${money(back)}`}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

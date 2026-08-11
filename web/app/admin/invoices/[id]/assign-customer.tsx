"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CustomerLite } from "@/lib/db";
import Modal from "@/components/modal";
import CustomerPicker from "@/components/customer-picker";
import { Spinner } from "@/components/form";
import { useToast } from "@/components/toast";
import { assignCustomerAction } from "../actions";

/**
 * Puts a name on a sale after the fact.
 *
 * Six invoices in the book are filed against nobody — someone forgot their
 * name at the counter — and until now there was no way to fix that short of
 * deleting the sale and ringing it up again. This just moves the attribution.
 */
export default function AssignCustomer({
  invoiceId,
  customers,
  current,
}: {
  invoiceId: number;
  customers: CustomerLite[];
  current: { id: string; name: string } | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  function assign(customerId: string | null) {
    start(async () => {
      const res = await assignCustomerAction(invoiceId, customerId);
      toast(res!.message, res!.ok ? "good" : "bad");
      if (res!.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn btn-ghost btn-sm">
        {current ? "Change customer" : "Put a name on this"}
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} labelledBy="assign-title">
          <div className="pop w-[min(92vw,460px)] overflow-visible rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]">
            <h2 id="assign-title" className="font-display text-[20px] font-semibold">
              {current ? `Move invoice #${invoiceId}` : `Who bought this?`}
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-faint">
              {current
                ? `Currently filed under ${current.name}. Picking someone else moves the sale, and both of their histories update.`
                : "This one was rung up without a name. Choose who it belongs to and it'll appear in their history."}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-faint">
              Prices, tax and the total stay exactly as they were recorded — only the name moves.
            </p>

            <div className="mt-4">
              <CustomerPicker customers={customers} autoFocus onPick={(c) => assign(c.id)} />
            </div>

            <div className="mt-5 flex items-center justify-between gap-2">
              {current ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => assign(null)}
                  className="btn btn-quiet btn-sm text-ink-faint"
                >
                  Take the name off
                </button>
              ) : (
                <span />
              )}
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
                {pending ? <Spinner /> : null}
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

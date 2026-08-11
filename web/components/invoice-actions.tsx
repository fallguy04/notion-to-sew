"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Modal from "./modal";
import { Spinner } from "./form";
import { useToast } from "./toast";
import { money } from "@/lib/format";
import {
  markPaidAction,
  deleteInvoiceAction,
  emailInvoiceAction,
} from "@/app/admin/invoices/actions";
import type { PaymentMethod } from "@/lib/db";

const PAYMENTS: { value: PaymentMethod; label: string }[] = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "venmo", label: "Venmo" },
];

/**
 * The four things you ever do with an invoice, in one cluster.
 *
 * "Mark paid" asks how it was paid rather than assuming. 826 of the 1,374
 * historical invoices were settled by check and the old checkout screen did not
 * even offer check as an option, so the payment column has been guessing for
 * years.
 */
export default function InvoiceActions({
  id,
  status,
  total,
  defaultEmail,
  mailReady,
  compact = false,
}: {
  id: number;
  status: string;
  total: number;
  defaultEmail?: string | null;
  mailReady: boolean;
  compact?: boolean;
}) {
  const [pending, start] = useTransition();
  const [paying, setPaying] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();
  const router = useRouter();

  const unpaid = status.toLowerCase() === "pending";
  const btn = compact ? "btn btn-quiet btn-sm" : "btn btn-ghost btn-sm";

  function run(fn: () => Promise<{ ok: boolean; message: string } | null>, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res) toast(res.message, res.ok ? "good" : "bad");
      if (!res || res.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      {unpaid && (
        <button
          type="button"
          onClick={() => setPaying(true)}
          disabled={pending}
          className={`${btn} text-spruce`}
          title="Mark this invoice paid"
        >
          {pending ? <Spinner /> : "Mark paid"}
        </button>
      )}

      <Link href={`/admin/invoices/${id}`} className={btn} title="Open this invoice">
        View
      </Link>

      <a
        href={`/api/invoice/${id}`}
        target="_blank"
        rel="noopener"
        className={btn}
        title="Open the PDF in a new tab to print or save"
      >
        PDF
      </a>

      <button
        type="button"
        onClick={() => setEmailing(true)}
        className={btn}
        title={mailReady ? "Email this to the customer" : "Email isn't set up yet"}
      >
        Email
      </button>

      {!compact && (
        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="btn btn-quiet btn-sm text-ink-faint hover:text-clay"
          title="Delete this invoice"
        >
          Delete
        </button>
      )}

      {paying && (
        <Modal onClose={() => setPaying(false)} labelledBy="pay-title">
          <div className="pop w-full max-w-[380px] rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]">
            <h2 id="pay-title" className="font-display text-[19px] font-semibold">
              Mark #{id} paid
            </h2>
            <p className="mt-1.5 text-[14px] text-ink-soft">
              {money(total)}. How did they pay?
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              {PAYMENTS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => run(() => markPaidAction(id, p.value), () => setPaying(false))}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-quiet mt-3 w-full"
              onClick={() => setPaying(false)}
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {emailing && (
        <EmailDialog
          id={id}
          defaultEmail={defaultEmail ?? ""}
          mailReady={mailReady}
          onClose={() => setEmailing(false)}
        />
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(false)} labelledBy="del-title">
          <div className="pop w-full max-w-[420px] rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]">
            <h2 id="del-title" className="font-display text-[19px] font-semibold">
              Delete invoice #{id}?
            </h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
              {money(total)} comes off the books. Anything sold on it goes back into stock, and
              any store credit it used is returned to the customer. This can&apos;t be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setDeleting(false)}>
                Keep it
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() =>
                  run(() => deleteInvoiceAction(id), () => setDeleting(false))
                }
              >
                Delete invoice
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function EmailDialog({
  id,
  defaultEmail,
  mailReady,
  onClose,
}: {
  id: number;
  defaultEmail: string;
  mailReady: boolean;
  onClose: () => void;
}) {
  const [to, setTo] = useState(defaultEmail);
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <Modal onClose={onClose} labelledBy="email-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await emailInvoiceAction(id, to);
            toast(res!.message, res!.ok ? "good" : "bad");
            if (res!.ok) onClose();
          });
        }}
        className="pop w-full max-w-[420px] rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]"
      >
        <h2 id="email-title" className="font-display text-[19px] font-semibold">
          Email invoice #{id}
        </h2>

        {!mailReady ? (
          <>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
              Sending isn&apos;t switched on yet. Add a Gmail address and app password to the
              site&apos;s environment settings, then this will work everywhere.
            </p>
            <div className="mt-6 flex justify-end">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-[13.5px] text-ink-faint">
              A PDF copy goes out as an attachment.
            </p>
            <label className="mt-4 block">
              <span className="label">Send to</span>
              <input
                type="email"
                required
                autoFocus
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="customer@example.com"
                className="field"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                {pending && <Spinner />}
                {pending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

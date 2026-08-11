"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import Modal from "./modal";
import { Spinner } from "./form";
import { useToast } from "./toast";

/**
 * A one-shot action attached to a button — mark paid, delete, restock — with
 * an optional confirmation step.
 *
 * Confirmation is opt-in and worded as a question about the specific thing
 * being changed. A generic "Are you sure?" trains people to click yes, which is
 * how an invoice gets deleted by muscle memory.
 */
export default function ActionButton({
  action,
  children,
  className = "btn btn-ghost btn-sm",
  confirm,
  title,
  pendingLabel,
  onDone,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  className?: string;
  confirm?: { title: string; body: string; verb: string; danger?: boolean };
  title?: string;
  pendingLabel?: string;
  onDone?: () => void;
}) {
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const toast = useToast();
  const router = useRouter();

  function run() {
    setAsking(false);
    start(async () => {
      try {
        const res = await action();
        if (res) toast(res.message, res.ok ? "good" : "bad");
        if (!res || res.ok) {
          router.refresh();
          onDone?.();
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "That didn't work.", "bad");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        title={title}
        disabled={pending}
        aria-busy={pending}
        onClick={() => (confirm ? setAsking(true) : run())}
        className={className}
      >
        {pending ? (
          <>
            <Spinner />
            {pendingLabel ?? null}
          </>
        ) : (
          children
        )}
      </button>

      {asking && confirm && (
        <Modal onClose={() => setAsking(false)} labelledBy="confirm-title">
          <div className="pop w-full max-w-[420px] rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]">
            <h2 id="confirm-title" className="font-display text-[19px] font-semibold">
              {confirm.title}
            </h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{confirm.body}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
                Cancel
              </button>
              <button
                type="button"
                className={confirm.danger ? "btn btn-danger" : "btn btn-primary"}
                onClick={run}
              >
                {confirm.verb}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

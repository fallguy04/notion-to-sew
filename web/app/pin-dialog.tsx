"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkPin } from "./actions";
import Modal from "@/components/modal";

/**
 * PIN entry.
 *
 * A plain field in a plain form, so Enter submits it — that was a specific
 * complaint about the old sign-in, where typing the password and pressing Enter
 * did nothing at all.
 *
 * `inputMode="numeric"` means the iPad raises its own number pad, which is a
 * better keypad than one drawn in HTML and costs nothing. `autoComplete="off"`
 * keeps password managers from offering to generate a strong password over a
 * short numeric PIN.
 */
export default function PinDialog({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || pending) return;
    start(async () => {
      setError(null);
      const ok = await checkPin(pin);
      if (ok) {
        router.push("/admin");
        return; // stay disabled: the dialog is on its way out
      }
      setError("That PIN isn’t right.");
      setPin("");
    });
  }

  return (
    <Modal onClose={onClose} labelledBy="pin-title">
      <form
        onSubmit={submit}
        className="pop w-full max-w-[380px] rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-float)]"
      >
        <h2 id="pin-title" className="font-display text-[22px] font-semibold">
          Staff access
        </h2>
        <p className="mt-1 text-[14px] text-ink-faint">
          Enter your PIN to open the back office.
        </p>

        <label className="mt-6 block">
          <span className="sr-only">PIN</span>
          <input
            type="password"
            name="pin"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value);
              setError(null);
            }}
            autoFocus
            inputMode="numeric"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "pin-error" : undefined}
            className="field field-lg tabular text-center text-[24px] tracking-[0.4em]"
          />
        </label>

        <div className="flex min-h-[24px] items-center justify-center">
          {error && (
            <p id="pin-error" role="alert" className="pop mt-2 text-[13.5px] font-medium text-clay">
              {error}
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-2.5">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-lg flex-1">
            Cancel
          </button>
          <button
            type="submit"
            disabled={pending || pin.length === 0}
            className="btn btn-primary btn-lg flex-1"
          >
            {pending ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

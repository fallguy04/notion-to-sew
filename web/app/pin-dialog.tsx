"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { checkPin } from "./actions";
import Modal from "./modal";

const MAX = 12;

/**
 * PIN entry as an on-screen keypad.
 *
 * Deliberately not an <input type="password">. That is what made password
 * managers offer to generate a strong password over a four-digit PIN, and it
 * put a text field on a touchscreen that has no business raising a keyboard.
 * There is no input element at all — digits live in React state, so nothing
 * can autofill it, and the keypad gives 68px targets on the iPad.
 *
 * A physical keyboard still works: digits, Backspace, Escape and Enter are
 * handled at the window level for whoever is on a laptop.
 */
export default function PinDialog({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = useCallback(
    async (value: string) => {
      if (!value || busy) return;
      setBusy(true);
      setError(null);
      const ok = await checkPin(value);
      if (ok) {
        router.push("/admin");
        return; // keep busy: the dialog is going away
      }
      setBusy(false);
      setError("That PIN isn’t right.");
      setPin("");
    },
    [busy, router],
  );

  const press = useCallback(
    (d: string) => {
      setError(null);
      setPin((p) => (p.length >= MAX ? p : p + d));
    },
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key === "Enter") return void submit(pin);
      if (e.key === "Backspace") {
        setError(null);
        return setPin((p) => p.slice(0, -1));
      }
      if (/^[0-9]$/.test(e.key)) press(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin, press, submit, onClose]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <Modal onClose={onClose} labelledBy="pin-title">
      <div className="pop w-full max-w-[340px] rounded-3xl border border-line bg-surface p-6 shadow-[0_24px_60px_-20px_rgba(34,32,29,0.35)]">
        <h2 id="pin-title" className="font-display text-center text-[23px] font-semibold">
          Staff access
        </h2>
        <p className="mt-1 text-center text-[14px] text-ink-faint">
          Enter your PIN to open the admin area.
        </p>

        {/* Dots, not a text field — shows progress without inviting autofill. */}
        <div className="mt-6 flex h-8 items-center justify-center gap-3" aria-live="polite">
          {pin.length === 0 && !error && (
            <span className="text-[14px] text-ink-faint">Enter PIN</span>
          )}
          {Array.from({ length: pin.length }).map((_, i) => (
            <span key={i} className="pop h-3 w-3 rounded-full bg-spruce" />
          ))}
        </div>

        <div className="flex h-6 items-center justify-center">
          {error && <p className="text-[14px] font-medium text-[#a63a32]">{error}</p>}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {keys.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => press(k)}
              disabled={busy}
              className="tap font-display h-[68px] rounded-2xl border border-line bg-paper text-[26px] font-semibold text-ink active:border-spruce active:bg-spruce-light disabled:opacity-40"
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setPin("");
              setError(null);
            }}
            disabled={busy}
            className="tap h-[68px] rounded-2xl text-[14px] font-medium text-ink-faint active:bg-black/5 disabled:opacity-40"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => press("0")}
            disabled={busy}
            className="tap font-display h-[68px] rounded-2xl border border-line bg-paper text-[26px] font-semibold text-ink active:border-spruce active:bg-spruce-light disabled:opacity-40"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setPin((p) => p.slice(0, -1));
            }}
            disabled={busy}
            aria-label="Delete last digit"
            className="tap flex h-[68px] items-center justify-center rounded-2xl text-ink-faint active:bg-black/5 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9L2.8 12.6a1 1 0 0 1 0-1.2L9 5Z" />
              <path d="m12.5 10 4 4m0-4-4 4" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="tap h-14 flex-1 rounded-2xl border border-line bg-surface text-[16px] font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit(pin)}
            disabled={busy || pin.length === 0}
            className="tap h-14 flex-1 rounded-2xl bg-spruce text-[16px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

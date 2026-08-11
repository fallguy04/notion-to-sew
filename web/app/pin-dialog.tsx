"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { checkPin } from "./actions";

/**
 * Shared PIN prompt — used by the chooser's Admin card and by the kiosk's
 * long-press staff access, so there is one implementation of the check rather
 * than two that can drift.
 */
export default function PinDialog({ onClose }: { onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const ok = await checkPin(pin);
    setBusy(false);
    if (ok) {
      router.push("/admin");
    } else {
      setError("That PIN isn’t right.");
      setPin("");
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-6"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="pop w-full max-w-sm rounded-2xl border border-line bg-surface p-6"
      >
        <h2 className="font-display text-[24px] font-semibold">Staff access</h2>
        <p className="mt-1 text-[14px] text-ink-faint">Enter your PIN to open the admin area.</p>

        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          type="password"
          inputMode="numeric"
          autoFocus
          // A real <form>, so Enter submits. The Streamlit version had the field
          // and the button as unrelated widgets and Enter did nothing.
          className="tabular mt-5 h-16 w-full rounded-xl border border-line bg-paper px-4 text-center text-[26px] tracking-[0.3em] outline-none focus:border-spruce focus:shadow-[0_0_0_4px_rgba(31,110,90,0.13)]"
          placeholder="••••"
        />

        {error && <p className="mt-3 text-center text-[14px] text-[#a63a32]">{error}</p>}

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="tap h-14 flex-1 rounded-xl border border-line bg-surface text-[16px] font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || pin.length === 0}
            className="tap h-14 flex-1 rounded-xl bg-spruce text-[16px] font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Checking…" : "Unlock"}
          </button>
        </div>
      </form>
    </div>
  );
}

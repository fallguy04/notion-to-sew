"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { checkPin } from "./actions";

/**
 * Staff way into the admin area.
 *
 * Small and unobtrusive, but deliberately not invisible — the old kiosk had a
 * 42px lock icon at 22% opacity in the corner, which was both easy for a
 * customer to hit by accident and impossible to find on purpose. This is a
 * hairline dot that needs a *long press* (700ms), so a stray tap does nothing
 * and staff can open it without hunting.
 */
export default function StaffAccess() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const startHold = () => {
    timer.current = setTimeout(() => {
      setOpen(true);
      setPin("");
      setError(null);
    }, 700);
  };
  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current);
  };

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
    <>
      <button
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Staff access (press and hold)"
        title="Press and hold for staff access"
        className="fixed bottom-2 right-2 z-50 h-11 w-11 rounded-full opacity-25 transition-opacity active:opacity-60"
      >
        <span className="mx-auto block h-2 w-2 rounded-full bg-ink-faint" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-6">
          <form
            onSubmit={submit}
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
              // Enter submits, because this sits in a real <form> — the old
              // sidebar had the field and the button as unrelated widgets, so
              // pressing Enter did nothing at all.
              className="tabular mt-5 h-16 w-full rounded-xl border border-line bg-paper px-4 text-center text-[26px] tracking-[0.3em] outline-none focus:border-spruce focus:shadow-[0_0_0_4px_rgba(31,110,90,0.13)]"
              placeholder="••••"
            />

            {error && <p className="mt-3 text-center text-[14px] text-[#a63a32]">{error}</p>}

            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
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
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import PinDialog from "./pin-dialog";
import { useHydrated } from "@/components/hydrated";

/**
 * `?locked=1` is set when the admin layout turned someone away — either their
 * eight-hour session ran out or they typed the URL directly. Opening the PIN
 * dialog straight away saves a click at the one moment it is most annoying.
 *
 * Read from the browser rather than from searchParams on purpose: this page is
 * statically prerendered so it survives a wifi drop, and reading the query
 * string on the server would make it render per request.
 */
export default function AdminCard() {
  const hydrated = useHydrated();
  const [choice, setChoice] = useState<"auto" | "open" | "closed">("auto");

  const locked =
    hydrated && new URLSearchParams(window.location.search).get("locked") === "1";
  const open = choice === "open" || (choice === "auto" && locked);
  const setOpen = (v: boolean) => setChoice(v ? "open" : "closed");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="tap group flex min-h-[220px] flex-col justify-between rounded-2xl border border-line bg-surface p-7 text-left hover:border-spruce hover:shadow-[0_8px_28px_-14px_rgba(34,32,29,0.25)]"
      >
        <div>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-light text-amber">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="10.5" width="16" height="10" rx="2" />
              <path d="M8 10.5V7a4 4 0 1 1 8 0v3.5" strokeLinecap="round" />
            </svg>
          </div>
          <h2 className="font-display mt-5 text-[24px] font-semibold">Admin</h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
            Customers, inventory, invoices and reports. Needs your PIN.
          </p>
        </div>
        <span className="mt-6 text-[15px] font-medium text-spruce">
          Enter PIN <span className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
        </span>
      </button>
      {open && <PinDialog onClose={() => setOpen(false)} />}
    </>
  );
}

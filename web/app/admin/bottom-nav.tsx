"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { signOut } from "../actions";
import { forgetCachedPages } from "./pwa";
import { Spinner } from "@/components/form";
import { Home, Tag, Receipt, People, Box, Chart, Gear, Screen, Exit } from "./nav";

/**
 * The phone's navigation, at the bottom, where thumbs are.
 *
 * The first mobile pass reused the desktop idea shrunk down — a row of pills
 * across the top that scrolled sideways, above a sign-out button nobody needs
 * that often. Top of the screen is the one place a thumb can't reach on a
 * phone held one-handed, and a horizontally scrolling nav means some
 * destinations are invisible until you know to go looking.
 *
 * Four places she actually goes get fixed tabs; everything occasional lives
 * under More. Sell sits in the middle on purpose — it's the money button.
 */

const TABS = [
  { href: "/admin", label: "Home", icon: Home, exact: true },
  { href: "/admin/invoices", label: "Activity", icon: Receipt },
  { href: "/admin/pos", label: "Sell", icon: Tag },
  { href: "/admin/customers", label: "Customers", icon: People },
];

const MORE = [
  { href: "/admin/inventory", label: "Inventory", icon: Box },
  { href: "/admin/financials", label: "Money", icon: Chart },
  { href: "/admin/settings", label: "Settings", icon: Gear },
];

export default function BottomNav() {
  const path = usePathname();
  // The sheet is "open for this path": navigating anywhere makes the stored
  // path stale and the sheet closes by derivation, with no effect to run.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === path;
  const [pending, start] = useTransition();

  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || path.startsWith(href + "/");
  // "More" reads as the current place when the page it holds is open.
  const moreActive = MORE.some((m) => isActive(m.href));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenFor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {open && (
        <div className="no-print fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
          <div className="absolute inset-0 bg-ink/25" onClick={() => setOpenFor(null)} />
          <div
            className="pop absolute inset-x-3 bottom-[76px] rounded-2xl border border-line bg-surface p-1.5 shadow-[var(--shadow-float)]"
            style={{ marginBottom: "env(safe-area-inset-bottom)" }}
          >
            {MORE.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`tap flex items-center gap-3 rounded-xl px-3.5 py-3 text-[15px] font-medium ${
                  isActive(href) ? "bg-spruce-light text-spruce-dark" : "text-ink"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            ))}
            <div className="mx-3 my-1 border-t border-line-soft" />
            <Link
              href="/kiosk"
              className="tap flex items-center gap-3 rounded-xl px-3.5 py-3 text-[15px] font-medium text-ink-soft"
            >
              <Screen className="h-5 w-5" />
              Open the kiosk
            </Link>
            <button
              type="button"
              onClick={() =>
                start(async () => {
                  // The cached pages are the customer book and the takings.
                  await forgetCachedPages();
                  await signOut();
                })
              }
              className="tap flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left text-[15px] font-medium text-ink-soft"
            >
              {pending ? <Spinner /> : <Exit className="h-5 w-5" />}
              Sign out
            </button>
          </div>
        </div>
      )}

      <nav
        aria-label="Sections"
        className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`tap flex flex-col items-center gap-1 pb-2 pt-2.5 ${
                  active ? "text-spruce-dark" : "text-ink-faint"
                }`}
              >
                <Icon className="h-[22px] w-[22px]" />
                <span className="text-[10.5px] font-semibold leading-none">{label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpenFor(open ? null : path)}
            className={`tap flex flex-col items-center gap-1 pb-2 pt-2.5 ${
              moreActive || open ? "text-spruce-dark" : "text-ink-faint"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-[22px] w-[22px]" fill="currentColor" aria-hidden>
              <circle cx="5.5" cy="12" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="18.5" cy="12" r="1.7" />
            </svg>
            <span className="text-[10.5px] font-semibold leading-none">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}

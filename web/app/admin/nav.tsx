"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import { signOut } from "../actions";
import { Spinner } from "@/components/form";
import { PaletteButton } from "./palette";
import { forgetCachedPages } from "./pwa";

const ITEMS = [
  { href: "/admin", label: "Dashboard", icon: Home, exact: true },
  { href: "/admin/pos", label: "Sell", icon: Tag },
  { href: "/admin/invoices", label: "Transactions", icon: Receipt },
  { href: "/admin/customers", label: "Customers", icon: People },
  { href: "/admin/inventory", label: "Inventory", icon: Box },
  { href: "/admin/financials", label: "Money", icon: Chart },
  { href: "/admin/settings", label: "Settings", icon: Gear },
];

export default function Nav() {
  const path = usePathname();
  const [pending, start] = useTransition();

  const isActive = (href: string, exact?: boolean) =>
    exact ? path === href : path === href || path.startsWith(href + "/");

  return (
    <>
      {/* Wide screens: a quiet rail that stays put. */}
      <aside className="no-print sticky top-0 hidden h-dvh w-[212px] shrink-0 flex-col border-r border-line bg-surface/60 px-3 py-5 lg:flex">
        <Link href="/admin" className="mb-7 block px-2.5">
          <div className="font-display text-[19px] font-semibold leading-none tracking-tight">
            Notion&nbsp;to&nbsp;<span className="text-spruce">Sew</span>
          </div>
          <div className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            Back office
          </div>
        </Link>

        <div className="mb-4">
          <PaletteButton />
        </div>

        <nav className="flex flex-col gap-0.5">
          {ITEMS.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`tap group relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[14.5px] font-medium ${
                  active
                    ? "bg-spruce-light text-spruce-dark"
                    : "text-ink-soft hover:bg-black/[0.035] hover:text-ink"
                }`}
              >
                {/* A 2px marker rather than a filled block — the fills were the
                    "huge blocks of colour" problem. */}
                <span
                  className={`absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full bg-spruce transition-opacity ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
                <Icon className="h-[17px] w-[17px]" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1 pt-6">
          <Link
            href="/kiosk"
            className="tap flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[13.5px] font-medium text-ink-faint hover:bg-black/[0.035] hover:text-ink"
          >
            <Screen className="h-[17px] w-[17px]" />
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
            className="tap flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13.5px] font-medium text-ink-faint hover:bg-black/[0.035] hover:text-ink"
          >
            {pending ? <Spinner /> : <Exit className="h-[17px] w-[17px]" />}
            Sign out
          </button>
        </div>
      </aside>

      {/* Narrow screens: the same destinations, scrollable, stuck to the top. */}
      <div className="no-print sticky top-0 z-40 border-b border-line bg-paper/92 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 pt-3">
          <Link
            href="/admin"
            className="min-w-0 shrink truncate font-display text-[17px] font-semibold tracking-tight"
          >
            Notion&nbsp;to&nbsp;<span className="text-spruce">Sew</span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <div className="w-[104px] sm:w-44">
              <PaletteButton />
            </div>
          <button
            type="button"
            onClick={() =>
              start(async () => {
                // The cached pages are the customer book and the takings.
                await forgetCachedPages();
                await signOut();
              })
            }
            className="btn btn-quiet btn-sm"
          >
            {pending ? <Spinner /> : null}
            Sign out
          </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ITEMS.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`tap flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13.5px] font-medium ${
                  active
                    ? "border-spruce/30 bg-spruce-light text-spruce-dark"
                    : "border-line bg-surface text-ink-soft"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </>
  );
}

/* Icons are inline so there is no icon font to load, nothing to flash as
   literal ligature text, and no request that can fail on shop wifi. */
type IconProps = { className?: string };
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Home({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-5H9v5H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function Tag({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M3.5 12.2V5.4a1.9 1.9 0 0 1 1.9-1.9h6.8a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.8 6.8a2 2 0 0 1-2.8 0l-7-7a2 2 0 0 1-.5-1.5Z" />
      <circle cx="8" cy="8" r="1.4" />
    </svg>
  );
}
function Receipt({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M6 3.5h12v17l-2.4-1.6-2.4 1.6-2.4-1.6-2.4 1.6L6 20.5z" />
      <path d="M9.5 8.5h5M9.5 12h5" strokeLinecap="round" />
    </svg>
  );
}
function People({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
      <path d="M16 5.2A3.2 3.2 0 0 1 16 11M17.5 14.9c2 .6 3.5 2.5 3.5 5.1" />
    </svg>
  );
}
function Box({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M3.5 7.6 12 3.5l8.5 4.1v8.8L12 20.5 3.5 16.4Z" />
      <path d="m3.5 7.6 8.5 4.1 8.5-4.1M12 11.7v8.8" />
    </svg>
  );
}
function Chart({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 16.5v-4M12.5 16.5v-8M17 16.5v-5.5" />
    </svg>
  );
}
function Gear({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a1.9 1.9 0 1 1-3.8 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3.6a1.9 1.9 0 1 1 0-3.8h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3.6a1.9 1.9 0 1 1 3.8 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1h.2a1.9 1.9 0 1 1 0 3.8h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </svg>
  );
}
function Screen({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M9 20.5h6" />
    </svg>
  );
}
function Exit({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden>
      <path d="M15 4.5h3a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-3" />
      <path d="M10 8.5 6.5 12 10 15.5M6.5 12H15" />
    </svg>
  );
}

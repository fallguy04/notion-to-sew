"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { paletteSearch, type Hit } from "./search-actions";

/**
 * One box that finds anything.
 *
 * The shop's things live on five different screens, each with its own search,
 * and knowing which screen to be on before you can look for something is a
 * thing you have to learn rather than a thing you can guess. This asks for the
 * thing, not the screen: an item number, a customer, an invoice number, or the
 * name of a page.
 *
 * Cmd-K on a Mac, Ctrl-K on Windows, and a button in the sidebar for anyone
 * who does not know that. Searching runs on the server rather than shipping
 * 1,500 items and 227 names to the browser — the kiosk sends its catalogue
 * because it has to work offline; the back office has no such excuse, and
 * phone numbers and email addresses should not sit in a page's source.
 */

type Row = Hit | { kind: "page"; id: string; title: string; subtitle: string; href: string };

const PAGES: Row[] = [
  { kind: "page", id: "p-dash", title: "Dashboard", subtitle: "Today's takings and what needs attention", href: "/admin" },
  { kind: "page", id: "p-sell", title: "Sell", subtitle: "Ring up a sale at the counter", href: "/admin/pos" },
  { kind: "page", id: "p-tx", title: "Transactions", subtitle: "Every invoice, back to the beginning", href: "/admin/invoices" },
  { kind: "page", id: "p-cust", title: "Customers", subtitle: "Profiles, history and store credit", href: "/admin/customers" },
  { kind: "page", id: "p-inv", title: "Inventory", subtitle: "Stock, prices and restocking", href: "/admin/inventory" },
  { kind: "page", id: "p-money", title: "Money", subtitle: "Profit and loss, sales tax, expenses", href: "/admin/financials" },
  { kind: "page", id: "p-set", title: "Settings", subtitle: "Shop details, email and categories", href: "/admin/settings" },
];

const LABEL: Record<Row["kind"], string> = {
  invoice: "Invoices",
  customer: "Customers",
  product: "Items",
  page: "Go to",
};

const OPEN_EVENT = "nts:palette";

/**
 * The trigger. There are two of these on screen — one in the sidebar, one in
 * the narrow-screen bar — and only ever one dialog, because the first version
 * mounted the whole palette twice and cmd-K opened both of them on top of each
 * other.
 */
export function PaletteButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      className="tap flex w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left text-[13.5px] text-ink-faint hover:border-ink/20"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" strokeLinecap="round" />
      </svg>
      <span className="flex-1">Search</span>
      <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] font-medium lg:inline">
        ⌘K
      </kbd>
    </button>
  );
}

/** The dialog and the shortcut. Mounted once, in the admin layout. */
export default function Palette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onAsk = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onAsk);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onAsk);
    };
  }, []);

  return open ? <Dialog onClose={() => setOpen(false)} /> : null;
}

function Dialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ q: string; rows: Hit[] } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [, start] = useTransition();
  const router = useRouter();
  const listRef = useRef<HTMLUListElement>(null);

  const term = q.trim();

  const searching = term.length >= 2 && found?.q !== term;

  // Results are held with the search they answer, so a reply that lands after
  // another keystroke simply stops matching and is ignored. Pages are filtered
  // here rather than on the server: they are seven strings, and a round trip to
  // find "Settings" would be silly.
  const rows: Row[] = useMemo(() => {
    const hits = found?.q === term ? found.rows : [];
    const pages =
      term.length >= 1
        ? PAGES.filter((p) => p.title.toLowerCase().includes(term.toLowerCase()))
        : PAGES;
    return term.length >= 2 ? [...hits, ...pages] : pages;
  }, [term, found]);

  useEffect(() => {
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(() => {
      start(async () => {
        try {
          const res = await paletteSearch(term);
          if (!cancelled) setFound({ q: term, rows: res });
        } catch {
          if (!cancelled) setFound({ q: term, rows: [] });
        }
      });
    }, 160);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  const at = Math.min(cursor, Math.max(0, rows.length - 1));

  const go = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      onClose();
      router.push(row.href);
    },
    [onClose, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, rows.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        go(rows[at]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, at, go, onClose]);

  useEffect(() => {
    listRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: "nearest" });
  }, [at]);

  let lastKind: string | null = null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Search the shop"
    >
      <div className="pop flex max-h-[70dvh] w-[min(94vw,600px)] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-float)]">
        <div className="relative border-b border-line-soft">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-faint"
            fill="none" stroke="currentColor" strokeWidth="2" aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={q}
            autoFocus
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            placeholder="Item number, customer, invoice number…"
            aria-label="Search the shop"
            autoComplete="off"
            spellCheck={false}
            className="h-16 w-full bg-transparent pl-14 pr-5 text-[17px] outline-none placeholder:text-ink-faint"
          />
        </div>

        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2">
          {rows.length === 0 ? (
            <li className="px-5 py-8 text-center text-[14px] text-ink-faint">
              {searching ? "Looking…" : `Nothing matches “${term}”.`}
            </li>
          ) : (
            rows.map((row, i) => {
              const header = row.kind !== lastKind ? LABEL[row.kind] : null;
              lastKind = row.kind;
              return (
                <li key={`${row.kind}-${row.id}`}>
                  {header && (
                    <div className="px-5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                      {header}
                    </div>
                  )}
                  <button
                    type="button"
                    data-on={i === at}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(row)}
                    className={`flex w-full items-baseline gap-3 px-5 py-2.5 text-left ${
                      i === at ? "bg-spruce-light" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{row.title}</span>
                      <span className="block truncate text-[12.5px] text-ink-faint">
                        {row.subtitle}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="flex items-center justify-between border-t border-line-soft px-5 py-2.5 text-[11.5px] text-ink-faint">
          <span>↑ ↓ to move · Enter to open · Esc to close</span>
          {searching && <span>Looking…</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}

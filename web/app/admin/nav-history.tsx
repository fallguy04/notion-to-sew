"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

/**
 * Where "back" actually goes.
 *
 * Every back link in here used to point at a parent in a tree someone drew
 * once: an invoice's parent is its customer, a customer's parent is the
 * customer list. That is a fine description of how the data nests and a bad
 * description of where you just came from. Opening an invoice from the
 * transactions list and pressing back landed you on a customer profile you had
 * never seen, having lost the page and the search you were reading.
 *
 * So this keeps the trail instead of guessing it. Each admin page records
 * itself as you arrive, back reads the entry underneath, and the link says the
 * name of the page it will actually take you to. The nesting is still there as
 * a fallback for the first page of a session — arriving from a bookmark or a
 * refresh, there is no trail to follow and a parent is the best guess left.
 */

const KEY = "nts.nav.v1";
const LIMIT = 12;

export type Entry = { path: string; label: string };

let cache: Entry[] = [];
let serialised = "[]";
const listeners = new Set<() => void>();

function load(): Entry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(KEY) ?? "[]";
    if (raw !== serialised) {
      serialised = raw;
      cache = JSON.parse(raw) as Entry[];
    }
  } catch {
    cache = [];
  }
  return cache;
}

function save(next: Entry[]) {
  cache = next;
  serialised = JSON.stringify(next);
  try {
    sessionStorage.setItem(KEY, serialised);
  } catch {
    /* private mode, or a full quota — the fallback link still works */
  }
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * The trail, or an empty one on the server. A stable constant, not the live
 * cache: module state is shared between requests on the server, and React
 * re-renders with the real snapshot immediately after hydration anyway.
 */
const EMPTY: Entry[] = [];

export function useTrail(): Entry[] {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}

/**
 * Records each page as it is opened. Mounted once, in the admin layout.
 *
 * The label is read from the page's own heading rather than mapped from the
 * URL, because a URL cannot tell you a customer is called Bauman, Cindy. Pages
 * without a heading — the invoice document is one — fall back to a name built
 * from the path.
 */
export function NavHistory() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = search ? `${pathname}?${search}` : pathname;

  useEffect(() => {
    // Straight through, not inside a requestAnimationFrame: effects already run
    // after the DOM is committed, so the heading is there to read — and a frame
    // never arrives at all while the tab is in the background, which left the
    // trail silently stuck a page behind.
    const label = headingOf(pathname);
    const stack = load().slice();
    const top = stack[stack.length - 1];

    if (top?.path === url) {
      // Same page, possibly a fuller heading now. Keep the trail as it is.
      if (top.label !== label) {
        stack[stack.length - 1] = { path: url, label };
        save(stack);
      }
      return;
    }

    // Going back — by our own link or the browser's button — pops rather than
    // pushing, so the trail doesn't grow every time you retrace it.
    if (stack.length >= 2 && stack[stack.length - 2].path === url) {
      stack.pop();
      save(stack);
      return;
    }

    stack.push({ path: url, label });
    save(stack.length > LIMIT ? stack.slice(stack.length - LIMIT) : stack);
  }, [url, pathname]);

  return null;
}

function headingOf(pathname: string): string {
  const h1 = document.querySelector("main h1")?.textContent?.trim();
  if (h1) return h1;
  return nameFromPath(pathname);
}

/** A readable name for a page that renders no heading of its own. */
export function nameFromPath(pathname: string): string {
  const parts = pathname.replace(/^\/admin\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) return "Dashboard";
  const [section, id] = parts;
  if (section === "invoices") return id ? `Invoice #${id}` : "Transactions";
  if (section === "customers") return id ? "that customer" : "Customers";
  if (section === "inventory") return "Inventory";
  if (section === "financials") return "Money";
  if (section === "settings") return "Settings";
  if (section === "pos") return "Point of sale";
  return section.charAt(0).toUpperCase() + section.slice(1);
}

/**
 * The back link itself. Shows where it will actually go, so the label and the
 * destination can never disagree — which is what made the old ones feel random.
 */
export default function BackLink({
  fallbackHref,
  fallbackLabel,
}: {
  fallbackHref: string;
  fallbackLabel: string;
}) {
  const trail = useTrail();
  const router = useRouter();
  const prev = trail.length >= 2 ? trail[trail.length - 2] : null;

  const href = prev?.path ?? fallbackHref;
  const label = prev?.label ?? fallbackLabel;

  return (
    <a
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(href);
      }}
      className="tap -ml-1 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13.5px] font-medium text-ink-faint hover:text-ink"
    >
      <span aria-hidden>←</span> {label}
    </a>
  );
}

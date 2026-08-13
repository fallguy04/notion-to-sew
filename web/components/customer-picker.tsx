"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CustomerLite } from "@/lib/db";
import { money, phone as fmtPhone } from "@/lib/format";

/**
 * Picking a person, not a name.
 *
 * Two customers can legitimately share a name here, and the old dropdown
 * resolved to the name — so a sale could land on whichever namesake the list
 * happened to reach first. This returns the row. When two names collide, both
 * show their id and their phone number so you can tell them apart before you
 * charge one of them.
 */
export default function CustomerPicker({
  customers,
  onPick,
  onNew,
  placeholder = "Search for a customer",
  autoFocus = false,
}: {
  customers: CustomerLite[];
  onPick: (c: CustomerLite) => void;
  onNew?: (typed: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // The highlighted row is stored together with the search it belongs to, so a
  // new search resets it during render instead of in an effect that fires a
  // second pass after the list has already painted with a stale highlight.
  const [mark, setMark] = useState({ q: "", i: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const dupes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of customers) {
      const k = c.name.trim().toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [customers]);

  // Names are matched a word at a time. Almost every name in the book is filed
  // "Flory, Claudia", and someone typing "Claudia Flory" — which is the name —
  // matched nothing at all as one run of characters. Email and phone are still
  // matched whole; a comma never turns up in either.
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const terms = needle.split(/\s+/).filter(Boolean);
    const digits = needle.replace(/\D/g, "");
    return customers
      .filter((c) => {
        const name = c.name.toLowerCase();
        if (terms.every((t) => name.includes(t))) return true;
        if ((c.email ?? "").toLowerCase().includes(needle)) return true;
        if (digits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
        return false;
      })
      .sort((a, b) => {
        const an = a.name.toLowerCase().startsWith(terms[0]) ? 0 : 1;
        const bn = b.name.toLowerCase().startsWith(terms[0]) ? 0 : 1;
        return an - bn || a.name.localeCompare(b.name);
      })
      .slice(0, 25);
  }, [q, customers]);

  const cursor = mark.q === q ? mark.i : 0;
  const moveCursor = (i: number) => setMark({ q, i });

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function choose(c: CustomerLite) {
    onPick(c);
    setQ("");
    setOpen(false);
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
        >
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5 20c0-3.4 3.1-6 7-6s7 2.6 7 6" strokeLinecap="round" />
        </svg>
        <input
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              moveCursor(Math.min(cursor + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              moveCursor(Math.max(cursor - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (results[cursor]) choose(results[cursor]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && q.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="field field-lg pl-11"
        />
      </div>

      {open && q.trim().length > 0 && (
        <div className="pop absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-raised)]">
          {results.length === 0 ? (
            <div className="px-4 py-5 text-center">
              <p className="text-[14px] text-ink-faint">No one matches “{q.trim()}”.</p>
              {onNew && (
                <button
                  type="button"
                  onClick={() => {
                    onNew(q.trim());
                    setOpen(false);
                  }}
                  className="btn btn-ghost btn-sm mt-3"
                >
                  Add “{q.trim()}” as a new customer
                </button>
              )}
            </div>
          ) : (
            <ul ref={listRef} id={listId} role="listbox" className="max-h-[300px] overflow-y-auto">
              {results.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === cursor}>
                  <button
                    type="button"
                    onMouseEnter={() => moveCursor(i)}
                    onClick={() => choose(c)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${
                      i === cursor ? "bg-spruce-light" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[14.5px] font-medium">{c.name}</span>
                        {c.is_wholesale && <span className="pill pill-quiet">Wholesale</span>}
                      </span>
                      <span className="block truncate text-[12px] text-ink-faint">
                        {(dupes.get(c.name.trim().toLowerCase()) ?? 0) > 1 ? `${c.id} · ` : ""}
                        {fmtPhone(c.phone) || c.email || "no contact details"}
                      </span>
                    </span>
                    {c.credit > 0 && (
                      <span className="pill pill-paid shrink-0">{money(c.credit)}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

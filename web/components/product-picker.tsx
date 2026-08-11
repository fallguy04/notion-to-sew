"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { money } from "@/lib/format";

type Item = {
  sku: string;
  name: string;
  price: number;
  stock_qty: number;
  wholesale_price?: number | null;
  active?: boolean;
};

/**
 * Choosing an item by searching for it, never by typing its number.
 *
 * The old restock screen was a free-text SKU box: type a number, and if nothing
 * matched it offered to create a product. That is how four different books all
 * ended up as "Book" and how the same buttons got entered twice under slightly
 * different codes. Here you can only pick something that exists; creating a new
 * item is a separate, deliberate action.
 */
export default function ProductPicker({
  items,
  onPick,
  placeholder = "Search by name or item number",
  autoFocus = false,
  wholesale = false,
  emptyAction,
  inputRef,
}: {
  items: Item[];
  onPick: (item: Item) => void;
  placeholder?: string;
  autoFocus?: boolean;
  wholesale?: boolean;
  emptyAction?: React.ReactNode;
  /** So a caller can send the cursor back here after adding something. */
  inputRef?: React.Ref<HTMLInputElement>;
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

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 1) return [];
    const terms = needle.split(/\s+/);
    const scored = items
      .filter((p) => {
        const hay = `${p.sku} ${p.name}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .map((p) => {
        // Exact item numbers and names that start with what was typed come
        // first; a substring match somewhere in the middle comes last.
        const sku = p.sku.toLowerCase();
        const name = p.name.toLowerCase();
        let score = 3;
        if (sku === needle) score = 0;
        else if (name.startsWith(needle)) score = 1;
        else if (sku.startsWith(needle)) score = 2;
        return { p, score };
      })
      .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name));
    return scored.slice(0, 30).map((s) => s.p);
  }, [q, items]);

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

  function choose(item: Item) {
    onPick(item);
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
          strokeWidth="2"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
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
          spellCheck={false}
          role="combobox"
          aria-expanded={open && q.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          className="field pl-10"
        />
      </div>

      {open && q.trim().length > 0 && (
        <div className="pop absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--shadow-raised)]">
          {results.length === 0 ? (
            <div className="px-4 py-5 text-center">
              <p className="text-[14px] text-ink-faint">
                Nothing matches “{q.trim()}”.
              </p>
              {emptyAction && <div className="mt-3">{emptyAction}</div>}
            </div>
          ) : (
            <ul ref={listRef} id={listId} role="listbox" className="max-h-[320px] overflow-y-auto">
              {results.map((p, i) => {
                const price =
                  wholesale && p.wholesale_price && p.wholesale_price > 0
                    ? p.wholesale_price
                    : p.price;
                return (
                  <li key={p.sku} role="option" aria-selected={i === cursor}>
                    <button
                      type="button"
                      onMouseEnter={() => moveCursor(i)}
                      onClick={() => choose(p)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${
                        i === cursor ? "bg-spruce-light" : ""
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium">{p.name}</span>
                        <span className="block text-[12px] text-ink-faint">
                          {p.sku}
                          {p.active === false && " · inactive"}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="tabular block text-[14px] font-semibold">
                          {money(price)}
                        </span>
                        <span
                          className={`block text-[11.5px] ${
                            p.stock_qty <= 0 ? "text-clay" : "text-ink-faint"
                          }`}
                        >
                          {p.stock_qty} on hand
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

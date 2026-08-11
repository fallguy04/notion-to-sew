"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/lib/db";

type Line = { sku: string; name: string; price: number; qty: number };

const IDLE_RESET_MS = 3 * 60 * 1000;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export default function KioskClient({
  catalogue,
  popular,
}: {
  catalogue: Product[];
  popular: Product[];
}) {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  /**
   * Search runs against the catalogue already in memory. No request per
   * keystroke, so it stays instant and keeps working if the shop wifi drops —
   * the specific complaint about the old kiosk was that it "just doesn't
   * respond".
   */
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const terms = q.split(/\s+/);
    return catalogue
      .filter((p) => {
        const hay = `${p.sku} ${p.name}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      })
      .slice(0, 40);
  }, [query, catalogue]);

  const total = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const count = cart.reduce((s, l) => s + l.qty, 0);

  function add(p: Product) {
    setCart((c) => {
      const found = c.find((l) => l.sku === p.sku);
      if (found) {
        return c.map((l) => (l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...c, { sku: p.sku, name: p.name, price: p.price, qty: 1 }];
    });
    setToast(p.name);
    setQuery("");
    searchRef.current?.focus();
  }

  function setQty(sku: string, qty: number) {
    setCart((c) =>
      qty <= 0 ? c.filter((l) => l.sku !== sku) : c.map((l) => (l.sku === sku ? { ...l, qty } : l)),
    );
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * A shared counter iPad keeps one browser session all day. Without this, a
   * customer who wanders off mid-order leaves their cart for the next person.
   */
  useEffect(() => {
    if (cart.length === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        setCart([]);
        setQuery("");
      }, IDLE_RESET_MS);
    };
    reset();
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [cart.length]);

  const showingResults = query.trim().length >= 2;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 pb-40 pt-6">
      <Header />

      {/* The search field is the whole interaction, so it gets the visual
          weight. Previously a large heading sat above it competing for
          attention — "those are bigger and bolder than the area people are
          actually using". */}
      <div className="rise">
        <label htmlFor="q" className="sr-only">
          Search items
        </label>
        <div className="relative">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-6 top-1/2 h-7 w-7 -translate-y-1/2 text-ink-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            id="q"
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder="Search for an item"
            className="tap h-[88px] w-full rounded-2xl border border-line bg-surface pl-[68px] pr-6 text-[26px] text-ink outline-none placeholder:text-ink-faint focus:border-spruce focus:shadow-[0_0_0_4px_rgba(31,110,90,0.13)]"
          />
          {query && (
            <button
              onClick={() => {
                setQuery("");
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              className="tap absolute right-4 top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full text-ink-faint active:bg-black/5"
            >
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        <p className="mt-3 pl-1 text-[15px] text-ink-faint">
          Type a name, colour or item number — then tap it to add.
        </p>
      </div>

      {showingResults ? (
        <Results results={results} query={query} onAdd={add} />
      ) : (
        <Popular items={popular} onAdd={add} />
      )}

      {toast && (
        <div className="pop pointer-events-none fixed bottom-32 left-1/2 z-30 -translate-x-1/2 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-white shadow-lg">
          Added {toast}
        </div>
      )}

      {cart.length > 0 && (
        <CartBar cart={cart} total={total} count={count} onQty={setQty} onClear={() => setCart([])} />
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="mb-7 flex items-baseline justify-between border-b border-line pb-5">
      <div className="font-display text-[30px] font-semibold tracking-tight">
        Notion&nbsp;to&nbsp;<span className="text-spruce">Sew</span>
      </div>
      <div className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-faint">
        Quality Supplies · Local Service
      </div>
    </header>
  );
}

function Results({
  results,
  query,
  onAdd,
}: {
  results: Product[];
  query: string;
  onAdd: (p: Product) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="rise mt-10 rounded-2xl border border-line bg-surface px-6 py-12 text-center">
        <p className="font-display text-[22px]">No items match “{query.trim()}”.</p>
        <p className="mt-2 text-[15px] text-ink-faint">
          Try fewer words, or ask and we’ll find it for you.
        </p>
      </div>
    );
  }
  return (
    <ul className="mt-6 space-y-3">
      {results.map((p) => (
        <li key={p.sku}>
          <button
            onClick={() => onAdd(p)}
            className="tap flex w-full items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4 text-left active:border-spruce active:bg-spruce-light"
          >
            <span className="min-w-0 flex-1">
              {/* Full name, never truncated — a customer can't buy what they
                  can't read. The old kiosk cut names at 22 characters. */}
              <span className="block text-[19px] font-medium leading-snug">{p.name}</span>
              <span className="mt-0.5 block text-[13px] text-ink-faint">{p.sku}</span>
            </span>
            <span className="tabular shrink-0 text-[20px] font-semibold">{money(p.price)}</span>
            <span className="tap flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-spruce text-[28px] font-light leading-none text-white">
              +
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Popular({ items, onAdd }: { items: Product[]; onAdd: (p: Product) => void }) {
  return (
    <section className="mt-9">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
        Popular right now
      </h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {items.map((p) => (
          <li key={p.sku}>
            <button
              onClick={() => onAdd(p)}
              className="tap flex h-full w-full flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-5 text-left active:border-spruce active:bg-spruce-light"
            >
              <span className="text-[17px] font-medium leading-snug">{p.name}</span>
              <span className="flex items-center justify-between">
                <span className="tabular text-[19px] font-semibold">{money(p.price)}</span>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-spruce text-[26px] font-light leading-none text-white">
                  +
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CartBar({
  cart,
  total,
  count,
  onQty,
  onClear,
}: {
  cart: Line[];
  total: number;
  count: number;
  onQty: (sku: string, qty: number) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 flex flex-col bg-paper">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h2 className="font-display text-[26px] font-semibold">Your basket</h2>
            <button
              onClick={() => setOpen(false)}
              className="tap flex h-14 items-center rounded-xl border border-line bg-surface px-5 text-[16px] font-medium"
            >
              Keep shopping
            </button>
          </div>
          <ul className="flex-1 space-y-3 overflow-y-auto p-5">
            {cart.map((l) => (
              <li
                key={l.sku}
                className="flex items-center gap-4 rounded-2xl border border-line bg-surface p-4"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[18px] font-medium leading-snug">{l.name}</span>
                  <span className="tabular mt-0.5 block text-[14px] text-ink-faint">
                    {money(l.price)} each
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <button
                    onClick={() => onQty(l.sku, l.qty - 1)}
                    aria-label={`One fewer ${l.name}`}
                    className="tap flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-[26px] leading-none"
                  >
                    −
                  </button>
                  <span className="tabular w-10 text-center text-[20px] font-semibold">{l.qty}</span>
                  <button
                    onClick={() => onQty(l.sku, l.qty + 1)}
                    aria-label={`One more ${l.name}`}
                    className="tap flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-[26px] leading-none"
                  >
                    +
                  </button>
                </span>
                <span className="tabular w-24 shrink-0 text-right text-[19px] font-semibold">
                  {money(l.price * l.qty)}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line bg-surface p-5">
            <button
              onClick={onClear}
              className="tap mb-3 h-12 w-full rounded-xl text-[15px] font-medium text-ink-faint active:bg-black/5"
            >
              Start over
            </button>
            <div className="flex items-center justify-between">
              <span className="text-[16px] text-ink-soft">
                {count} item{count === 1 ? "" : "s"}
              </span>
              <span className="tabular font-display text-[30px] font-semibold">{money(total)}</span>
            </div>
            <p className="mt-3 text-center text-[15px] text-ink-soft">
              Please take your basket to the counter to pay.
            </p>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-4 backdrop-blur">
        <button
          onClick={() => setOpen(true)}
          className="tap mx-auto flex h-[68px] w-full max-w-5xl items-center justify-between rounded-2xl bg-spruce px-6 text-white"
        >
          <span className="text-[18px] font-semibold">
            View basket · {count} item{count === 1 ? "" : "s"}
          </span>
          <span className="tabular text-[24px] font-semibold">{money(total)}</span>
        </button>
      </div>
    </>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Product } from "@/lib/db";
import { money, pct } from "@/lib/format";
import { useOnline } from "@/components/hydrated";
import Modal from "@/components/modal";
import { useStaffUnlock } from "../staff-access";
import {
  recordKioskSale,
  kioskFindCustomers,
  kioskJoin,
  kioskEmailReceipt,
  type KioskCustomer,
  type KioskSaleResult,
} from "./actions";

type Line = { sku: string; name: string; price: number; qty: number };
type Phase = "shop" | "checkout" | "done";

/**
 * Long enough to read a written shopping list.
 *
 * At three minutes a customer working from a handwritten list — reading it,
 * finding the item, tapping a quantity — could be cleared out mid-order with
 * her name and basket gone, which looks exactly like being thrown back to the
 * start for no reason.
 */
const IDLE_RESET_MS = 10 * 60 * 1000;
const DONE_RESET_MS = 90 * 1000;
const CART_KEY = "nts.kiosk.cart.v1";

export default function KioskClient({
  catalogue,
  popular,
  shopRate,
  venmoUser,
  venmoQr,
  mailReady,
}: {
  catalogue: Product[];
  popular: Product[];
  shopRate: number;
  venmoUser: string;
  venmoQr: string | null;
  mailReady: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("shop");
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Line[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [customer, setCustomer] = useState<KioskCustomer | null>(null);
  const [useCredit, setUseCredit] = useState(true);
  const [payment, setPayment] = useState<"cash" | "check" | "venmo" | "invoice">("cash");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<KioskSaleResult | null>(null);
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const online = useOnline();

  /**
   * The basket survives a reload.
   *
   * On a tablet that has been awake all day, Safari will quietly discard and
   * reload a background tab. Without this, a customer who put twelve things in
   * a basket comes back to an empty one — which is exactly what "it just
   * doesn't respond" feels like from the other side of the counter.
   */
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(CART_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as { cart: Line[]; at: number };
        if (Date.now() - parsed.at < IDLE_RESET_MS && Array.isArray(parsed.cart)) {
          /* Reading an external store once on mount is exactly what an effect
             is for. It cannot be a lazy initialiser: this page is prerendered,
             and the server has no sessionStorage for the first render to
             agree with. */
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setCart(parsed.cart);
        }
      }
    } catch {
      /* a full or disabled storage is not worth an error message */
    }
  }, []);

  useEffect(() => {
    try {
      if (cart.length === 0) sessionStorage.removeItem(CART_KEY);
      else sessionStorage.setItem(CART_KEY, JSON.stringify({ cart, at: Date.now() }));
    } catch {
      /* ignore */
    }
  }, [cart]);

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

  const rate = customer?.tax_rate ?? shopRate;
  const wholesale = customer?.is_wholesale ?? false;

  const priceFor = useCallback(
    (l: Line) => {
      if (!wholesale) return l.price;
      const p = catalogue.find((c) => c.sku === l.sku);
      return p?.wholesale_price && p.wholesale_price > 0 ? p.wholesale_price : l.price;
    },
    [wholesale, catalogue],
  );

  const totals = useMemo(() => {
    const subtotal = round2(cart.reduce((s, l) => s + priceFor(l) * l.qty, 0));
    const tax = wholesale ? 0 : round2(subtotal * rate);
    const before = round2(subtotal + tax);
    const credit =
      useCredit && customer && customer.credit > 0
        ? round2(Math.min(customer.credit, before))
        : 0;
    return { subtotal, tax, credit, total: round2(Math.max(0, before - credit)) };
  }, [cart, priceFor, wholesale, rate, useCredit, customer]);

  const count = cart.reduce((s, l) => s + l.qty, 0);

  /** Sets the quantity for a line outright, rather than adding one at a time. */
  function commitQty(p: Product, qty: number) {
    setCart((c) => {
      const without = c.filter((l) => l.sku !== p.sku);
      if (qty <= 0) return without;
      const existing = c.find((l) => l.sku === p.sku);
      const line: Line = existing
        ? { ...existing, qty }
        : { sku: p.sku, name: p.name, price: p.price, qty };
      // A new item goes to the top, where it can be seen — added to the end it
      // lands below the fold on a long order, which is exactly the complaint
      // the till had. Changing the quantity of something already in the basket
      // leaves it where it is; the highlight is what says it changed, and
      // shuffling the list under someone's finger would be worse.
      return existing ? c.map((l) => (l.sku === p.sku ? line : l)) : [line, ...c];
    });
    setPicking(null);
    setFlash(p.sku);
    setQuery("");
    searchRef.current?.focus();
  }

  function setQty(sku: string, qty: number) {
    setCart((c) =>
      qty <= 0 ? c.filter((l) => l.sku !== sku) : c.map((l) => (l.sku === sku ? { ...l, qty } : l)),
    );
  }

  const reset = useCallback(() => {
    setPhase("shop");
    setCart([]);
    setQuery("");
    setCustomer(null);
    setReceipt(null);
    setError(null);
    setPayment("cash");
    setUseCredit(true);
    setSheetOpen(false);
  }, []);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash]);

  /**
   * A shared counter iPad keeps one session all day. Without this, a customer
   * who wanders off mid-order leaves their basket — and their name — on screen
   * for the next person.
   */
  useEffect(() => {
    if (phase === "done") {
      const t = setTimeout(reset, DONE_RESET_MS);
      return () => clearTimeout(t);
    }
    if (cart.length === 0 && !customer) return;
    let timer: ReturnType<typeof setTimeout>;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(reset, IDLE_RESET_MS);
    };
    bump();
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [phase, cart.length, customer, reset]);

  function finish() {
    if (!customer) return;
    setError(null);
    start(async () => {
      const res = await recordKioskSale({
        customerId: customer.id,
        lines: cart.map((l) => ({ sku: l.sku, qty: l.qty })),
        payment,
        useCredit,
      });
      if (res.ok) {
        setReceipt(res);
        setCart([]);
        setPhase("done");
      } else {
        // The basket is never cleared on failure. The old kiosk could leave you
        // looking at a success screen for a sale that was never written.
        setError(res.message);
      }
    });
  }

  const makeBasket = (inline: boolean) => (
    <Basket
      inline={inline}
      cart={cart}
      priceFor={priceFor}
      subtotal={totals.subtotal}
      flash={flash}
      onQty={setQty}
      onClear={() => setCart([])}
      onCheckout={() => {
        setSheetOpen(false);
        setPhase("checkout");
      }}
    />
  );
  const basket = makeBasket(false);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 pb-32 pt-5 lg:pb-8">
      <Header online={online} />

      {phase === "shop" && (
        /* Two columns from 1024px up, which covers the iPad in both
           orientations. The basket is simply always on screen there — the old
           bar at the bottom told you a total but never what was in it. */
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-7">
          <div className="min-w-0">
            {/* The search field carries the visual weight, because searching is
                the whole interaction. A large heading above it was competing
                for attention with the thing people actually use. */}
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
                  className="tap h-[84px] w-full rounded-2xl border border-line bg-surface pl-[68px] pr-6 text-[25px] text-ink outline-none placeholder:text-ink-faint focus:border-spruce focus:shadow-[0_0_0_4px_rgba(31,110,90,0.13)]"
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
                Tap an item to choose how many you&apos;d like.
              </p>
            </div>

            {/* Somewhere to say who you are, before checkout rather than only
                at it. A customer asked to "log in" found nothing on this
                screen but the item search, typed her name into that, and gave
                up — the shop screen showed the buttons she'd been looking at
                and nothing about her. Identifying yourself is the first thing
                people try at a counter, so it belongs where they first look. */}
            <div className="rise mt-4">
              {customer ? (
                <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-3.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[17px] font-medium">
                      Shopping as {customer.name}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      {customer.is_wholesale && <span className="pill pill-quiet">Wholesale</span>}
                      {customer.credit > 0 && (
                        <span className="pill pill-paid">{money(customer.credit)} credit</span>
                      )}
                    </span>
                  </span>
                  <button
                    onClick={() => setCustomer(null)}
                    className="tap shrink-0 rounded-xl border border-line px-4 py-2.5 text-[15px] font-medium"
                  >
                    Not me
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setSigningIn(true)}
                  className="tap flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-line bg-surface px-5 py-3.5 text-left active:border-spruce active:bg-spruce-light"
                >
                  <span className="text-[17px]">
                    <span className="font-medium">Add your name</span>
                    <span className="ml-2 text-ink-faint">so we know whose order this is</span>
                  </span>
                  <span aria-hidden className="text-[19px] text-ink-faint">
                    →
                  </span>
                </button>
              )}
            </div>

            {/* Once there is something in the basket, the basket is what goes
                here. "Popular right now" is for someone who hasn't started;
                after that it's a wall of tiles between you and your order,
                and on a portrait iPad — no room for the sidebar — the only
                way to see the order at all was a bar underneath the on-screen
                keyboard. Above 1024px the sidebar already shows it, so the
                space there can go on being useful. */}
            {query.trim().length >= 2 ? (
              <Results results={results} query={query} cart={cart} onPick={setPicking} />
            ) : (
              <>
                {cart.length > 0 && <div className="mt-6 lg:hidden">{makeBasket(true)}</div>}
                <div className={cart.length > 0 ? "hidden lg:block" : undefined}>
                  <Popular items={popular} cart={cart} onPick={setPicking} />
                </div>
              </>
            )}
          </div>

          <aside className="sticky top-5 hidden lg:block">{basket}</aside>
        </div>
      )}

      {phase === "checkout" && (
        <Checkout
          cart={cart}
          priceFor={priceFor}
          totals={totals}
          customer={customer}
          onCustomer={setCustomer}
          rate={rate}
          useCredit={useCredit}
          onUseCredit={setUseCredit}
          payment={payment}
          onPayment={setPayment}
          venmoUser={venmoUser}
          venmoQr={venmoQr}
          onQty={setQty}
          onBack={() => setPhase("shop")}
          onFinish={finish}
          pending={pending}
          error={error}
          online={online}
        />
      )}

      {phase === "done" && receipt && (
        <Done receipt={receipt} mailReady={mailReady} onNew={reset} />
      )}

      {picking && (
        <QuantitySheet
          product={picking}
          inBasket={cart.find((l) => l.sku === picking.sku)?.qty ?? 0}
          onClose={() => setPicking(null)}
          onConfirm={(qty) => commitQty(picking, qty)}
        />
      )}

      {/* Only while searching, when results have pushed the basket off screen.
          The rest of the time the basket is sitting in the page above, and a
          fixed bar would only be a second copy of it — hidden behind the iPad
          keyboard, which is where this one was. */}
      {phase === "shop" && cart.length > 0 && query.trim().length >= 2 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-4 backdrop-blur lg:hidden">
          <button
            onClick={() => setSheetOpen(true)}
            className="tap mx-auto flex h-[68px] w-full max-w-3xl items-center justify-between rounded-2xl bg-spruce px-6 text-white"
          >
            <span className="text-[18px] font-semibold">
              Your basket · {count} item{count === 1 ? "" : "s"}
            </span>
            <span className="tabular text-[24px] font-semibold">{money(totals.subtotal)}</span>
          </button>
        </div>
      )}

      {sheetOpen && (
        <Modal onClose={() => setSheetOpen(false)} labelledBy="basket-title">
          <div className="w-[min(92vw,520px)]">{basket}</div>
        </Modal>
      )}

      {signingIn && (
        <Modal onClose={() => setSigningIn(false)} labelledBy="whoami-title">
          <div className="pop w-[min(94vw,520px)] rounded-2xl border border-line bg-surface p-6">
            <h2 id="whoami-title" className="font-display text-[22px] font-semibold">
              What&apos;s your name?
            </h2>
            <p className="mt-1.5 text-[15px] leading-relaxed text-ink-faint">
              So the order goes on your account. If you&apos;re new, you can add yourself.
            </p>
            <div className="mt-4">
              <WhoAmI
                autoFocus
                onPick={(c) => {
                  setCustomer(c);
                  setSigningIn(false);
                }}
              />
            </div>
            <button
              onClick={() => setSigningIn(false)}
              className="tap mt-5 h-14 w-full rounded-xl border border-line text-[16px] font-medium"
            >
              Not now
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- pieces --- */

function Header({ online }: { online: boolean }) {
  // Three taps on the shop's name opens the PIN. It looks like a heading,
  // behaves like a heading, and is the one thing on this screen that never
  // scrolls away — so staff have something to remember rather than a dot to
  // hunt for. Nobody triple-taps a title by accident.
  const { tapHandlers, dialog } = useStaffUnlock();

  return (
    <header className="mb-6 flex items-baseline justify-between gap-4 border-b border-line pb-4">
      <div {...tapHandlers} className="font-display select-none text-[26px] font-semibold tracking-tight">
        Notion&nbsp;to&nbsp;<span className="text-spruce">Sew</span>
      </div>
      {dialog}
      {online ? (
        <div className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-ink-faint">
          Quality Supplies · Local Service
        </div>
      ) : (
        <div className="pill pill-due">Offline — searching still works</div>
      )}
    </header>
  );
}

/** Shown on a tile when that item is already in the basket. */
function InBasket({ qty }: { qty: number }) {
  if (qty <= 0) return null;
  return <span className="pill pill-paid">{qty} in basket</span>;
}

function Results({
  results,
  query,
  cart,
  onPick,
}: {
  results: Product[];
  query: string;
  cart: Line[];
  onPick: (p: Product) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="rise mt-8 rounded-2xl border border-line bg-surface px-6 py-12 text-center">
        <p className="font-display text-[22px]">No items match “{query.trim()}”.</p>
        <p className="mt-2 text-[15px] text-ink-faint">
          Try fewer words, or ask and we&apos;ll find it for you.
        </p>
      </div>
    );
  }
  return (
    <ul className="mt-5 space-y-3">
      {results.map((p) => {
        const have = cart.find((l) => l.sku === p.sku)?.qty ?? 0;
        return (
          <li key={p.sku}>
            <button
              onClick={() => onPick(p)}
              className="tap flex w-full items-center gap-4 rounded-2xl border border-line bg-surface px-5 py-4 text-left active:border-spruce active:bg-spruce-light"
            >
              <span className="min-w-0 flex-1">
                {/* The item number leads. Buttons live in drawers labelled by
                    number and customers write their lists that way, so that is
                    what people are matching against. The description still
                    prints in full underneath, never truncated — the old kiosk
                    cut it at 22 characters and you can't buy what you can't
                    read. */}
                <span className="tabular block text-[19px] font-semibold leading-snug">
                  {p.sku}
                </span>
                <span className="mt-0.5 block text-[15.5px] leading-snug text-ink-soft">
                  {p.name}
                </span>
                {have > 0 && (
                  <span className="mt-1.5 block">
                    <InBasket qty={have} />
                  </span>
                )}
              </span>
              <span className="tabular shrink-0 text-[20px] font-semibold">{money(p.price)}</span>
              <span className="tap flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-spruce text-[28px] font-light leading-none text-white">
                +
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Popular({
  items,
  cart,
  onPick,
}: {
  items: Product[];
  cart: Line[];
  onPick: (p: Product) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
        Popular right now
      </h2>
      <ul className="grid grid-cols-2 gap-3">
        {items.map((p) => {
          const have = cart.find((l) => l.sku === p.sku)?.qty ?? 0;
          return (
            <li key={p.sku}>
              <button
                onClick={() => onPick(p)}
                className="tap flex h-full w-full flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-5 text-left active:border-spruce active:bg-spruce-light"
              >
                <span>
                  <span className="tabular block text-[17px] font-semibold leading-snug">
                    {p.sku}
                  </span>
                  <span className="mt-0.5 block text-[14.5px] leading-snug text-ink-soft">
                    {p.name}
                  </span>
                  {have > 0 && (
                    <span className="mt-1.5 block">
                      <InBasket qty={have} />
                    </span>
                  )}
                </span>
                <span className="flex items-center justify-between">
                  <span className="tabular text-[19px] font-semibold">{money(p.price)}</span>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-spruce text-[26px] font-light leading-none text-white">
                    +
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const QUICK = [1, 2, 3, 4, 6, 12];

/**
 * How many?
 *
 * Tapping an item used to add exactly one, so buying a dozen buttons meant
 * twelve taps and no way to tell whether the eleventh registered. This asks
 * once, sets the quantity outright, and shows the line total before anything
 * goes in the basket.
 */
function QuantitySheet({
  product,
  inBasket,
  onClose,
  onConfirm,
}: {
  product: Product;
  inBasket: number;
  onClose: () => void;
  onConfirm: (qty: number) => void;
}) {
  const [qty, setQty] = useState(inBasket > 0 ? inBasket : 1);
  const updating = inBasket > 0;

  return (
    <Modal onClose={onClose} labelledBy="qty-title">
      <div className="pop w-[min(92vw,460px)] rounded-3xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]">
        <h2 id="qty-title" className="tabular font-display text-[23px] font-semibold leading-snug">
          {product.sku}
        </h2>
        <p className="mt-0.5 text-[16px] leading-snug text-ink-soft">{product.name}</p>
        <p className="mt-1.5 text-[15px] text-ink-faint">
          {money(product.price)} each
          {updating && ` · ${inBasket} already in your basket`}
        </p>

        <div className="mt-6 flex items-center justify-center gap-5">
          <button
            type="button"
            onClick={() => setQty((n) => Math.max(1, n - 1))}
            disabled={qty <= 1}
            aria-label="One fewer"
            className="tap flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-line bg-paper text-[34px] font-light leading-none disabled:opacity-30"
          >
            −
          </button>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={999}
            value={qty}
            aria-label="Quantity"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setQty(Number.isFinite(n) ? Math.min(999, Math.max(1, n)) : 1);
            }}
            className="no-spin tabular font-display h-[72px] w-[110px] rounded-2xl border border-line bg-paper text-center text-[34px] font-semibold outline-none focus:border-spruce"
          />
          <button
            type="button"
            onClick={() => setQty((n) => Math.min(999, n + 1))}
            aria-label="One more"
            className="tap flex h-[72px] w-[72px] items-center justify-center rounded-2xl border border-line bg-paper text-[34px] font-light leading-none"
          >
            +
          </button>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {QUICK.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setQty(n)}
              className={`tap h-12 min-w-[56px] rounded-xl border px-3 text-[17px] font-medium ${
                qty === n
                  ? "border-spruce bg-spruce-light text-spruce-dark"
                  : "border-line bg-surface text-ink-soft"
              }`}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="tap h-[64px] flex-1 rounded-2xl border border-line bg-surface text-[17px] font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(qty)}
            className="tap flex h-[64px] flex-[1.6] items-center justify-center gap-2 rounded-2xl bg-spruce text-[17px] font-semibold text-white"
          >
            {updating ? "Update to" : "Add"} {qty}
            <span className="tabular opacity-80">· {money(product.price * qty)}</span>
          </button>
        </div>

        {updating && (
          <button
            type="button"
            onClick={() => onConfirm(0)}
            className="tap mt-2 h-12 w-full rounded-xl text-[15px] font-medium text-ink-faint active:bg-black/5"
          >
            Take it out of my basket
          </button>
        )}
      </div>
    </Modal>
  );
}

/** The basket, shown permanently on the iPad and in a sheet on smaller screens. */
function Basket({
  cart,
  priceFor,
  subtotal,
  flash,
  onQty,
  onClear,
  onCheckout,
  inline = false,
}: {
  cart: Line[];
  priceFor: (l: Line) => number;
  subtotal: number;
  flash: string | null;
  onQty: (sku: string, qty: number) => void;
  onClear: () => void;
  onCheckout: () => void;
  /** Sitting in the page rather than in the sidebar, so it starts further
      down the screen and has to be shorter to keep Check out in view — with
      an iPad keyboard up there is less room again. */
  inline?: boolean;
}) {
  const count = cart.reduce((s, l) => s + l.qty, 0);

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-2xl border border-line bg-surface ${
        inline ? "max-h-[52dvh]" : "max-h-[calc(100dvh-140px)]"
      }`}
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-line-soft px-5 py-4">
        <h2 id="basket-title" className="font-display text-[19px] font-semibold">
          Your basket
        </h2>
        {count > 0 && (
          <span className="text-[13px] text-ink-faint">
            {count} item{count === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {cart.length === 0 ? (
        <p className="px-5 py-12 text-center text-[15px] leading-relaxed text-ink-faint">
          Nothing here yet.
          <br />
          Tap an item to add it.
        </p>
      ) : (
        <ul className="flex-1 divide-y divide-line-soft overflow-y-auto">
          {cart.map((l) => (
            <li
              key={l.sku}
              className={`px-4 py-3.5 transition-colors duration-500 ${
                flash === l.sku ? "bg-spruce-light" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 flex-1">
                  <span className="tabular block text-[16px] font-semibold leading-snug">
                    {l.sku}
                  </span>
                  <span className="mt-0.5 block text-[14px] leading-snug text-ink-soft">
                    {l.name}
                  </span>
                  <span className="tabular mt-0.5 block text-[13px] text-ink-faint">
                    {money(priceFor(l))} each
                  </span>
                </span>
                <span className="tabular shrink-0 text-[16px] font-semibold">
                  {money(priceFor(l) * l.qty)}
                </span>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <button
                  onClick={() => onQty(l.sku, l.qty - 1)}
                  aria-label={`One fewer ${l.name}`}
                  className="tap flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-[22px] leading-none"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  value={l.qty}
                  aria-label={`Quantity of ${l.name}`}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    onQty(l.sku, Number.isFinite(v) ? v : 0);
                  }}
                  className="no-spin tabular h-11 w-14 rounded-xl border border-line bg-surface text-center text-[17px] font-semibold"
                />
                <button
                  onClick={() => onQty(l.sku, l.qty + 1)}
                  aria-label={`One more ${l.name}`}
                  className="tap flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface text-[22px] leading-none"
                >
                  +
                </button>
                <button
                  onClick={() => onQty(l.sku, 0)}
                  aria-label={`Remove ${l.name}`}
                  className="tap ml-auto rounded-lg px-2 py-1 text-[13.5px] font-medium text-ink-faint active:bg-black/5"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-line-soft px-5 py-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] text-ink-soft">Subtotal</span>
          <span className="tabular font-display text-[24px] font-semibold">{money(subtotal)}</span>
        </div>
        <p className="mt-1 text-[12.5px] text-ink-faint">Tax is added at checkout.</p>

        <button
          onClick={onCheckout}
          disabled={cart.length === 0}
          className="tap mt-4 h-[60px] w-full rounded-2xl bg-spruce text-[18px] font-semibold text-white disabled:opacity-40"
        >
          Check out
        </button>
        {cart.length > 0 && (
          <button
            onClick={onClear}
            className="tap mt-2 h-11 w-full rounded-xl text-[14px] font-medium text-ink-faint active:bg-black/5"
          >
            Start over
          </button>
        )}
      </div>
    </div>
  );
}

function Checkout({
  cart,
  priceFor,
  totals,
  customer,
  onCustomer,
  rate,
  useCredit,
  onUseCredit,
  payment,
  onPayment,
  venmoUser,
  venmoQr,
  onQty,
  onBack,
  onFinish,
  pending,
  error,
  online,
}: {
  cart: Line[];
  priceFor: (l: Line) => number;
  totals: { subtotal: number; tax: number; credit: number; total: number };
  customer: KioskCustomer | null;
  onCustomer: (c: KioskCustomer | null) => void;
  rate: number;
  useCredit: boolean;
  onUseCredit: (v: boolean) => void;
  payment: "cash" | "check" | "venmo" | "invoice";
  onPayment: (p: "cash" | "check" | "venmo" | "invoice") => void;
  venmoUser: string;
  venmoQr: string | null;
  onQty: (sku: string, qty: number) => void;
  onBack: () => void;
  onFinish: () => void;
  pending: boolean;
  error: string | null;
  online: boolean;
}) {
  return (
    <div className="rise mx-auto max-w-3xl">
      <button onClick={onBack} className="tap btn btn-ghost btn-lg mb-5 w-full">
        ← Keep shopping
      </button>

      <Step n={1} title="Who's picking up?" done={Boolean(customer)}>
        {customer ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3.5">
            <span>
              <span className="block text-[19px] font-medium">{customer.name}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {customer.is_wholesale && <span className="pill pill-quiet">Wholesale</span>}
                {customer.credit > 0 && (
                  <span className="pill pill-paid">{money(customer.credit)} credit</span>
                )}
              </span>
            </span>
            <button onClick={() => onCustomer(null)} className="btn btn-ghost">
              Not me
            </button>
          </div>
        ) : (
          <WhoAmI onPick={onCustomer} />
        )}
      </Step>

      <Step n={2} title="Your items" done={cart.length > 0}>
        <ul className="space-y-3">
          {cart.map((l) => (
            <li
              key={l.sku}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4"
            >
              <span className="min-w-0 flex-1">
                <span className="tabular block text-[18px] font-semibold leading-snug">
                  {l.sku}
                </span>
                <span className="mt-0.5 block text-[15px] leading-snug text-ink-soft">
                  {l.name}
                </span>
                <span className="tabular mt-0.5 block text-[14px] text-ink-faint">
                  {money(priceFor(l))} each
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
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step="1"
                  value={l.qty}
                  aria-label={`Quantity of ${l.name}`}
                  onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    onQty(l.sku, Number.isFinite(v) ? v : 0);
                  }}
                  className="no-spin tabular h-14 w-16 rounded-xl border border-line bg-surface text-center text-[20px] font-semibold"
                />
                <button
                  onClick={() => onQty(l.sku, l.qty + 1)}
                  aria-label={`One more ${l.name}`}
                  className="tap flex h-14 w-14 items-center justify-center rounded-full border border-line bg-surface text-[26px] leading-none"
                >
                  +
                </button>
              </span>
              <span className="tabular w-24 shrink-0 text-right text-[19px] font-semibold">
                {money(priceFor(l) * l.qty)}
              </span>
            </li>
          ))}
        </ul>
      </Step>

      <Step n={3} title="How would you like to pay?" done>
        <div className="grid grid-cols-2 gap-2.5">
          {(
            [
              { v: "cash", label: "Cash" },
              { v: "check", label: "Check" },
              { v: "venmo", label: "Venmo" },
              { v: "invoice", label: "Bill me" },
            ] as const
          ).map((p) => (
            <button
              key={p.v}
              onClick={() => onPayment(p.v)}
              className={`tap h-16 rounded-2xl border text-[17px] font-medium ${
                payment === p.v
                  ? "border-spruce bg-spruce-light text-spruce-dark"
                  : "border-line bg-surface text-ink-soft"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {payment === "venmo" && venmoUser && (
          <div className="rise mt-3 flex items-center gap-4 rounded-2xl border border-line bg-surface p-4">
            {venmoQr && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={venmoQr}
                alt={`Venmo code for @${venmoUser}`}
                width={128}
                height={128}
                className="shrink-0 rounded-xl bg-white"
              />
            )}
            <p className="text-[16px] leading-relaxed text-ink-soft">
              Scan this with your phone, or send to <strong className="text-ink">@{venmoUser}</strong>,
              then show us the confirmation.
            </p>
          </div>
        )}
        {payment === "invoice" && (
          <p className="rise mt-3 text-[15px] text-ink-soft">
            We&apos;ll add this to your account and send you an invoice.
          </p>
        )}
      </Step>

      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <dl className="flex flex-col gap-2 text-[17px]">
          <TotalRow label="Subtotal" value={money(totals.subtotal)} />
          <TotalRow
            label={customer?.is_wholesale ? "Sales tax (wholesale — exempt)" : `Sales tax (${pct(rate)})`}
            value={money(totals.tax)}
          />
          {customer && customer.credit > 0 && (
            <div className="flex items-center justify-between gap-3">
              <label className="flex items-center gap-2.5 text-ink-soft">
                <input
                  type="checkbox"
                  checked={useCredit}
                  onChange={(e) => onUseCredit(e.target.checked)}
                  className="check"
                />
                Use your {money(customer.credit)} credit
              </label>
              <span className="tabular text-spruce">
                {totals.credit > 0 ? `−${money(totals.credit)}` : "—"}
              </span>
            </div>
          )}
        </dl>
        <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
          <span className="font-display text-[20px] font-semibold">Total</span>
          <span className="tabular font-display text-[32px] font-semibold leading-none">
            {money(totals.total)}
          </span>
        </div>
      </div>

      {error && (
        <div className="pop mt-4 rounded-xl border border-clay/30 bg-clay-light px-4 py-3.5">
          <p className="text-[16px] font-medium text-ink">{error}</p>
          <p className="mt-1 text-[14.5px] text-ink-soft">
            Nothing was charged and your basket is still here. Try again, or ask for help.
          </p>
        </div>
      )}

      {!online && !error && (
        <div className="mt-4 rounded-xl border border-amber/30 bg-amber-light px-4 py-3.5">
          <p className="text-[15.5px] text-ink-soft">
            The iPad is offline right now. Finishing needs a connection — it should come back on
            its own in a moment.
          </p>
        </div>
      )}

      <button
        onClick={onFinish}
        disabled={pending || !customer || cart.length === 0}
        className="tap mt-5 flex h-[76px] w-full items-center justify-center gap-3 rounded-2xl bg-spruce text-[20px] font-semibold text-white disabled:opacity-40"
      >
        {pending && (
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
        )}
        {pending ? "Saving your order…" : !customer ? "Find your name first" : "Finish"}
      </button>
    </div>
  );
}

function Step({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 flex items-center gap-2.5">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[12.5px] font-semibold ${
            done ? "bg-spruce text-white" : "bg-line-soft text-ink-faint"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <span className="text-[15px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          {title}
        </span>
      </h2>
      {children}
    </section>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

/**
 * Customer search runs on the server here, unlike the item catalogue. The
 * catalogue is public information; 226 names, phone numbers and email addresses
 * sitting in a page anyone in the shop can view source on is not.
 */
function WhoAmI({
  onPick,
  autoFocus = false,
}: {
  onPick: (c: KioskCustomer) => void;
  /** Only when the box is the reason the screen opened, so the keyboard
      doesn't come up over the order at checkout. */
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /**
   * Results are stored with the search they answer, so "which results am I
   * looking at" and "am I still waiting" are both read from that one fact
   * rather than kept in step by hand. A reply that arrives after the shopper
   * has typed another letter simply stops matching and is ignored.
   */
  const [found, setFound] = useState<{ q: string; list: KioskCustomer[] } | null>(null);
  const term = q.trim();
  const hits = found?.q === term ? found.list : [];
  const searching = term.length >= 2 && found?.q !== term;

  useEffect(() => {
    if (term.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const list = await kioskFindCustomers(term);
        if (!cancelled) setFound({ q: term, list });
      } catch {
        if (!cancelled) setFound({ q: term, list: [] });
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term]);

  if (joining) {
    return (
      <form
        className="rise rounded-2xl border border-line bg-surface p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const name = (form.elements.namedItem("name") as HTMLInputElement).value;
          const email = (form.elements.namedItem("email") as HTMLInputElement).value;
          start(async () => {
            const res = await kioskJoin({ name, email });
            if (res.ok && res.id) {
              onPick({
                id: res.id,
                name: res.name ?? name,
                is_wholesale: false,
                credit: 0,
                tax_rate: null,
              });
            } else setError(res.message);
          });
        }}
      >
        <label className="block">
          <span className="text-[15px] font-medium">Your name</span>
          <input
            name="name"
            defaultValue={q}
            required
            autoFocus
            autoComplete="name"
            className="tap mt-2 h-16 w-full rounded-xl border border-line bg-paper px-4 text-[19px] outline-none focus:border-spruce"
          />
        </label>
        <label className="mt-4 block">
          <span className="text-[15px] font-medium">Email — so we can send your receipt</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            className="tap mt-2 h-16 w-full rounded-xl border border-line bg-paper px-4 text-[19px] outline-none focus:border-spruce"
          />
        </label>
        {error && <p className="mt-3 text-[15px] text-clay">{error}</p>}
        <div className="mt-4 flex gap-2.5">
          <button
            type="button"
            onClick={() => setJoining(false)}
            className="tap h-14 flex-1 rounded-xl border border-line bg-surface text-[16px] font-medium"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={pending}
            className="tap h-14 flex-1 rounded-xl bg-spruce text-[16px] font-semibold text-white disabled:opacity-40"
          >
            {pending ? "One moment…" : "That's me"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div>
      <input
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Start typing your name"
        autoComplete="off"
        aria-label="Search for your name"
        className="tap h-[72px] w-full rounded-2xl border border-line bg-surface px-5 text-[21px] outline-none placeholder:text-ink-faint focus:border-spruce focus:shadow-[0_0_0_4px_rgba(31,110,90,0.13)]"
      />

      {q.trim().length >= 2 && (
        <div className="mt-3">
          {searching && hits.length === 0 ? (
            <p className="px-1 text-[15px] text-ink-faint">Looking…</p>
          ) : hits.length === 0 ? (
            <div className="rounded-2xl border border-line bg-surface px-5 py-6 text-center">
              <p className="text-[17px]">We don&apos;t have anyone by that name yet.</p>
              <button
                onClick={() => setJoining(true)}
                className="tap mt-4 h-14 w-full rounded-xl bg-spruce text-[16px] font-semibold text-white"
              >
                Add me as “{q.trim()}”
              </button>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {hits.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => onPick(c)}
                    className="tap flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4 text-left active:border-spruce active:bg-spruce-light"
                  >
                    <span className="text-[19px] font-medium">{c.name}</span>
                    {c.credit > 0 && <span className="pill pill-paid">{money(c.credit)} credit</span>}
                  </button>
                </li>
              ))}
              <li>
                <button
                  onClick={() => setJoining(true)}
                  className="tap w-full rounded-2xl border border-dashed border-line px-5 py-3.5 text-[16px] text-ink-faint"
                >
                  None of these — add me
                </button>
              </li>
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Done({
  receipt,
  mailReady,
  onNew,
}: {
  receipt: KioskSaleResult;
  mailReady: boolean;
  onNew: () => void;
}) {
  const [email, setEmail] = useState(receipt.customerEmail ?? "");
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="rise mx-auto max-w-xl">
      <div className="rounded-2xl border border-line bg-surface px-6 py-9 text-center">
        <div className="pop mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-spruce-light">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-spruce" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="font-display mt-5 text-[30px] font-semibold">Thank you!</h2>
        <p className="mt-2 text-[18px] text-ink-soft">
          {receipt.message} · <span className="tabular">{money(receipt.total ?? 0)}</span>
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-surface p-5">
        <h3 className="text-[15px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Your receipt
        </h3>

        {sent ? (
          <p className="mt-3 text-[17px] text-spruce">Sent to {sent}.</p>
        ) : mailReady ? (
          <>
            <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                aria-label="Email address for the receipt"
                className="tap h-16 flex-1 rounded-xl border border-line bg-paper px-4 text-[18px] outline-none focus:border-spruce"
              />
              <button
                disabled={pending || !email.trim()}
                onClick={() =>
                  start(async () => {
                    setError(null);
                    const res = await kioskEmailReceipt(
                      receipt.invoiceId!,
                      receipt.token!,
                      email,
                    );
                    if (res.ok) setSent(email.trim());
                    else setError(res.message);
                  })
                }
                className="tap h-16 rounded-xl bg-spruce px-7 text-[17px] font-semibold text-white disabled:opacity-40"
              >
                {pending ? "Sending…" : "Email it"}
              </button>
            </div>
            {error && <p className="mt-2.5 text-[15px] text-clay">{error}</p>}
          </>
        ) : (
          <p className="mt-3 text-[16px] text-ink-soft">
            Ask at the counter and we&apos;ll print one for you.
          </p>
        )}

        <a
          href={`/api/invoice/${receipt.invoiceId}?t=${receipt.token}`}
          target="_blank"
          rel="noopener"
          className="tap mt-3 flex h-16 items-center justify-center rounded-xl border border-line bg-surface text-[17px] font-medium"
        >
          Open a printable copy
        </a>
      </div>

      <button
        onClick={onNew}
        className="tap mt-4 h-[68px] w-full rounded-2xl bg-ink text-[18px] font-semibold text-white"
      >
        Done
      </button>
      <p className="mt-3 text-center text-[14px] text-ink-faint">
        This screen clears itself in a minute or two.
      </p>
    </div>
  );
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

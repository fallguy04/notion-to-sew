"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { CustomerLite, ProductFull, PaymentMethod } from "@/lib/db";
import { money, pct } from "@/lib/format";
import { Card, CardHead, Field } from "@/components/ui";
import { Spinner } from "@/components/form";
import Modal from "@/components/modal";
import ProductPicker from "@/components/product-picker";
import CustomerPicker from "@/components/customer-picker";
import { useToast } from "@/components/toast";
import { recordSaleAction, posAddCustomer, type SaleResponse } from "./actions";

type Line = { sku: string | null; name: string; qty: number; price: number };

const PAYMENTS: { value: PaymentMethod; label: string; hint?: string }[] = [
  { value: "check", label: "Check" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "venmo", label: "Venmo" },
  { value: "invoice", label: "Bill later", hint: "Creates an unpaid invoice" },
];

/**
 * The till.
 *
 * The customer is chosen first, before anything else. That ordering is the
 * whole point: wholesale pricing, the tax rate and whether store credit is
 * available all depend on who is buying, and the old screen asked last — so
 * every price on it up to that moment was a guess that then had to be redone.
 */
export default function PosClient({
  products,
  customers,
  shopRate,
  venmoUser,
  venmoQr,
  preselect,
}: {
  products: ProductFull[];
  customers: CustomerLite[];
  shopRate: number;
  venmoUser: string;
  venmoQr: string | null;
  preselect: CustomerLite | null;
}) {
  const [customer, setCustomer] = useState<CustomerLite | null>(preselect);
  const [guest, setGuest] = useState(false);
  const [cart, setCart] = useState<Line[]>([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [freight, setFreight] = useState(0);
  const [applyTax, setApplyTax] = useState(true);
  const [useCredit, setUseCredit] = useState(true);
  const [payment, setPayment] = useState<PaymentMethod>("check");
  const [termsDays, setTermsDays] = useState(30);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [done, setDone] = useState<SaleResponse | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  const chosen = customer !== null || guest;
  const isWholesale = customer?.is_wholesale ?? false;
  const rate = customer?.tax_rate ?? shopRate;

  const priceFor = (p: ProductFull) =>
    isWholesale && p.wholesale_price && p.wholesale_price > 0 ? p.wholesale_price : p.price;

  const totals = useMemo(() => {
    const subtotal = round2(cart.reduce((s, l) => s + l.qty * l.price, 0));
    const discount = round2(subtotal * (discountPct / 100));
    const taxable = applyTax && !isWholesale;
    const tax = taxable ? round2((subtotal - discount) * rate) : 0;
    const beforeCredit = round2(subtotal - discount + freight + tax);
    const credit =
      useCredit && customer && customer.credit > 0
        ? round2(Math.min(customer.credit, beforeCredit))
        : 0;
    return {
      subtotal,
      discount,
      tax,
      credit,
      total: round2(Math.max(0, beforeCredit - credit)),
    };
  }, [cart, discountPct, applyTax, isWholesale, rate, freight, useCredit, customer]);

  function addItem(p: ProductFull) {
    setCart((c) => {
      const found = c.find((l) => l.sku === p.sku);
      if (found) return c.map((l) => (l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { sku: p.sku, name: p.name, qty: 1, price: priceFor(p) }];
    });
  }

  function reset() {
    setCustomer(null);
    setGuest(false);
    setCart([]);
    setDiscountPct(0);
    setFreight(0);
    setApplyTax(true);
    setUseCredit(true);
    setPayment("check");
    setDone(null);
  }

  function submit() {
    start(async () => {
      const res = await recordSaleAction({
        customerId: customer?.id ?? null,
        lines: cart.map((l) => ({
          sku: l.sku,
          description: l.name,
          qty: l.qty,
          unit_price: l.price,
        })),
        payment,
        discountPct,
        freight,
        applyTax,
        useCredit,
        termsDays: payment === "invoice" ? termsDays : 0,
        expectedTotal: totals.total,
      });
      if (res.ok) setDone(res);
      else toast(res.message, "bad");
    });
  }

  if (done?.ok) {
    return <Success res={done} customer={customer} onNew={reset} />;
  }

  return (
    <>
      {/* --------------------------------------------------- who's buying -- */}
      {!chosen ? (
        <Card className="rise mx-auto max-w-2xl overflow-visible">
          <CardHead
            title="Who's buying?"
            hint="Pricing, tax and store credit all depend on this, so it comes first."
          />
          <div className="px-5 py-5">
            <CustomerPicker
              customers={customers}
              autoFocus
              onPick={setCustomer}
              onNew={(typed) => setAddingFor(typed)}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setGuest(true)} className="btn btn-ghost">
                Walk-in — no account
              </button>
              <button
                type="button"
                onClick={() => setAddingFor("")}
                className="btn btn-quiet btn-sm"
              >
                Add a new customer
              </button>
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-ink-faint">
              A walk-in can pay by cash, check, card or Venmo. Billing later needs an account, so
              there&apos;s someone to send the invoice to.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* ------------------------------------------------------ items -- */}
          <div className="flex flex-col gap-5">
            <Card className="overflow-visible">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[15px] font-medium">
                    {customer ? customer.name : "Walk-in customer"}
                  </span>
                  {isWholesale && <span className="pill pill-quiet">Wholesale pricing</span>}
                  {customer && customer.credit > 0 && (
                    <span className="pill pill-paid">{money(customer.credit)} credit</span>
                  )}
                  {customer?.tax_rate != null && (
                    <span className="pill pill-quiet">Tax {pct(customer.tax_rate)}</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {customer && (
                    <Link
                      href={`/admin/customers/${customer.id}`}
                      className="btn btn-quiet btn-sm"
                      target="_blank"
                    >
                      Profile
                    </Link>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setCustomer(null);
                      setGuest(false);
                    }}
                    className="btn btn-quiet btn-sm"
                  >
                    Change
                  </button>
                </div>
              </div>

              <div className="px-5 py-5">
                <ProductPicker
                  items={products}
                  autoFocus
                  wholesale={isWholesale}
                  onPick={(p) => addItem(products.find((x) => x.sku === p.sku)!)}
                  placeholder="Search for an item to add"
                />
                <p className="mt-2.5 text-[12.5px] text-ink-faint">
                  Type to search, ↑ ↓ to move, Enter to add. Prices and quantities can be changed
                  after they&apos;re in the basket.
                </p>
              </div>
            </Card>

            <Card>
              <CardHead
                title="Basket"
                hint={cart.length === 0 ? undefined : `${cart.length} line${cart.length === 1 ? "" : "s"}`}
                action={
                  cart.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setCart([])}
                      className="btn btn-quiet btn-sm text-ink-faint"
                    >
                      Empty it
                    </button>
                  ) : undefined
                }
              />
              {cart.length === 0 ? (
                <p className="px-5 py-10 text-center text-[14px] text-ink-faint">
                  Nothing added yet.
                </p>
              ) : (
                <ul className="divide-y divide-line-soft">
                  {cart.map((l, i) => (
                    <li key={`${l.sku}-${i}`} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14.5px] font-medium">{l.name}</span>
                        <span className="block text-[12px] text-ink-faint">{l.sku ?? "custom"}</span>
                      </span>

                      <span className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={`One fewer ${l.name}`}
                          onClick={() =>
                            setCart((c) =>
                              c
                                .map((x, j) => (j === i ? { ...x, qty: x.qty - 1 } : x))
                                .filter((x) => x.qty > 0),
                            )
                          }
                          className="tap flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[18px] leading-none"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          value={l.qty}
                          min={0}
                          step="1"
                          aria-label={`Quantity of ${l.name}`}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setCart((c) =>
                              c
                                .map((x, j) => (j === i ? { ...x, qty: Number.isFinite(v) ? v : 0 } : x))
                                .filter((x, j) => j !== i || x.qty > 0),
                            );
                          }}
                          className="tabular h-8 w-14 rounded-lg border border-line bg-surface text-center text-[14px]"
                        />
                        <button
                          type="button"
                          aria-label={`One more ${l.name}`}
                          onClick={() =>
                            setCart((c) => c.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))
                          }
                          className="tap flex h-8 w-8 items-center justify-center rounded-lg border border-line text-[18px] leading-none"
                        >
                          +
                        </button>
                      </span>

                      <span className="relative w-24 shrink-0">
                        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">
                          $
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.price}
                          aria-label={`Unit price of ${l.name}`}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setCart((c) =>
                              c.map((x, j) =>
                                j === i ? { ...x, price: Number.isFinite(v) ? v : 0 } : x,
                              ),
                            );
                          }}
                          className="tabular h-8 w-full rounded-lg border border-line bg-surface pl-5 pr-1.5 text-right text-[14px]"
                        />
                      </span>

                      <span className="tabular w-20 shrink-0 text-right text-[14.5px] font-semibold">
                        {money(l.qty * l.price)}
                      </span>

                      <button
                        type="button"
                        onClick={() => setCart((c) => c.filter((_, j) => j !== i))}
                        aria-label={`Remove ${l.name}`}
                        className="tap shrink-0 rounded-lg p-1.5 text-ink-faint hover:text-clay"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* ----------------------------------------------------- totals -- */}
          <div className="lg:sticky lg:top-6 lg:self-start">
            <Card>
              <CardHead title="Total" />
              <div className="px-5 py-5">
                <div className="flex flex-col gap-2.5 text-[14px]">
                  <Row label="Subtotal" value={money(totals.subtotal)} />

                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="disc" className="text-ink-soft">
                      Discount
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          id="disc"
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          value={discountPct}
                          onChange={(e) => setDiscountPct(clamp(parseFloat(e.target.value) || 0, 0, 100))}
                          className="tabular h-8 w-[70px] rounded-lg border border-line bg-surface pl-2 pr-6 text-right text-[14px]"
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">
                          %
                        </span>
                      </div>
                      <span className="tabular w-20 text-right">
                        {totals.discount > 0 ? `−${money(totals.discount)}` : "—"}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="freight" className="text-ink-soft">
                      Shipping
                    </label>
                    <div className="relative w-[104px]">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint">
                        $
                      </span>
                      <input
                        id="freight"
                        type="number"
                        min="0"
                        step="0.01"
                        value={freight}
                        onChange={(e) => setFreight(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="tabular h-8 w-full rounded-lg border border-line bg-surface pl-5 pr-2 text-right text-[14px]"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    {isWholesale ? (
                      <span className="text-ink-faint">Sales tax — wholesale, exempt</span>
                    ) : (
                      <label className="flex items-center gap-2 text-ink-soft">
                        <input
                          type="checkbox"
                          checked={applyTax}
                          onChange={(e) => setApplyTax(e.target.checked)}
                          className="check"
                        />
                        Sales tax ({pct(rate)})
                      </label>
                    )}
                    <span className="tabular">{money(totals.tax)}</span>
                  </div>

                  {customer && customer.credit > 0 && (
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-ink-soft">
                        <input
                          type="checkbox"
                          checked={useCredit}
                          onChange={(e) => setUseCredit(e.target.checked)}
                          className="check"
                        />
                        Use store credit
                      </label>
                      <span className="tabular text-spruce">
                        {totals.credit > 0 ? `−${money(totals.credit)}` : "—"}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
                  <span className="font-display text-[16px] font-semibold">Amount due</span>
                  <span className="tabular font-display text-[28px] font-semibold leading-none">
                    {money(totals.total)}
                  </span>
                </div>

                <div className="mt-5">
                  <span className="label">How are they paying?</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {PAYMENTS.map((p) => {
                      const blocked = p.value === "invoice" && !customer;
                      const on = payment === p.value;
                      return (
                        <button
                          key={p.value}
                          type="button"
                          disabled={blocked}
                          title={blocked ? "Pick a customer to bill later" : p.hint}
                          onClick={() => setPayment(p.value)}
                          className={`tap rounded-xl border px-3 py-2 text-[14px] font-medium disabled:opacity-40 ${
                            on
                              ? "border-spruce bg-spruce-light text-spruce-dark"
                              : "border-line bg-surface text-ink-soft"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {payment === "invoice" && (
                  <div className="rise mt-3">
                    <Field label="Due in">
                      <select
                        value={termsDays}
                        onChange={(e) => setTermsDays(parseInt(e.target.value))}
                        className="field"
                      >
                        <option value={0}>On receipt</option>
                        <option value={14}>14 days</option>
                        <option value={30}>30 days</option>
                        <option value={60}>60 days</option>
                      </select>
                    </Field>
                  </div>
                )}

                {payment === "venmo" && venmoUser && (
                  <div className="rise mt-3 flex items-center gap-3 rounded-xl border border-line bg-paper p-3">
                    {venmoQr && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={venmoQr}
                        alt={`Venmo QR code for @${venmoUser}`}
                        width={96}
                        height={96}
                        className="shrink-0 rounded-lg bg-white"
                      />
                    )}
                    <p className="text-[13.5px] leading-relaxed text-ink-soft">
                      Have them scan this, or send to <strong className="text-ink">@{venmoUser}</strong>.
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  disabled={pending || cart.length === 0}
                  onClick={submit}
                  className="btn btn-primary btn-lg mt-5 w-full"
                >
                  {pending && <Spinner />}
                  {pending
                    ? "Recording…"
                    : payment === "invoice"
                      ? `Create invoice · ${money(totals.total)}`
                      : `Take payment · ${money(totals.total)}`}
                </button>
                <p className="mt-2.5 text-center text-[12px] leading-snug text-ink-faint">
                  Nothing is written until this is pressed, and it either all saves or none of it
                  does.
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}

      {addingFor !== null && (
        <NewCustomerDialog
          initialName={addingFor}
          onClose={() => setAddingFor(null)}
          onCreated={(c) => {
            setCustomer(c);
            setGuest(false);
            setAddingFor(null);
          }}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-soft">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}

function NewCustomerDialog({
  initialName,
  onClose,
  onCreated,
}: {
  initialName: string;
  onClose: () => void;
  onCreated: (c: CustomerLite) => void;
}) {
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [wholesale, setWholesale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Modal onClose={onClose} labelledBy="pos-newc-title">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await posAddCustomer({ name, phone, email, isWholesale: wholesale });
            if (res.ok && res.id) {
              onCreated({
                id: res.id,
                name: name.trim(),
                email: email || null,
                phone: phone || null,
                credit: 0,
                is_wholesale: wholesale,
                tax_rate: null,
              });
            } else setError(res.message);
          });
        }}
        className="pop w-full max-w-[420px] rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]"
      >
        <h2 id="pos-newc-title" className="font-display text-[20px] font-semibold">
          New customer
        </h2>
        <p className="mt-1 text-[13.5px] text-ink-faint">
          They&apos;ll be selected for this sale as soon as you save.
        </p>

        <div className="mt-5 flex flex-col gap-3.5">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              className="field"
            />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                className="field"
              />
            </Field>
            <Field label="Email">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                className="field"
              />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-[14px]">
            <input
              type="checkbox"
              checked={wholesale}
              onChange={(e) => setWholesale(e.target.checked)}
              className="check"
            />
            Wholesale account
          </label>
        </div>

        {error && <p className="pop mt-3 text-[13.5px] text-clay">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={pending || !name.trim()} className="btn btn-primary">
            {pending && <Spinner />}
            Save & select
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Success({
  res,
  customer,
  onNew,
}: {
  res: SaleResponse;
  customer: CustomerLite | null;
  onNew: () => void;
}) {
  return (
    <Card className="rise mx-auto max-w-lg">
      <div className="px-7 py-8 text-center">
        <div className="pop mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-spruce-light">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-spruce" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="font-display mt-5 text-[24px] font-semibold">{res.message}</h2>
        <p className="mt-1.5 text-[14px] text-ink-soft">
          {customer ? customer.name : "Walk-in customer"}
        </p>

        <div className="mt-7 grid gap-2 sm:grid-cols-2">
          <a
            href={`/api/invoice/${res.invoiceId}`}
            target="_blank"
            rel="noopener"
            className="btn btn-ghost"
          >
            Print or save the PDF
          </a>
          <Link href={`/admin/invoices/${res.invoiceId}`} className="btn btn-ghost">
            Open the invoice
          </Link>
        </div>

        <button type="button" onClick={onNew} className="btn btn-primary btn-lg mt-3 w-full">
          Start another sale
        </button>
      </div>
    </Card>
  );
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

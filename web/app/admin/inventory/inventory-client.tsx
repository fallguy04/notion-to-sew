"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductFull } from "@/lib/db";
import { money, isoDate, dateTime } from "@/lib/format";
import { Card, Empty, Field, Note } from "@/components/ui";
import { Submit, Result, Spinner } from "@/components/form";
import Modal from "@/components/modal";
import ProductPicker from "@/components/product-picker";
import { useToast } from "@/components/toast";
import {
  bulkUpdateAction,
  type BulkEdit,
  restockAction,
  createProductAction,
  saveProductAction,
  countStockAction,
  historyAction,
  previewImportAction,
  commitImportAction,
  type ImportPreview,
} from "./actions";

type Filter = "all" | "out" | "low" | "nocost" | "inactive";
const LIMIT = 120;

export default function InventoryClient({
  products,
  openRestock,
  initialFilter,
}: {
  products: ProductFull[];
  openRestock: boolean;
  initialFilter: Filter;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [restocking, setRestocking] = useState(openRestock);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<ProductFull | null>(null);
  const [bulk, setBulk] = useState(false);
  const [edits, setEdits] = useState<Record<string, BulkEdit>>({});
  const [saving, startSave] = useTransition();
  const toast = useToast();
  const router = useRouter();

  const dirtyCount = Object.keys(edits).length;

  const editCell = (sku: string, field: keyof Omit<BulkEdit, "sku">, raw: string) => {
    setEdits((e) => {
      const next = { ...e };
      const entry = { ...(next[sku] ?? { sku }) };
      const n = parseFloat(raw);
      if (raw.trim() === "") {
        // Blanking cost or wholesale means "none", which is a real value here;
        // blanking a price or a count means "leave it alone".
        if (field === "cost" || field === "wholesalePrice") entry[field] = null;
        else delete entry[field];
      } else if (Number.isFinite(n)) {
        entry[field] = n;
      }
      if (Object.keys(entry).length <= 1) delete next[sku];
      else next[sku] = entry;
      return next;
    });
  };

  const valueFor = (p: ProductFull, field: "price" | "cost" | "wholesalePrice" | "stock") => {
    const e = edits[p.sku];
    if (e && field in e) {
      const v = e[field];
      return v === null || v === undefined ? "" : String(v);
    }
    const current =
      field === "price" ? p.price
      : field === "cost" ? p.cost
      : field === "wholesalePrice" ? p.wholesale_price
      : p.stock_qty;
    return current === null || current === undefined ? "" : String(current);
  };

  function saveBulk() {
    startSave(async () => {
      const res = await bulkUpdateAction(Object.values(edits));
      toast(res!.message, res!.ok ? "good" : "bad");
      if (res!.ok) {
        setEdits({});
        setBulk(false);
        router.refresh();
      }
    });
  }

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const terms = needle.split(/\s+/).filter(Boolean);
    return products.filter((p) => {
      if (filter === "out" && p.stock_qty > 0) return false;
      if (filter === "low" && (p.stock_qty > 3 || p.stock_qty <= 0)) return false;
      if (filter === "nocost" && p.cost && p.cost > 0) return false;
      if (filter === "inactive" && p.active) return false;
      if (filter !== "inactive" && !p.active) return false;
      if (!terms.length) return true;
      const hay = `${p.sku} ${p.name} ${p.vendor ?? ""} ${p.category ?? ""}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [products, q, filter]);

  const shown = matches.slice(0, LIMIT);
  const active = products.filter((p) => p.active);
  const stockValue = active.reduce((s, p) => s + Math.max(0, p.stock_qty) * (p.cost ?? 0), 0);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <MiniStat label="Active items" value={String(active.length)} />
        <MiniStat
          label="Out of stock"
          value={String(active.filter((p) => p.stock_qty <= 0).length)}
          tone={active.some((p) => p.stock_qty <= 0) ? "bad" : "plain"}
        />
        <MiniStat
          label="Stock at cost"
          value={money(stockValue)}
          hint={`${active.filter((p) => !p.cost).length} items have no cost recorded`}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
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
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search items"
            autoComplete="off"
            aria-label="Search inventory"
            className="field pl-10"
          />
        </div>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="field w-auto"
          aria-label="Filter"
        >
          <option value="all">All active</option>
          <option value="out">Out of stock</option>
          <option value="low">Running low (1–3)</option>
          <option value="nocost">Missing a cost</option>
          <option value="inactive">Inactive</option>
        </select>

        <button type="button" className="btn btn-primary" onClick={() => setRestocking(true)}>
          Restock
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setCreating(true)}>
          New item
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setImporting(true)}>
          Import
        </button>
        <button
          type="button"
          className={bulk ? "btn btn-ghost border-spruce text-spruce" : "btn btn-ghost"}
          aria-pressed={bulk}
          onClick={() => {
            if (bulk && dirtyCount > 0) return;
            setBulk((b) => !b);
          }}
          disabled={bulk && dirtyCount > 0}
          title={
            bulk && dirtyCount > 0
              ? "Save or discard your changes first"
              : "Edit prices, costs and counts straight in the table"
          }
        >
          {bulk ? "Editing" : "Bulk edit"}
        </button>
      </div>

      {matches.length > LIMIT && (
        <div className="mb-3">
          <Note tone="info">
            Showing the first {LIMIT} of {matches.length.toLocaleString()} matches. Keep typing to
            narrow it down.
          </Note>
        </div>
      )}

      {shown.length === 0 ? (
        <Empty
          title="No items match"
          hint="Try a shorter search, or switch the filter back to all active items."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto px-2 py-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="num">On hand</th>
                  <th className="num">Price</th>
                  <th className="num">Wholesale</th>
                  <th className="num">Cost</th>
                  <th className="num">Margin</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => {
                  const margin =
                    p.cost && p.cost > 0 && p.price > 0 ? 1 - p.cost / p.price : null;
                  const dirty = Boolean(edits[p.sku]);
                  return (
                    <tr key={p.sku} className={dirty ? "bg-amber-light/50" : ""}>
                      <td className="max-w-[320px]">
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="block w-full text-left"
                        >
                          <span className="block truncate text-[14.5px] font-medium">{p.name}</span>
                          <span className="block text-[12px] text-ink-faint">
                            {p.sku}
                            {p.vendor ? ` · ${p.vendor}` : ""}
                            {!p.active ? " · inactive" : ""}
                          </span>
                        </button>
                      </td>
                      <td className="num">
                        {bulk ? (
                          <CellInput
                            value={valueFor(p, "stock")}
                            step="1"
                            label={`On hand for ${p.name}`}
                            onChange={(v) => editCell(p.sku, "stock", v)}
                          />
                        ) : (
                          <span
                            className={
                              p.stock_qty <= 0
                                ? "font-semibold text-clay"
                                : p.stock_qty <= 3
                                  ? "font-medium text-amber"
                                  : ""
                            }
                          >
                            {p.stock_qty}
                          </span>
                        )}
                      </td>
                      <td className="num">
                        {bulk ? (
                          <CellInput
                            value={valueFor(p, "price")}
                            label={`Price for ${p.name}`}
                            onChange={(v) => editCell(p.sku, "price", v)}
                          />
                        ) : (
                          money(p.price)
                        )}
                      </td>
                      <td className="num text-ink-faint">
                        {bulk ? (
                          <CellInput
                            value={valueFor(p, "wholesalePrice")}
                            label={`Wholesale price for ${p.name}`}
                            onChange={(v) => editCell(p.sku, "wholesalePrice", v)}
                          />
                        ) : p.wholesale_price ? (
                          money(p.wholesale_price)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num text-ink-faint">
                        {bulk ? (
                          <CellInput
                            value={valueFor(p, "cost")}
                            label={`Cost for ${p.name}`}
                            onChange={(v) => editCell(p.sku, "cost", v)}
                          />
                        ) : p.cost ? (
                          money(p.cost)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num text-ink-faint">
                        {margin === null ? "—" : `${Math.round(margin * 100)}%`}
                      </td>
                      <td className="num">
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="btn btn-quiet btn-sm"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {bulk && (
        <div className="slide-up fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 p-4 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] text-ink-soft">
              {dirtyCount === 0
                ? "Change any price, cost or count in the table. Nothing saves until you say so."
                : `${dirtyCount} item${dirtyCount === 1 ? "" : "s"} changed.`}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={saving}
                onClick={() => {
                  setEdits({});
                  setBulk(false);
                }}
              >
                {dirtyCount === 0 ? "Done" : "Discard changes"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || dirtyCount === 0}
                onClick={saveBulk}
              >
                {saving && <Spinner />}
                {saving ? "Saving…" : `Save ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {restocking && (
        <RestockDialog products={products} onClose={() => setRestocking(false)} />
      )}
      {creating && <NewItemDialog onClose={() => setCreating(false)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {editing && <EditDialog product={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** One editable number in the table. Deliberately borderless until touched. */
function CellInput({
  value,
  onChange,
  label,
  step = "0.01",
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  step?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      min="0"
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className="tabular h-8 w-[86px] rounded-lg border border-line bg-surface px-2 text-right text-[13.5px] focus:border-spruce focus:outline-none"
    />
  );
}

function MiniStat({
  label,
  value,
  hint,
  tone = "plain",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "bad";
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
        {label}
      </div>
      <div
        className={`tabular font-display mt-1 text-[21px] font-semibold leading-none ${
          tone === "bad" ? "text-clay" : ""
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[12px] text-ink-faint">{hint}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- restock --- */

function RestockDialog({
  products,
  onClose,
}: {
  products: ProductFull[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<ProductFull | null>(null);
  const [result, action] = useActionState(restockAction, null);
  const [qty, setQty] = useState("12");

  // The item stays selected after a successful restock so the confirmation sits
  // next to what it refers to. The picker is still right above it, so moving on
  // to the next box in the delivery is one action either way.
  const projected = picked ? picked.stock_qty + (parseInt(qty) || 0) : 0;

  return (
    <Modal onClose={onClose} labelledBy="restock-title">
      <div className="pop max-h-[88dvh] w-full max-w-[480px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]">
        <h2 id="restock-title" className="font-display text-[20px] font-semibold">
          Restock an item
        </h2>
        <p className="mt-1 text-[13.5px] text-ink-faint">
          Search for what arrived — you can only restock something already in the catalogue.
        </p>

        <div className="mt-4">
          <ProductPicker
            items={products}
            autoFocus
            onPick={(p) => setPicked(products.find((x) => x.sku === p.sku) ?? null)}
            placeholder="Search for the item that arrived"
          />
        </div>

        {picked && (
          <form action={action} className="rise mt-5 border-t border-line-soft pt-5">
            <input type="hidden" name="sku" value={picked.sku} />

            <div className="mb-4 flex items-start justify-between gap-3 rounded-xl bg-paper px-3.5 py-3">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-medium">{picked.name}</div>
                <div className="text-[12.5px] text-ink-faint">
                  {picked.sku} · {picked.stock_qty} on hand
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="btn btn-quiet btn-sm shrink-0"
              >
                Change
              </button>
            </div>

            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field
                label="How many arrived"
                hint={`Takes it to ${projected} on hand.`}
              >
                <input
                  name="qty"
                  type="number"
                  step="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  autoFocus
                  className="field"
                />
              </Field>
              <Field label="Cost each" hint="Blank keeps the cost you already have.">
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint">
                    $
                  </span>
                  <input
                    name="cost"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={picked.cost ?? ""}
                    placeholder="0.00"
                    className="field pl-7"
                  />
                </div>
              </Field>
            </div>

            <div className="mt-4 rounded-xl border border-line-soft bg-paper/60 p-3.5">
              <label className="flex items-start gap-2.5 text-[14px]">
                <input type="checkbox" name="log_expense" defaultChecked className="check mt-0.5" />
                <span>
                  Also record what this cost as an inventory purchase
                  <span className="mt-0.5 block text-[12.5px] text-ink-faint">
                    Keeps the profit-and-loss report honest.
                  </span>
                </span>
              </label>
              <input
                type="date"
                name="expense_date"
                defaultValue={isoDate(new Date())}
                className="field mt-3"
                aria-label="Purchase date"
              />
            </div>

            <Result result={result} />

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Done
              </button>
              <Submit pendingLabel="Adding…">Add to stock</Submit>
            </div>
          </form>
        )}

        {!picked && (
          <>
            <Result result={result} />
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ new item --- */

function NewItemDialog({ onClose }: { onClose: () => void }) {
  const [result, action] = useActionState(createProductAction, null);

  return (
    <Modal onClose={onClose} labelledBy="newitem-title">
      <form
        action={action}
        className="pop max-h-[88dvh] w-full max-w-[520px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]"
      >
        <h2 id="newitem-title" className="font-display text-[20px] font-semibold">
          Add a new item
        </h2>
        <p className="mt-1 text-[13.5px] text-ink-faint">
          Give it an item number nothing else uses — that number is how every sale and restock
          finds it again.
        </p>

        <div className="mt-5 grid gap-3.5 sm:grid-cols-2">
          <Field label="Item number">
            <input name="sku" required autoFocus className="field" autoComplete="off" />
          </Field>
          <Field label="Name" className="sm:col-span-2">
            <input name="name" required className="field" autoComplete="off" />
          </Field>
          <Field label="Retail price">
            <MoneyInput name="price" />
          </Field>
          <Field label="Wholesale price" hint="Optional.">
            <MoneyInput name="wholesale_price" />
          </Field>
          <Field label="Opening stock">
            <input name="stock" type="number" step="1" defaultValue="0" className="field" />
          </Field>
          <Field label="Cost each" hint="Needed for profit reporting.">
            <MoneyInput name="cost" />
          </Field>
          <Field label="Vendor" hint="Optional.">
            <input name="vendor" className="field" autoComplete="off" />
          </Field>
          <Field label="Category" hint="Optional.">
            <input name="category" className="field" autoComplete="off" />
          </Field>
        </div>

        <div className="mt-4 rounded-xl border border-line-soft bg-paper/60 p-3.5">
          <label className="flex items-start gap-2.5 text-[14px]">
            <input type="checkbox" name="log_expense" defaultChecked className="check mt-0.5" />
            <span>Record the opening stock as an inventory purchase</span>
          </label>
          <input
            type="date"
            name="expense_date"
            defaultValue={isoDate(new Date())}
            className="field mt-3"
            aria-label="Purchase date"
          />
        </div>

        <Result result={result} />

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {result?.ok ? "Done" : "Cancel"}
          </button>
          <Submit pendingLabel="Creating…">Create item</Submit>
        </div>
      </form>
    </Modal>
  );
}

function MoneyInput({ name, defaultValue }: { name: string; defaultValue?: number | null }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint">
        $
      </span>
      <input
        name={name}
        type="number"
        step="0.01"
        min="0"
        defaultValue={defaultValue ?? ""}
        placeholder="0.00"
        className="field pl-7"
      />
    </div>
  );
}

/* --------------------------------------------------------------- edit --- */

function EditDialog({ product, onClose }: { product: ProductFull; onClose: () => void }) {
  const [tab, setTab] = useState<"details" | "count" | "history">("details");
  const [saveResult, save] = useActionState(saveProductAction, null);
  const [countResult, count] = useActionState(countStockAction, null);
  const [history, setHistory] = useState<
    { id: number; delta: number; reason: string; invoice_id: number | null; note: string | null; created_at: string }[] | null
  >(null);
  const [loading, start] = useTransition();

  useEffect(() => {
    if (tab === "history" && history === null) {
      start(async () => setHistory(await historyAction(product.sku)));
    }
  }, [tab, history, product.sku]);

  return (
    <Modal onClose={onClose} labelledBy="edit-title">
      <div className="pop max-h-[88dvh] w-full max-w-[560px] overflow-y-auto rounded-2xl border border-line bg-surface shadow-[var(--shadow-float)]">
        <div className="border-b border-line-soft px-6 pb-4 pt-6">
          <h2 id="edit-title" className="font-display text-[20px] font-semibold leading-tight">
            {product.name}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-faint">
            {product.sku} · {product.stock_qty} on hand
          </p>
          <div className="mt-4 flex gap-1 rounded-xl border border-line bg-paper p-1">
            {(["details", "count", "history"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`tap flex-1 rounded-lg px-3 py-1.5 text-[13.5px] font-medium capitalize ${
                  tab === t ? "bg-surface text-ink shadow-[var(--shadow-lift)]" : "text-ink-faint"
                }`}
              >
                {t === "count" ? "Stock count" : t}
              </button>
            ))}
          </div>
        </div>

        {tab === "details" && (
          <form action={save} className="px-6 py-5">
            <input type="hidden" name="sku" value={product.sku} />
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2">
                <input name="name" defaultValue={product.name} required className="field" />
              </Field>
              <Field label="Retail price">
                <MoneyInput name="price" defaultValue={product.price} />
              </Field>
              <Field label="Wholesale price">
                <MoneyInput name="wholesale_price" defaultValue={product.wholesale_price} />
              </Field>
              <Field label="Cost each">
                <MoneyInput name="cost" defaultValue={product.cost} />
              </Field>
              <Field label="Vendor">
                <input name="vendor" defaultValue={product.vendor ?? ""} className="field" />
              </Field>
              <Field label="Category" className="sm:col-span-2">
                <input name="category" defaultValue={product.category ?? ""} className="field" />
              </Field>
            </div>

            <label className="mt-4 flex items-start gap-2.5 text-[14px]">
              <input
                type="checkbox"
                name="active"
                defaultChecked={product.active}
                className="check mt-0.5"
              />
              <span>
                Sell this item
                <span className="mt-0.5 block text-[12.5px] text-ink-faint">
                  Turning it off hides it from the kiosk and the till, but keeps its history.
                </span>
              </span>
            </label>

            <Result result={saveResult} />

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
              <Submit pendingLabel="Saving…">Save</Submit>
            </div>
          </form>
        )}

        {tab === "count" && (
          <form action={count} className="px-6 py-5">
            <input type="hidden" name="sku" value={product.sku} />
            <p className="text-[14px] leading-relaxed text-ink-soft">
              Counted the shelf? Enter what&apos;s actually there. The difference is recorded as an
              adjustment, so the history below still explains the number.
            </p>
            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              <Field label="Counted on hand">
                <input
                  name="counted"
                  type="number"
                  step="1"
                  defaultValue={product.stock_qty}
                  autoFocus
                  className="field"
                />
              </Field>
              <Field label="Note" hint="Optional.">
                <input name="note" placeholder="e.g. annual count" className="field" />
              </Field>
            </div>
            <Result result={countResult} />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
              <Submit pendingLabel="Saving…">Set on-hand</Submit>
            </div>
          </form>
        )}

        {tab === "history" && (
          <div className="px-6 py-5">
            {loading || history === null ? (
              <p className="flex items-center gap-2 py-8 text-center text-[14px] text-ink-faint">
                <Spinner /> Loading movements…
              </p>
            ) : history.length === 0 ? (
              <p className="py-8 text-center text-[14px] text-ink-faint">
                No movements recorded for this item yet.
              </p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-[14px] capitalize">
                        {h.reason}
                        {h.invoice_id ? ` · invoice #${h.invoice_id}` : ""}
                      </span>
                      <span className="block text-[12px] text-ink-faint">
                        {dateTime(h.created_at)}
                        {h.note ? ` · ${h.note}` : ""}
                      </span>
                    </span>
                    <span
                      className={`tabular shrink-0 text-[15px] font-semibold ${
                        h.delta > 0 ? "text-spruce" : "text-clay"
                      }`}
                    >
                      {h.delta > 0 ? "+" : ""}
                      {h.delta}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-5 flex justify-end">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- import --- */

const TEMPLATE = `SKU,Name,Price,WholesalePrice,StockQty,Cost
EXAMPLE-1,Example item,5.00,2.50,100,1.25`;

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <Modal onClose={onClose} labelledBy="import-title">
      <div className="pop max-h-[88dvh] w-full max-w-[600px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]">
        <h2 id="import-title" className="font-display text-[20px] font-semibold">
          Import items from a spreadsheet
        </h2>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-faint">
          Save your sheet as CSV and drop it here. A row whose item number already exists updates
          that item — it never creates a second one under the same number.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label className="btn btn-ghost cursor-pointer">
            Choose a file
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                setCsv(text);
                setPreview(null);
              }}
            />
          </label>
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="inventory_template.csv"
            className="btn btn-quiet btn-sm"
          >
            Download a template
          </a>
        </div>

        <textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
          placeholder="…or paste the rows here"
          rows={6}
          spellCheck={false}
          className="field mt-3 font-mono text-[12.5px]"
        />

        {preview && (
          <div className="rise mt-4">
            {preview.ok ? (
              <Note tone="info">
                <strong>
                  {preview.newCount} new item{preview.newCount === 1 ? "" : "s"} and{" "}
                  {preview.updateCount} update{preview.updateCount === 1 ? "" : "s"}.
                </strong>{" "}
                Nothing has been saved yet.
              </Note>
            ) : (
              <Note tone="bad">{preview.message}</Note>
            )}
            {preview.problems.length > 0 && (
              <ul className="mt-2 max-h-32 overflow-y-auto text-[12.5px] leading-relaxed text-ink-faint">
                {preview.problems.slice(0, 12).map((p, i) => (
                  <li key={i}>· {p}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          {!preview?.ok ? (
            <button
              type="button"
              disabled={!csv.trim() || pending}
              className="btn btn-primary"
              onClick={() =>
                start(async () => setPreview(await previewImportAction(csv)))
              }
            >
              {pending && <Spinner />}
              Check the file
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              className="btn btn-primary"
              onClick={() =>
                start(async () => {
                  const res = await commitImportAction(preview.rows);
                  toast(res!.message, res!.ok ? "good" : "bad");
                  if (res!.ok) onClose();
                })
              }
            >
              {pending && <Spinner />}
              Import {preview.rows.length} row{preview.rows.length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

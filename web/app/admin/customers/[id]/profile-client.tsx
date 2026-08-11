"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Customer, Invoice, CustomerLite } from "@/lib/db";
import { money, shortDate, pct } from "@/lib/format";
import { Card, CardHead, Field, Note, StatusPill, Empty } from "@/components/ui";
import { Submit, Result, Spinner } from "@/components/form";
import InvoiceActions from "@/components/invoice-actions";
import Modal from "@/components/modal";
import { useToast } from "@/components/toast";
import { saveCustomerAction, addCreditAction, deleteCustomerAction } from "../actions";
import { useTransition } from "react";

export default function ProfileClient({
  customer,
  invoices,
  namesakes,
  everyone,
  shopRate,
  mailReady,
}: {
  customer: Customer;
  invoices: Invoice[];
  namesakes: { id: string; name: string }[];
  everyone: CustomerLite[];
  shopRate: number;
  mailReady: boolean;
}) {
  const [saveResult, save] = useActionState(saveCustomerAction, null);
  const [creditOpen, setCreditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const paid = invoices.filter((i) => i.status === "paid");
  const owed = invoices.filter((i) => i.status === "pending");
  const lifetime = paid.reduce((s, i) => s + i.total, 0);

  return (
    <>
      <div className="mb-6">
        <Link
          href="/admin/customers"
          className="tap -ml-1 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13.5px] font-medium text-ink-faint hover:text-ink"
        >
          <span aria-hidden>←</span> All customers
        </Link>

        <div className="mt-2.5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[30px] font-semibold leading-none tracking-tight">
              {customer.name}
            </h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {customer.is_wholesale && <span className="pill pill-quiet">Wholesale</span>}
              {customer.credit > 0 && (
                <span className="pill pill-paid">{money(customer.credit)} credit</span>
              )}
              {owed.length > 0 && (
                <span className="pill pill-due">
                  {money(owed.reduce((s, i) => s + i.total, 0))} owing
                </span>
              )}
              {customer.tax_rate != null && (
                <span className="pill pill-quiet">Tax {pct(customer.tax_rate)}</span>
              )}
              <span className="text-[12.5px] text-ink-faint">
                {customer.joined_on ? `Customer since ${shortDate(customer.joined_on)}` : customer.id}
              </span>
            </div>
          </div>

          <Link href={`/admin/pos?customer=${customer.id}`} className="btn btn-primary">
            Start a sale
          </Link>
        </div>
      </div>

      {namesakes.length > 0 && (
        <div className="mb-5">
          <Note tone="warn">
            Another customer is also called <strong>{customer.name}</strong> (
            {namesakes.map((n, i) => (
              <span key={n.id}>
                {i > 0 && ", "}
                <Link href={`/admin/customers/${n.id}`} className="font-medium underline">
                  {n.id}
                </Link>
              </span>
            ))}
            ). This page is the one with id <strong>{customer.id}</strong>, and its history below
            belongs to this person only.
          </Note>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ------------------------------------------------------- history -- */}
        <div className="order-2 flex flex-col gap-5 lg:order-1">
          <Card>
            <CardHead
              title="Purchase history"
              hint={
                invoices.length === 0
                  ? undefined
                  : `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} · ${money(
                      lifetime,
                    )} paid to date`
              }
            />
            {invoices.length === 0 ? (
              <div className="p-5">
                <Empty
                  title="No purchases yet"
                  hint="Sales made at the counter or the kiosk will appear here."
                />
              </div>
            ) : (
              <div className="overflow-x-auto px-2 py-3">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Invoice</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                      <th className="num">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((i) => (
                      <tr key={i.id}>
                        <td className="whitespace-nowrap text-ink-soft">{shortDate(i.sold_at)}</td>
                        <td>
                          <Link href={`/admin/invoices/${i.id}`} className="font-medium hover:text-spruce">
                            #{i.id}
                          </Link>
                          {i.payment && (
                            <span className="ml-2 text-[12px] capitalize text-ink-faint">
                              {i.payment}
                            </span>
                          )}
                        </td>
                        <td>
                          <StatusPill status={i.status} dueDate={i.due_date} />
                        </td>
                        <td className="num font-medium">{money(i.total)}</td>
                        <td>
                          <InvoiceActions
                            id={i.id}
                            status={i.status}
                            total={i.total}
                            defaultEmail={customer.email}
                            mailReady={mailReady}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* --------------------------------------------------------- edit -- */}
        <div className="order-1 flex flex-col gap-5 lg:order-2">
          <Card>
            <CardHead title="Store credit" />
            <div className="px-5 py-5">
              <div className="font-display tabular text-[30px] font-semibold leading-none text-spruce">
                {money(customer.credit)}
              </div>
              <p className="mt-2 text-[13px] leading-snug text-ink-faint">
                Applied at checkout when this customer is selected.
              </p>
              <button
                type="button"
                onClick={() => setCreditOpen(true)}
                className="btn btn-ghost mt-4 w-full"
              >
                Add credit or sell a gift certificate
              </button>
            </div>
          </Card>

          <Card>
            <CardHead title="Details" />
            <form action={save} className="flex flex-col gap-3.5 px-5 py-5">
              <input type="hidden" name="id" value={customer.id} />
              <Field label="Name">
                <input name="name" defaultValue={customer.name} required className="field" />
              </Field>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Phone">
                  <input
                    name="phone"
                    type="tel"
                    defaultValue={customer.phone ?? ""}
                    className="field"
                  />
                </Field>
                <Field label="Email">
                  <input
                    name="email"
                    type="email"
                    defaultValue={customer.email ?? ""}
                    className="field"
                  />
                </Field>
              </div>
              <Field label="Address">
                <textarea name="address" defaultValue={customer.address ?? ""} className="field" rows={2} />
              </Field>
              <Field label="Notes">
                <textarea name="notes" defaultValue={customer.notes ?? ""} className="field" rows={2} />
              </Field>

              <div className="mt-1 border-t border-line-soft pt-4">
                <label className="flex items-center gap-2.5 text-[14px]">
                  <input
                    type="checkbox"
                    name="is_wholesale"
                    defaultChecked={customer.is_wholesale}
                    className="check"
                  />
                  Wholesale account
                </label>
                <p className="mt-1.5 pl-[30px] text-[12.5px] leading-snug text-ink-faint">
                  Uses wholesale prices and charges no sales tax.
                </p>
              </div>

              <Field
                label="Tax rate"
                hint={`Leave at 0 to use the shop rate of ${pct(shopRate)}.`}
              >
                <div className="relative">
                  <input
                    name="tax_rate"
                    type="number"
                    step="0.001"
                    min="0"
                    max="100"
                    defaultValue={customer.tax_rate != null ? (customer.tax_rate * 100).toFixed(3) : "0"}
                    className="field pr-8"
                  />
                  <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[14px] text-ink-faint">
                    %
                  </span>
                </div>
              </Field>

              <Result result={saveResult} />

              <div className="mt-1 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  className="btn btn-quiet btn-sm text-ink-faint hover:text-clay"
                >
                  Delete profile
                </button>
                <Submit pendingLabel="Saving…">Save changes</Submit>
              </div>
            </form>
          </Card>
        </div>
      </div>

      {creditOpen && (
        <CreditDialog
          customer={customer}
          everyone={everyone}
          onClose={() => setCreditOpen(false)}
        />
      )}
      {deleteOpen && (
        <DeleteDialog
          customer={customer}
          invoiceCount={invoices.length}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Two different things wear the name "add credit", so the dialog makes you say
 * which: money changed hands (a gift certificate, which is a sale and belongs
 * on the books), or it did not (a correction, which does not).
 */
function CreditDialog({
  customer,
  everyone,
  onClose,
}: {
  customer: Customer;
  everyone: CustomerLite[];
  onClose: () => void;
}) {
  const [result, action] = useActionState(addCreditAction, null);
  const [mode, setMode] = useState<"sold" | "adjust">("sold");
  const [buyer, setBuyer] = useState(customer.id);

  return (
    <Modal onClose={onClose} labelledBy="credit-title">
      <form
        action={action}
        className="pop max-h-[85dvh] w-full max-w-[440px] overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]"
      >
        <h2 id="credit-title" className="font-display text-[20px] font-semibold">
          Credit for {customer.name}
        </h2>

        <input type="hidden" name="recipient_id" value={customer.id} />
        <input type="hidden" name="mode" value={mode} />

        <div className="mt-4 flex gap-1 rounded-xl border border-line bg-paper p-1">
          {(["sold", "adjust"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`tap flex-1 rounded-lg px-3 py-2 text-[13.5px] font-medium ${
                mode === m ? "bg-surface text-ink shadow-[var(--shadow-lift)]" : "text-ink-faint"
              }`}
            >
              {m === "sold" ? "They paid for it" : "Correction"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] leading-snug text-ink-faint">
          {mode === "sold"
            ? "Records a sale for the money taken and adds the same amount as credit."
            : "Adjusts the balance only — no sale, no money taken."}
        </p>

        <div className="mt-4 flex flex-col gap-3.5">
          <Field label="Amount">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint">
                $
              </span>
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                defaultValue="50.00"
                required
                autoFocus
                className="field pl-7"
              />
            </div>
          </Field>

          {mode === "sold" && (
            <>
              <Field label="Who is paying" hint="A gift certificate is usually bought by someone else.">
                <select
                  name="buyer_id"
                  value={buyer}
                  onChange={(e) => setBuyer(e.target.value)}
                  className="field"
                >
                  <option value={customer.id}>{customer.name} (themselves)</option>
                  {everyone
                    .filter((c) => c.id !== customer.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Payment">
                <select name="payment" className="field" defaultValue="check">
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="venmo">Venmo</option>
                </select>
              </Field>
            </>
          )}
        </div>

        <Result result={result} />

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {result?.ok ? "Close" : "Cancel"}
          </button>
          <Submit pendingLabel="Recording…">
            {mode === "sold" ? "Record sale & add credit" : "Adjust balance"}
          </Submit>
        </div>
      </form>
    </Modal>
  );
}

function DeleteDialog({
  customer,
  invoiceCount,
  onClose,
}: {
  customer: Customer;
  invoiceCount: number;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [typed, setTyped] = useState("");
  const toast = useToast();
  const router = useRouter();

  const blocked = invoiceCount > 0;

  return (
    <Modal onClose={onClose} labelledBy="delc-title">
      <div className="pop w-full max-w-[440px] rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]">
        <h2 id="delc-title" className="font-display text-[19px] font-semibold">
          Delete {customer.name}?
        </h2>

        {blocked ? (
          <>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
              This customer has {invoiceCount} invoice{invoiceCount === 1 ? "" : "s"} on file, so
              they can&apos;t be deleted — their purchase history would go with them and the
              revenue would disappear from your reports.
            </p>
            <p className="mt-3 text-[14.5px] leading-relaxed text-ink-soft">
              If they&apos;re a duplicate, delete or reassign their invoices first.
            </p>
            <div className="mt-6 flex justify-end">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">
              They have no purchase history, so nothing else is affected. Type their name to
              confirm.
            </p>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={customer.name}
              autoFocus
              className="field mt-4"
              aria-label="Type the customer's name to confirm"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                disabled={pending || typed.trim() !== customer.name.trim()}
                className="btn btn-danger"
                onClick={() =>
                  start(async () => {
                    const res = await deleteCustomerAction(customer.id);
                    toast(res!.message, res!.ok ? "good" : "bad");
                    if (res!.ok) router.push("/admin/customers");
                  })
                }
              >
                {pending && <Spinner />}
                Delete permanently
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

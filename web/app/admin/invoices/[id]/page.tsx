import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getInvoice,
  getInvoiceLines,
  getSettings,
  getCustomer,
  getCustomers,
} from "@/lib/queries";
import { mailConfigured } from "@/lib/mail";
import { money, unitPrice, shortDate, dateTime, invoiceMaths } from "@/lib/format";
import { Card, StatusPill, Note } from "@/components/ui";
import InvoiceActions from "@/components/invoice-actions";
import FreightBox from "./freight-box";
import AssignCustomer from "./assign-customer";

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id)) notFound();

  const [invoice, lines, settings] = await Promise.all([
    getInvoice(id),
    getInvoiceLines(id),
    getSettings(),
  ]);
  if (!invoice) notFound();

  const [customer, customers] = await Promise.all([
    invoice.customer_id ? getCustomer(invoice.customer_id) : Promise.resolve(null),
    getCustomers(),
  ]);
  const company = settings.CompanyName || "Notion to Sew";

  // Shipping lives in the line items, so the stored subtotal contains it; and
  // older records disagree about whether tax belongs in the total. invoiceMaths
  // reads this particular invoice and returns rows that add up to what it was
  // settled for.
  const { goods, shipping, taxIncluded, adjustment } = invoiceMaths(invoice, lines);

  return (
    <>
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href={customer ? `/admin/customers/${customer.id}` : "/admin"}
          className="tap -ml-1 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-[13.5px] font-medium text-ink-faint hover:text-ink"
        >
          <span aria-hidden>←</span> {customer ? customer.name : "Dashboard"}
        </Link>
        <InvoiceActions
          id={invoice.id}
          status={invoice.status}
          total={invoice.total}
          defaultEmail={customer?.email}
          mailReady={await mailConfigured()}
        />
      </div>

      <Card className="overflow-hidden">
        {/* A screen version of the document, so what you see matches what
            prints. The PDF button opens the real thing. */}
        <div className="border-b border-line-soft px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <div className="font-display text-[22px] font-semibold tracking-tight">{company}</div>
              {settings.Address?.split("\n").map((l) => (
                <div key={l} className="text-[13px] leading-snug text-ink-faint">
                  {l}
                </div>
              ))}
            </div>
            <div className="text-right">
              <div className="font-display text-[22px] font-semibold">
                {invoice.status === "paid" ? "Receipt" : "Invoice"}
              </div>
              <div className="tabular text-[14px] text-ink-faint">No. {invoice.id}</div>
              <div className="mt-2 flex justify-end">
                <StatusPill status={invoice.status} dueDate={invoice.due_date} />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 border-b border-line-soft px-6 py-5 sm:grid-cols-2 sm:px-8">
          <div>
            <div className="label">Bill to</div>
            <div className="text-[15px] font-medium">
              {customer ? (
                <Link href={`/admin/customers/${customer.id}`} className="hover:text-spruce">
                  {customer.name}
                </Link>
              ) : (
                <span className="text-ink-faint">No name on this sale</span>
              )}
            </div>
            <div className="no-print mt-2">
              <AssignCustomer
                invoiceId={invoice.id}
                customers={customers}
                current={customer ? { id: customer.id, name: customer.name } : null}
              />
            </div>
            {customer?.address?.split("\n").map((l) => (
              <div key={l} className="text-[13.5px] text-ink-soft">
                {l}
              </div>
            ))}
            {customer?.email && (
              <div className="text-[13.5px] text-ink-soft">{customer.email}</div>
            )}
          </div>
          <div className="sm:text-right">
            <Meta label="Sold" value={dateTime(invoice.sold_at)} />
            {invoice.status === "paid" && invoice.paid_at ? (
              <Meta label="Paid" value={shortDate(invoice.paid_at)} />
            ) : (
              <Meta label="Due" value={invoice.due_date ? shortDate(invoice.due_date) : "Upon receipt"} />
            )}
            {invoice.payment && <Meta label="Payment" value={cap(invoice.payment)} />}
            {invoice.is_wholesale && <Meta label="Pricing" value="Wholesale" />}
          </div>
        </div>

        <div className="overflow-x-auto px-4 py-4 sm:px-6">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th>Description</th>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-ink-faint">
                    This invoice has no line items recorded — common for the oldest imported
                    records.
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-ink-faint">{l.sku ?? "—"}</td>
                    <td className="font-medium">{l.description}</td>
                    <td className="num">{trim(l.qty)}</td>
                    <td className="num">{unitPrice(l.unit_price)}</td>
                    <td className="num font-medium">{money(l.line_total)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end border-t border-line-soft px-6 py-5 sm:px-8">
          <dl className="w-full max-w-[280px] text-[14px]">
            <Row label="Subtotal" value={money(goods)} />
            {invoice.discount > 0 && <Row label="Discount" value={`−${money(invoice.discount)}`} />}
            {shipping > 0 && <Row label="Shipping" value={money(shipping)} />}
            {taxIncluded && invoice.tax > 0 && <Row label="Sales tax" value={money(invoice.tax)} />}
            {invoice.credit_applied > 0 && (
              <Row label="Store credit" value={`−${money(invoice.credit_applied)}`} />
            )}
            {Math.abs(adjustment) >= 0.01 && (
              <Row
                label="Adjustment"
                value={`${adjustment < 0 ? "−" : ""}${money(Math.abs(adjustment))}`}
              />
            )}
            <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2.5">
              <dt className="font-display text-[15px] font-semibold">
                {invoice.status === "paid" ? "Paid" : "Amount due"}
              </dt>
              <dd className="tabular font-display text-[20px] font-semibold">
                {money(invoice.total)}
              </dd>
            </div>
          </dl>
        </div>
      </Card>

      {invoice.status !== "paid" && (
        <div className="no-print mt-5">
          <FreightBox id={invoice.id} />
        </div>
      )}

      {(lines.length === 0 || !taxIncluded || Math.abs(adjustment) >= 0.01) && (
        <div className="no-print mt-5 flex flex-col gap-2">
          {lines.length === 0 && (
            <Note tone="info">
              Reports count this invoice&apos;s revenue in full, but it contributes nothing to cost
              of goods sold, because no items were recorded against it.
            </Note>
          )}
          {!taxIncluded && invoice.tax > 0 && (
            <Note tone="warn">
              This record keeps its {money(invoice.tax)} of sales tax <em>outside</em> the total —
              the convention the previous bookkeeping software used. The total above is what the
              invoice says it was settled for.
            </Note>
          )}
          {Math.abs(adjustment) >= 0.01 && (
            <Note tone="warn">
              The line items don&apos;t account for {money(Math.abs(adjustment))} of this total.
              On invoices from the old checkout that is almost always a bulk discount, which it
              applied to the money without recording it.
            </Note>
          )}
        </div>
      )}
    </>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-1.5 last:mb-0">
      <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
        {label}
      </span>
      <span className="text-[13.5px]">{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

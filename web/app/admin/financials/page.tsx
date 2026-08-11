import Link from "next/link";
import {
  getIncomeStatement,
  getExpenseBreakdown,
  getExpenses,
  getTaxSummary,
  getProductPerformance,
  getOpenInvoices,
  getSettings,
  expenseCategories,
} from "@/lib/queries";
import { readRange } from "@/lib/range";
import { money, shortDate } from "@/lib/format";
import { mailConfigured } from "@/lib/mail";
import { Card, CardHead, PageHead, Stat, Empty, Note } from "@/components/ui";
import DateRange from "@/components/date-range";
import InvoiceActions from "@/components/invoice-actions";
import ActionButton from "@/components/action-button";
import ExpenseForm from "./expense-form";
import { deleteExpenseAction } from "./actions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "profit", label: "Profit & loss" },
  { key: "tax", label: "Sales tax" },
  { key: "products", label: "Top sellers" },
  { key: "receivable", label: "Unpaid" },
  { key: "expenses", label: "Expenses" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function FinancialsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "profit";
  const { from, to } = readRange(params, "year");

  const qs = `from=${from}&to=${to}`;

  return (
    <>
      <PageHead
        title="Money"
        hint="Where it came from, where it went, and what's still owed."
        action={tab === "receivable" ? undefined : <DateRange from={from} to={to} />}
      />

      <nav className="no-print mb-5 flex flex-wrap gap-1 border-b border-line pb-px">
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <Link
              key={t.key}
              href={`/admin/financials?tab=${t.key}&${qs}`}
              aria-current={on ? "page" : undefined}
              className={`tap relative rounded-t-lg px-3.5 py-2 text-[14px] font-medium ${
                on ? "text-ink" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              {t.label}
              <span
                className={`absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-spruce transition-opacity ${
                  on ? "opacity-100" : "opacity-0"
                }`}
              />
            </Link>
          );
        })}
      </nav>

      {tab === "profit" && <ProfitTab from={from} to={to} />}
      {tab === "tax" && <TaxTab from={from} to={to} />}
      {tab === "products" && <ProductsTab from={from} to={to} />}
      {tab === "receivable" && <ReceivableTab />}
      {tab === "expenses" && <ExpensesTab from={from} to={to} />}
    </>
  );
}

/* ------------------------------------------------------------- profit --- */

async function ProfitTab({ from, to }: { from: string; to: string }) {
  const [income, expenses] = await Promise.all([
    getIncomeStatement(from, to),
    getExpenseBreakdown(from, to),
  ]);

  const totalIncome = income.retail + income.wholesale;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const grossProfit = totalIncome - income.cogs;
  const netProfit = grossProfit - totalExpenses;
  const margin = totalIncome > 0 ? (grossProfit / totalIncome) * 100 : 0;

  return (
    <>
      <div className="stagger mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revenue" value={money(totalIncome)} hint={`${income.orders} invoices`} />
        <Stat label="Cost of goods" value={money(income.cogs)} hint={`${margin.toFixed(0)}% gross margin`} />
        <Stat label="Expenses" value={money(totalExpenses)} />
        <Stat
          label="Net profit"
          value={money(netProfit)}
          tone={netProfit >= 0 ? "good" : "bad"}
        />
      </div>

      {(income.skus_without_cost > 0 ||
        income.invoices_without_lines > 0 ||
        income.tax_outside_total > 0) && (
        <div className="mb-5 flex flex-col gap-2">
          {income.tax_outside_total > 0 && (
            <Note tone="bad">
              <strong>
                {income.tax_outside_total.toLocaleString()} invoice
                {income.tax_outside_total === 1 ? "" : "s"} in this period record{" "}
                {money(income.tax_outside_total_amount)} of sales tax outside their total.
              </strong>{" "}
              They came from the previous bookkeeping software, which stored the total before tax.
              Revenue here is worked out as total minus tax, so on those records the tax is
              subtracted twice and revenue is understated by that amount. Whether the customer
              paid the figure with tax or without is a question only the shop can answer — nothing
              has been changed either way.
            </Note>
          )}
          {income.skus_without_cost > 0 && (
            <Note tone="warn">
              {income.skus_without_cost} item{income.skus_without_cost === 1 ? "" : "s"} sold in
              this period have no unit cost recorded, so profit is flattered.{" "}
              <Link href="/admin/inventory?filter=nocost" className="font-medium underline">
                Fill in the missing costs
              </Link>
              .
            </Note>
          )}
          {income.invoices_without_lines > 0 && (
            <Note tone="info">
              {income.invoices_without_lines} invoice
              {income.invoices_without_lines === 1 ? "" : "s"} have no line items recorded — common
              for the oldest imported records. Their revenue counts; their cost doesn&apos;t.
            </Note>
          )}
        </div>
      )}

      <Card>
        <CardHead
          title="Profit and loss"
          hint={`${shortDate(from)} — ${shortDate(to)}`}
          action={
            <a
              href={`/api/report/income?from=${from}&to=${to}`}
              target="_blank"
              rel="noopener"
              className="btn btn-ghost btn-sm"
            >
              Print or save as PDF
            </a>
          }
        />
        <div className="px-5 py-5 sm:px-7">
          <Section title="Revenue" />
          <Line label="Retail sales" value={income.retail} indent />
          <Line label="Wholesale sales" value={income.wholesale} indent />
          <Line label="Total revenue" value={totalIncome} bold rule />

          <div className="h-5" />
          <Section title="Cost of goods sold" />
          <Line label="Cost of items sold" value={income.cogs} indent />
          <Line label="Gross profit" value={grossProfit} bold rule />

          <div className="h-5" />
          <Section title="Operating expenses" />
          {expenses.length === 0 ? (
            <Line label="Nothing recorded in this period" value={0} indent />
          ) : (
            expenses.map((e) => (
              <Line key={e.category} label={e.category} value={e.amount} indent />
            ))
          )}
          <Line label="Total expenses" value={totalExpenses} bold rule />

          <div className="mt-6 flex items-baseline justify-between border-t border-ink/15 pt-4">
            <span className="font-display text-[17px] font-semibold">Net profit</span>
            <span
              className={`tabular font-display text-[26px] font-semibold leading-none ${
                netProfit < 0 ? "text-clay" : "text-spruce"
              }`}
            >
              {netProfit < 0 ? `(${money(Math.abs(netProfit))})` : money(netProfit)}
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-1 border-t border-line-soft pt-4 text-[12.5px] leading-relaxed text-ink-faint">
            <p>Sales tax collected ({money(income.tax)}) is excluded — it is held for the state.</p>
            {income.freight > 0 && <p>Revenue includes {money(income.freight)} of shipping charged.</p>}
            {income.gift_cards > 0 && (
              <p>
                Revenue includes {money(income.gift_cards)} of gift certificates, counted when sold
                rather than when redeemed.
              </p>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}

function Section({ title }: { title: string }) {
  return (
    <div className="mb-2 mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
      {title}
    </div>
  );
}

function Line({
  label,
  value,
  indent,
  bold,
  rule,
}: {
  label: string;
  value: number;
  indent?: boolean;
  bold?: boolean;
  rule?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between py-1.5 ${
        rule ? "mt-1 border-t border-line pt-2.5" : ""
      }`}
    >
      <span
        className={`text-[14.5px] ${indent ? "pl-4" : ""} ${
          bold ? "font-semibold" : "text-ink-soft"
        }`}
      >
        {label}
      </span>
      <span className={`tabular text-[14.5px] ${bold ? "font-semibold" : ""}`}>
        {value < 0 ? `(${money(Math.abs(value))})` : money(value)}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- tax --- */

async function TaxTab({ from, to }: { from: string; to: string }) {
  const summary = await getTaxSummary(from, to);
  return (
    <>
      <div className="stagger mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Tax collected" value={money(summary.tax_collected)} tone="warn" />
        <Stat label="Taxable sales" value={money(summary.taxable_sales)} />
        <Stat label="Exempt sales" value={money(summary.exempt_sales)} hint="Wholesale and untaxed" />
        <Stat label="Shipping" value={money(summary.freight)} hint="Not taxed" />
      </div>
      <Card>
        <CardHead
          title="What to report"
          hint={`${shortDate(from)} — ${shortDate(to)}`}
        />
        <div className="px-5 py-5 text-[14.5px] leading-relaxed text-ink-soft sm:px-7">
          <p>
            Gross sales for the period were{" "}
            <strong className="text-ink">
              {money(summary.taxable_sales + summary.exempt_sales + summary.freight)}
            </strong>
            , of which <strong className="text-ink">{money(summary.taxable_sales)}</strong> was
            taxable. You collected{" "}
            <strong className="text-ink">{money(summary.tax_collected)}</strong> in sales tax.
          </p>
          <p className="mt-3">
            Taxable sales are worked out from the tax actually charged on each invoice, not from
            whether the customer is wholesale — so a one-off exempt sale or a customer with their
            own rate lands in the right column.
          </p>
          <div className="mt-4">
            <Note tone="info">
              Shipping is excluded from taxable sales, matching how every invoice in the system was
              calculated.
            </Note>
          </div>
        </div>
      </Card>
    </>
  );
}

/* ----------------------------------------------------------- products --- */

async function ProductsTab({ from, to }: { from: string; to: string }) {
  const rows = await getProductPerformance(from, to, 60);
  const top = rows.slice(0, 10);
  const max = Math.max(1, ...top.map((r) => r.revenue));

  if (rows.length === 0) {
    return <Empty title="No sales in this period" hint="Widen the dates to see more." />;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
      <Card>
        <CardHead title="Top ten by revenue" />
        <ul className="flex flex-col gap-3 px-5 py-5">
          {top.map((r) => (
            <li key={r.sku}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[14px] font-medium">{r.name}</span>
                <span className="tabular shrink-0 text-[14px]">{money(r.revenue)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                <div
                  className="h-full rounded-full bg-spruce/70"
                  style={{ width: `${(r.revenue / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHead title="Leaderboard" hint={`${rows.length} items sold in this period`} />
        <div className="overflow-x-auto px-2 py-3">
          <table className="tbl">
            <thead>
              <tr>
                <th>Item</th>
                <th className="num">Sold</th>
                <th className="num">Revenue</th>
                <th className="num">Profit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sku}>
                  <td className="max-w-[260px]">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block text-[12px] text-ink-faint">{r.sku}</span>
                  </td>
                  <td className="num">{trim(r.units)}</td>
                  <td className="num">{money(r.revenue)}</td>
                  <td className="num">
                    {r.cost_missing ? (
                      <span className="text-ink-faint" title="No unit cost recorded">
                        —
                      </span>
                    ) : (
                      money(r.profit)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------- receivables --- */

async function ReceivableTab() {
  const [open, mailReady] = await Promise.all([getOpenInvoices(), mailConfigured()]);
  const total = open.reduce((s, i) => s + i.total, 0);
  const overdue = open.filter((i) => i.overdue);

  if (open.length === 0) {
    return (
      <Empty
        title="Every invoice is paid"
        hint="Nothing is outstanding. This list fills up when you bill someone later."
      />
    );
  }

  return (
    <>
      <div className="stagger mb-5 grid gap-3 sm:grid-cols-3">
        <Stat label="Outstanding" value={money(total)} tone={overdue.length ? "bad" : "plain"} />
        <Stat label="Open invoices" value={String(open.length)} />
        <Stat
          label="Overdue"
          value={money(overdue.reduce((s, i) => s + i.total, 0))}
          tone={overdue.length ? "bad" : "plain"}
          hint={`${overdue.length} invoice${overdue.length === 1 ? "" : "s"}`}
        />
      </div>

      <Card>
        <CardHead title="Waiting to be paid" hint="Oldest first." />
        <div className="overflow-x-auto px-2 py-3">
          <table className="tbl">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Invoice</th>
                <th>Sold</th>
                <th>Due</th>
                <th className="num">Amount</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {open.map((i) => (
                <tr key={i.id}>
                  <td className="max-w-[220px] truncate font-medium">
                    {i.customer_id ? (
                      <Link href={`/admin/customers/${i.customer_id}`} className="hover:text-spruce">
                        {i.customer_name}
                      </Link>
                    ) : (
                      i.customer_name
                    )}
                  </td>
                  <td>
                    <Link href={`/admin/invoices/${i.id}`} className="hover:text-spruce">
                      #{i.id}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap text-ink-soft">{shortDate(i.sold_at)}</td>
                  <td className="whitespace-nowrap">
                    {i.due_date ? (
                      i.overdue ? (
                        <span className="pill pill-late">
                          {i.days_overdue}d late
                        </span>
                      ) : (
                        <span className="text-ink-soft">{shortDate(i.due_date)}</span>
                      )
                    ) : (
                      <span className="text-ink-faint">on receipt</span>
                    )}
                  </td>
                  <td className="num font-medium">{money(i.total)}</td>
                  <td>
                    <InvoiceActions
                      id={i.id}
                      status="pending"
                      total={i.total}
                      mailReady={mailReady}
                      compact
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ----------------------------------------------------------- expenses --- */

async function ExpensesTab({ from, to }: { from: string; to: string }) {
  const [rows, breakdown, settings] = await Promise.all([
    getExpenses(from, to),
    getExpenseBreakdown(from, to),
    getSettings(),
  ]);
  const total = breakdown.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="order-2 lg:order-1">
        <Card>
          <CardHead
            title="Expenses"
            hint={`${shortDate(from)} — ${shortDate(to)} · ${money(total)} across ${rows.length} entr${
              rows.length === 1 ? "y" : "ies"
            }`}
          />
          {rows.length === 0 ? (
            <div className="p-5">
              <Empty
                title="Nothing logged in this period"
                hint="Restocking can log its own cost automatically — the option is on the restock form."
              />
            </div>
          ) : (
            <div className="overflow-x-auto px-2 py-3">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>What for</th>
                    <th className="num">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap text-ink-soft">{shortDate(e.spent_on)}</td>
                      <td>
                        <span className="pill pill-quiet">{e.category}</span>
                      </td>
                      <td className="max-w-[280px] truncate text-ink-soft">
                        {e.description ?? "—"}
                      </td>
                      <td className="num font-medium">{money(e.amount)}</td>
                      <td className="num">
                        <ActionButton
                          action={deleteExpenseAction.bind(null, e.id)}
                          className="btn btn-quiet btn-sm text-ink-faint hover:text-clay"
                          confirm={{
                            title: "Remove this expense?",
                            body: `${money(e.amount)} on ${shortDate(e.spent_on)} under ${e.category}. It will come off your profit and loss.`,
                            verb: "Remove it",
                            danger: true,
                          }}
                        >
                          Remove
                        </ActionButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="order-1 flex flex-col gap-5 lg:order-2">
        <Card>
          <CardHead title="Log an expense" />
          <ExpenseForm categories={expenseCategories(settings)} />
        </Card>

        {breakdown.length > 0 && (
          <Card>
            <CardHead title="By category" />
            <ul className="flex flex-col gap-2.5 px-5 py-5">
              {breakdown.map((b) => (
                <li key={b.category}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="text-[14px]">{b.category}</span>
                    <span className="tabular text-[14px]">{money(b.amount)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                    <div
                      className="h-full rounded-full bg-amber/60"
                      style={{ width: `${(b.amount / total) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

const trim = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

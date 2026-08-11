import Link from "next/link";
import {
  getDashboard,
  getRecentSales,
  getDailyRevenue,
  getOpenInvoices,
  getLowStock,
  checkIntegrity,
} from "@/lib/queries";
import { readRange, previousRange } from "@/lib/range";
import { money, dateTime, shortDate, daysBetween } from "@/lib/format";
import { Card, CardHead, PageHead, Stat, StatusPill, Empty, Note, Bars } from "@/components/ui";
import DateRange from "@/components/date-range";

export const dynamic = "force-dynamic";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { from, to } = readRange(await searchParams);
  const prev = previousRange(from, to);

  // Eight queries, one round trip's worth of waiting.
  const [now, before, recent, daily, open, low, problems] = await Promise.all([
    getDashboard(from, to),
    getDashboard(prev.from, prev.to),
    getRecentSales(12),
    getDailyRevenue(from, to),
    getOpenInvoices(),
    getLowStock(6),
    checkIntegrity(),
  ]);

  const delta =
    before.revenue > 0 ? ((now.revenue - before.revenue) / before.revenue) * 100 : null;
  const overdue = open.filter((i) => i.overdue);

  return (
    <>
      <PageHead
        title="Dashboard"
        hint={`${shortDate(from)} — ${shortDate(to)}`}
        action={<DateRange from={from} to={to} />}
      />

      {problems.length > 0 && (
        <div className="mb-5">
          <Note tone="bad">
            <strong>Something changed the database outside this app.</strong>
            <ul className="mt-1 list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Note>
        </div>
      )}

      <div className="stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Revenue"
          value={money(now.revenue)}
          tone="good"
          hint={
            delta === null
              ? `${now.orders} order${now.orders === 1 ? "" : "s"} in this period`
              : `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(0)}% vs. the ${
                  daysBetween(from, to)
                } days before`
          }
        />
        <Stat
          label="Still owed"
          value={money(now.outstanding)}
          tone={overdue.length ? "bad" : "plain"}
          href="/admin/financials?tab=receivable"
          hint={
            now.open_count === 0
              ? "Every invoice is paid"
              : `${now.open_count} open · ${overdue.length} overdue`
          }
        />
        <Stat
          label="Orders"
          value={String(now.orders)}
          hint={now.orders ? `${money(now.revenue / now.orders)} average` : "No sales yet"}
        />
        <Stat
          label="Store credit held"
          value={money(now.credit_outstanding)}
          hint="Owed to customers as credit"
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <CardHead
              title="Sales by day"
              hint={`${daysBetween(from, to)} days · ${money(now.tax)} sales tax collected`}
            />
            <div className="px-5 py-5">
              {daily.every((d) => d.total === 0) ? (
                <p className="py-8 text-center text-[14px] text-ink-faint">
                  No sales recorded in this period.
                </p>
              ) : (
                <>
                  <Bars
                    data={daily.map((d) => ({ label: shortDate(d.day), value: d.total }))}
                    height={110}
                  />
                  <div className="mt-2.5 flex justify-between text-[11.5px] text-ink-faint">
                    <span>{shortDate(from)}</span>
                    <span>{shortDate(to)}</span>
                  </div>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHead
              title="Recent sales"
              action={
                <Link href="/admin/financials?tab=receivable" className="btn btn-ghost btn-sm">
                  All invoices
                </Link>
              }
            />
            {recent.length === 0 ? (
              <div className="p-5">
                <Empty title="Nothing sold yet" hint="Sales made here and at the kiosk both land in this list." />
              </div>
            ) : (
              <div className="overflow-x-auto px-2 py-3">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Customer</th>
                      <th>Status</th>
                      <th className="num">Total</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((r) => (
                      <tr key={r.id}>
                        <td className="whitespace-nowrap text-ink-soft">{dateTime(r.sold_at)}</td>
                        <td className="max-w-[220px] truncate font-medium">
                          {r.customer_id ? (
                            <Link href={`/admin/customers/${r.customer_id}`} className="hover:text-spruce">
                              {r.customer_name}
                            </Link>
                          ) : (
                            r.customer_name
                          )}
                        </td>
                        <td>
                          <StatusPill status={r.status} />
                        </td>
                        <td className="num font-medium">{money(r.total)}</td>
                        <td className="num">
                          <Link href={`/admin/invoices/${r.id}`} className="btn btn-quiet btn-sm">
                            #{r.id}
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHead
              title="Needs attention"
              hint="Things worth a few minutes today"
            />
            <div className="flex flex-col divide-y divide-line-soft">
              {overdue.length === 0 && now.out_of_stock === 0 ? (
                <p className="px-5 py-8 text-center text-[14px] text-ink-faint">
                  Nothing overdue and nothing out of stock. Good day.
                </p>
              ) : null}

              {overdue.slice(0, 4).map((i) => (
                <Link
                  key={i.id}
                  href={`/admin/invoices/${i.id}`}
                  className="tap flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper/70"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] font-medium">
                      {i.customer_name}
                    </span>
                    <span className="block text-[12.5px] text-ink-faint">
                      #{i.id} · {i.days_overdue} day{i.days_overdue === 1 ? "" : "s"} overdue
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[14.5px] font-semibold">
                    {money(i.total)}
                  </span>
                </Link>
              ))}
              {overdue.length > 4 && (
                <Link
                  href="/admin/financials?tab=receivable"
                  className="px-5 py-3 text-[13.5px] font-medium text-spruce hover:underline"
                >
                  {overdue.length - 4} more overdue →
                </Link>
              )}

              {now.out_of_stock > 0 && (
                <Link
                  href="/admin/inventory?filter=out"
                  className="tap flex items-center justify-between gap-3 px-5 py-3 hover:bg-paper/70"
                >
                  <span>
                    <span className="block text-[14.5px] font-medium">
                      {now.out_of_stock} item{now.out_of_stock === 1 ? "" : "s"} out of stock
                    </span>
                    <span className="block text-[12.5px] text-ink-faint">
                      {low
                        .slice(0, 2)
                        .map((p) => p.name)
                        .join(", ")}
                      {low.length > 2 ? "…" : ""}
                    </span>
                  </span>
                  <span className="pill pill-due">Restock</span>
                </Link>
              )}
            </div>
          </Card>

          <Card>
            <CardHead title="Quick actions" />
            <div className="grid grid-cols-2 gap-2 p-4">
              <Link href="/admin/pos" className="btn btn-primary">
                New sale
              </Link>
              <Link href="/admin/customers?new=1" className="btn btn-ghost">
                Add customer
              </Link>
              <Link href="/admin/inventory?restock=1" className="btn btn-ghost">
                Restock
              </Link>
              <Link href="/admin/financials?tab=expenses" className="btn btn-ghost">
                Log expense
              </Link>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

import Link from "next/link";
import { getInvoicePage } from "@/lib/queries";
import { money, dateTime } from "@/lib/format";
import { Card, PageHead, StatusPill, Empty } from "@/components/ui";
import { Rows, RowLink } from "@/components/rows";

export const dynamic = "force-dynamic";

const PER_PAGE = 50;

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "paid", label: "Paid" },
  { key: "pending", label: "Unpaid" },
  { key: "void", label: "Void" },
] as const;

type Status = (typeof FILTERS)[number]["key"];

/**
 * Every transaction, back to the beginning.
 *
 * The dashboard shows the last twelve and its "All invoices" link went to the
 * unpaid tab, which is not all invoices — so there was no way to look at a sale
 * from last spring except by knowing its number. 1,399 records is too many to
 * send at once, so this pages, and the search and the filter are applied in the
 * database rather than to whatever happened to be on the current page.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const q = one("q");
  const status = (FILTERS.some((f) => f.key === one("status")) ? one("status") : "all") as Status;
  const page = Math.max(1, parseInt(one("page"), 10) || 1);

  const { rows, total } = await getInvoicePage({ page, perPage: PER_PAGE, q, status });
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const first = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const last = (page - 1) * PER_PAGE + rows.length;

  const link = (over: Record<string, string | number>) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status !== "all") sp.set("status", status);
    for (const [k, v] of Object.entries(over)) {
      if (v === "" || v === "all" || v === 1) sp.delete(k);
      else sp.set(k, String(v));
    }
    const s = sp.toString();
    return s ? `/admin/invoices?${s}` : "/admin/invoices";
  };

  return (
    <>
      <PageHead
        title="Transactions"
        hint={
          total === 0
            ? "Nothing matches"
            : `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`
        }
      />

      {/* A plain GET form, so a search survives a refresh and can be linked to
          or bookmarked. Paging back and forth keeps whatever is typed here. */}
      <form method="get" className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative sm:min-w-[220px] sm:flex-1">
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
            name="q"
            defaultValue={q}
            placeholder="Customer name or invoice number"
            autoComplete="off"
            aria-label="Search transactions"
            className="field pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            name="status"
            defaultValue={status}
            className="field flex-1 sm:w-auto sm:flex-none"
            aria-label="Show"
          >
            {FILTERS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-ghost">
            Search
          </button>
          {(q || status !== "all") && (
            <Link href="/admin/invoices" className="btn btn-quiet btn-sm text-ink-faint">
              Clear
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty
          title="Nothing matches that"
          hint="Try part of a surname, or an invoice number."
          action={
            <Link href="/admin/invoices" className="btn btn-ghost">
              Show everything
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="sm:hidden">
            <Rows>
              {rows.map((r) => (
                <RowLink
                  key={r.id}
                  href={`/admin/invoices/${r.id}`}
                  title={r.customer_name}
                  sub={`#${r.id} · ${dateTime(r.sold_at)}${r.payment ? ` · ${cap(r.payment)}` : ""}`}
                  right={money(r.total)}
                  rightSub={
                    r.returns_id ? (
                      <span className="pill pill-quiet">Return</span>
                    ) : (
                      <StatusPill status={r.status} />
                    )
                  }
                />
              ))}
            </Rows>
          </div>
          <div className="hidden overflow-x-auto px-2 py-3 sm:block">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap text-ink-soft">{dateTime(r.sold_at)}</td>
                    <td className="max-w-[240px] truncate font-medium">
                      {r.customer_id ? (
                        <Link
                          href={`/admin/customers/${r.customer_id}`}
                          className="hover:text-spruce"
                        >
                          {r.customer_name}
                        </Link>
                      ) : (
                        r.customer_name
                      )}
                    </td>
                    <td>
                      {r.returns_id ? (
                        <span className="pill pill-quiet">Return</span>
                      ) : (
                        <StatusPill status={r.status} />
                      )}
                    </td>
                    <td className="text-ink-soft">{r.payment ? cap(r.payment) : "—"}</td>
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
        </Card>
      )}

      {pages > 1 && (
        <nav className="mt-5 flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={link({ page: page - 1 })} className="btn btn-ghost">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[13.5px] text-ink-faint">
            Page {page.toLocaleString()} of {pages.toLocaleString()}
          </span>
          {page < pages ? (
            <Link href={link({ page: page + 1 })} className="btn btn-ghost">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

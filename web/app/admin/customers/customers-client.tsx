"use client";

import { useMemo, useState, useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { money, phone as fmtPhone, shortDate } from "@/lib/format";
import { Card, Empty, Field } from "@/components/ui";
import { Submit, Result } from "@/components/form";
import Modal from "@/components/modal";
import { createCustomerAction } from "./actions";

type Row = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  credit: number;
  is_wholesale: boolean;
  spent: number;
  owing: number;
  last_sale: string | null;
};

type Sort = "name" | "spent" | "recent" | "owing";

/**
 * The whole customer book, filtered in the browser.
 *
 * 226 names is nothing to send and everything to gain: typing filters with no
 * round trip, so finding someone at the counter is instant even when the wifi
 * is behaving badly. The old version paged 25 at a time and made you guess
 * which page the B's were on.
 */
export default function CustomersClient({
  rows,
  openNew,
}: {
  rows: Row[];
  openNew: boolean;
}) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [filter, setFilter] = useState<"all" | "wholesale" | "credit" | "owing">("all");
  const [adding, setAdding] = useState(openNew);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const digits = needle.replace(/\D/g, "");
    let out = rows.filter((r) => {
      if (filter === "wholesale" && !r.is_wholesale) return false;
      if (filter === "credit" && r.credit <= 0) return false;
      if (filter === "owing" && r.owing <= 0) return false;
      if (!needle) return true;
      if (r.name.toLowerCase().includes(needle)) return true;
      if ((r.email ?? "").toLowerCase().includes(needle)) return true;
      if (digits.length >= 3 && (r.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
      return false;
    });
    out = [...out].sort((a, b) => {
      if (sort === "spent") return b.spent - a.spent;
      if (sort === "owing") return b.owing - a.owing;
      if (sort === "recent")
        return (b.last_sale ?? "").localeCompare(a.last_sale ?? "");
      return a.name.localeCompare(b.name);
    });
    return out;
  }, [rows, q, sort, filter]);

  // Two customers may legitimately share a name (there are two Willow
  // Overholtzers). Rather than pretend otherwise, the ones that collide get
  // their id shown so you can tell them apart at a glance.
  const dupes = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      const k = r.name.trim().toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return seen;
  }, [rows]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
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
            placeholder="Search by name, phone or email"
            autoComplete="off"
            className="field pl-10"
            aria-label="Search customers"
          />
        </div>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="field w-auto"
          aria-label="Filter"
        >
          <option value="all">Everyone</option>
          <option value="wholesale">Wholesale only</option>
          <option value="credit">Has store credit</option>
          <option value="owing">Owes money</option>
        </select>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
          className="field w-auto"
          aria-label="Sort"
        >
          <option value="name">A–Z</option>
          <option value="recent">Most recent</option>
          <option value="spent">Biggest spenders</option>
          <option value="owing">Owes the most</option>
        </select>

        <button type="button" onClick={() => setAdding(true)} className="btn btn-primary">
          Add customer
        </button>
      </div>

      <p className="mb-3 text-[13px] text-ink-faint">
        {shown.length === rows.length
          ? `${rows.length} customers`
          : `${shown.length} of ${rows.length} customers`}
      </p>

      {shown.length === 0 ? (
        // An empty list has two quite different causes, and telling someone to
        // try another spelling when the filter is what emptied it is no help.
        // The wholesale case is the one that actually comes up: the feature is
        // built and working, but nobody has been marked as a wholesale account
        // yet, so it never shows itself anywhere.
        filter === "wholesale" && q.trim() === "" ? (
          <Empty
            title="No wholesale accounts yet"
            hint="A wholesale customer is charged wholesale prices and no sales tax. Open anyone's profile and tick “Wholesale account” under Details — they'll appear here, and the till will price their sales that way from then on."
            action={
              <button type="button" className="btn btn-ghost" onClick={() => setFilter("all")}>
                Show everyone
              </button>
            }
          />
        ) : (
          <Empty
            title="Nobody matches that"
            hint={
              filter === "all"
                ? "Try part of a surname, or the last four digits of a phone number."
                : "Nobody in this filter matches the search."
            }
            action={
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setQ("");
                  setFilter("all");
                }}
              >
                Clear it
              </button>
            }
          />
        )
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line-soft">
            {shown.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/customers/${r.id}`}
                  className="tap flex items-center gap-4 px-4 py-3 hover:bg-paper/70"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15px] font-medium">{r.name}</span>
                      {(dupes.get(r.name.trim().toLowerCase()) ?? 0) > 1 && (
                        <span className="pill pill-quiet">{r.id}</span>
                      )}
                      {r.is_wholesale && <span className="pill pill-quiet">Wholesale</span>}
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-ink-faint">
                      {[fmtPhone(r.phone) || null, r.email]
                        .filter(Boolean)
                        .join(" · ") || "No contact details"}
                    </span>
                  </span>

                  <span className="hidden w-28 shrink-0 text-right sm:block">
                    {r.credit > 0 && <span className="pill pill-paid">{money(r.credit)} credit</span>}
                    {r.owing > 0 && <span className="pill pill-due">{money(r.owing)} due</span>}
                  </span>

                  <span className="hidden w-32 shrink-0 text-right md:block">
                    <span className="tabular block text-[14px] font-medium">{money(r.spent)}</span>
                    <span className="block text-[11.5px] text-ink-faint">
                      {r.last_sale ? shortDate(r.last_sale) : "no purchases"}
                    </span>
                  </span>

                  <span aria-hidden className="shrink-0 text-ink-faint">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {adding && <NewCustomer onClose={() => setAdding(false)} />}
    </>
  );
}

function NewCustomer({ onClose }: { onClose: () => void }) {
  const [result, action] = useActionState(createCustomerAction, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (result?.ok) {
      formRef.current?.reset();
      const t = setTimeout(onClose, 700);
      return () => clearTimeout(t);
    }
  }, [result, onClose]);

  return (
    <Modal onClose={onClose} labelledBy="new-cust-title">
      <form
        ref={formRef}
        action={action}
        className="pop w-full max-w-[420px] rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow-float)]"
      >
        <h2 id="new-cust-title" className="font-display text-[20px] font-semibold">
          Add a customer
        </h2>
        <p className="mt-1 text-[13.5px] text-ink-faint">
          Only the name is required — the rest can be filled in later.
        </p>

        <div className="mt-5 flex flex-col gap-3.5">
          <Field label="Name">
            <input name="name" required autoFocus className="field" autoComplete="off" />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Phone">
              <input name="phone" type="tel" className="field" autoComplete="off" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" className="field" autoComplete="off" />
            </Field>
          </div>
          <label className="flex items-center gap-2.5 text-[14px]">
            <input type="checkbox" name="is_wholesale" className="check" />
            Wholesale account
          </label>
        </div>

        <Result result={result} />

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <Submit pendingLabel="Adding…">Add customer</Submit>
        </div>
      </form>
    </Modal>
  );
}

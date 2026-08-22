"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { today } from "@/lib/format";
import { Spinner } from "./form";

/**
 * The reporting period, in the URL.
 *
 * Keeping it in the query string means a range can be bookmarked, sent to the
 * bookkeeper, or reloaded after a wifi drop and still show the same numbers.
 * The old version kept it in session state, so a refresh silently reset every
 * report to "this month" — including one you had just been reading.
 *
 * The presets are built by string arithmetic on the shop's own date rather than
 * from the browser's clock, so a laptop travelling east for the weekend doesn't
 * quietly report a different month than the till does.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function presets(now: string): { label: string; range: () => [string, string] }[] {
  const [y, m] = now.split("-").map(Number);
  return [
    { label: "This month", range: () => [`${y}-${pad(m)}-01`, now] },
    {
      label: "Last month",
      range: () => {
        const py = m === 1 ? y - 1 : y;
        const pm = m === 1 ? 12 : m - 1;
        return [`${py}-${pad(pm)}-01`, `${py}-${pad(pm)}-${pad(lastDay(py, pm))}`];
      },
    },
    {
      label: "This quarter",
      range: () => [`${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, now],
    },
    { label: "This year", range: () => [`${y}-01-01`, now] },
    { label: "Last year", range: () => [`${y - 1}-01-01`, `${y - 1}-12-31`] },
  ];
}

export default function DateRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const options = presets(today());

  function apply(nextFrom: string, nextTo: string) {
    const q = new URLSearchParams(params.toString());
    q.set("from", nextFrom);
    q.set("to", nextTo);
    start(() => router.push(`${path}?${q.toString()}`, { scroll: false }));
  }

  const active = options.find((p) => {
    const [a, b] = p.range();
    return a === from && b === to;
  });

  return (
    <div className="no-print flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
      {/* One row that scrolls on a phone. Wrapped chips plus two date boxes
          were eating a third of the screen before any numbers appeared. */}
      <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible sm:pb-0 [&::-webkit-scrollbar]:hidden">
        {options.map((p) => {
          const on = active?.label === p.label;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                const [a, b] = p.range();
                apply(a, b);
              }}
              className={`tap shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                on
                  ? "border-spruce/30 bg-spruce-light text-spruce-dark"
                  : "border-line bg-surface text-ink-soft hover:border-ink-faint/50"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 self-start rounded-full border border-line bg-surface px-1.5 py-1">
        <input
          type="date"
          aria-label="From"
          value={from}
          max={to}
          onChange={(e) => e.target.value && apply(e.target.value, to)}
          className="tabular w-[124px] bg-transparent px-1.5 text-[13px] text-ink outline-none"
        />
        <span className="text-ink-faint" aria-hidden>
          →
        </span>
        <input
          type="date"
          aria-label="To"
          value={to}
          min={from}
          onChange={(e) => e.target.value && apply(from, e.target.value)}
          className="tabular w-[124px] bg-transparent px-1.5 text-[13px] text-ink outline-none"
        />
        {pending && <Spinner className="mr-1 text-ink-faint" />}
      </div>
    </div>
  );
}

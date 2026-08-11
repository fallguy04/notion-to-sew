import Link from "next/link";
import { money, isPast } from "@/lib/format";

/**
 * The pieces every screen is built from.
 *
 * These are server components on purpose — a card or a status pill has no
 * interactivity, and shipping them to the browser would be paying for nothing.
 */

export function Card({
  children,
  className = "",
  as: As = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return (
    <As className={`rounded-2xl border border-line bg-surface ${className}`}>{children}</As>
  );
}

export function CardHead({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
      <div className="min-w-0">
        <h2 className="font-display text-[17px] font-semibold leading-tight">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] leading-snug text-ink-faint">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHead({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] font-semibold leading-none tracking-tight">
          {title}
        </h1>
        {hint && <p className="mt-2 text-[14px] text-ink-soft">{hint}</p>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

/**
 * A number with its label. The value carries the visual weight and the label
 * stays quiet — the opposite of the old dashboard, where the caption was as
 * loud as the figure it described.
 */
export function Stat({
  label,
  value,
  hint,
  tone = "plain",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "plain" | "good" | "warn" | "bad";
  href?: string;
}) {
  const accent = {
    plain: "text-ink",
    good: "text-spruce",
    warn: "text-amber",
    bad: "text-clay",
  }[tone];

  const body = (
    <>
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
        {label}
      </div>
      <div className={`font-display tabular mt-2 text-[27px] font-semibold leading-none ${accent}`}>
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[12.5px] leading-snug text-ink-faint">{hint}</div>}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="tap block rounded-2xl border border-line bg-surface p-5 hover:border-spruce/40 hover:shadow-[var(--shadow-lift)]"
      >
        {body}
      </Link>
    );
  }
  return <div className="rounded-2xl border border-line bg-surface p-5">{body}</div>;
}

export function StatusPill({
  status,
  dueDate,
}: {
  status: string;
  dueDate?: string | null;
}) {
  const s = status.toLowerCase();
  if (s === "paid") return <span className="pill pill-paid">Paid</span>;
  if (s === "void") return <span className="pill pill-quiet">Void</span>;
  const late = isPast(dueDate);
  return (
    <span className={`pill ${late ? "pill-late" : "pill-due"}`}>{late ? "Overdue" : "Unpaid"}</span>
  );
}

export function Money({
  value,
  className = "",
  bold = false,
}: {
  value: number;
  className?: string;
  bold?: boolean;
}) {
  return (
    <span className={`tabular ${bold ? "font-semibold" : ""} ${className}`}>{money(value)}</span>
  );
}

export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center">
      <p className="font-display text-[18px] font-semibold">{title}</p>
      {hint && <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-ink-faint">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

/** A quiet, one-line advisory. Never a wall of colour. */
export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const style = {
    info: "border-l-spruce bg-spruce-light/50 text-ink-soft",
    warn: "border-l-amber bg-amber-light/50 text-ink-soft",
    bad: "border-l-clay bg-clay-light/60 text-ink-soft",
  }[tone];
  return (
    <div className={`rounded-r-lg border-l-[3px] py-2.5 pl-3.5 pr-4 text-[13.5px] leading-relaxed ${style}`}>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12.5px] leading-snug text-ink-faint">{hint}</span>}
    </label>
  );
}

/** A hairline bar chart. No charting library for seven data points. */
export function Bars({
  data,
  height = 56,
}: {
  data: { label: string; value: number }[];
  height?: number;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {data.map((d, i) => (
        <div
          key={i}
          title={`${d.label}: ${money(d.value)}`}
          className="flex-1 rounded-t-[3px] bg-spruce/15 transition-colors hover:bg-spruce/35"
          style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

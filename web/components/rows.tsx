import Link from "next/link";

/**
 * A table, re-said for a phone.
 *
 * Every list in the back office is a table, and a table on a 375px screen
 * side-scrolls — which is the single most "shrunken web page" thing an app can
 * do. These rows carry the same facts in the shape a phone list actually uses:
 * who or what on the left, money on the right, the detail line underneath, the
 * whole row a target. Pages render the table from `sm` up and these below it,
 * off the same data, so the two can't drift.
 */
export function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-line-soft">{children}</ul>;
}

export function RowLink({
  href,
  title,
  sub,
  right,
  rightSub,
}: {
  href: string;
  title: React.ReactNode;
  sub: React.ReactNode;
  right: React.ReactNode;
  rightSub?: React.ReactNode;
}) {
  return (
    <li>
      <Link href={href} className="tap flex items-center gap-3 px-4 py-3 active:bg-paper/70">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium leading-snug">{title}</span>
          <span className="mt-0.5 block truncate text-[12.5px] text-ink-faint">{sub}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-[15px] font-semibold leading-snug">{right}</span>
          {rightSub && <span className="mt-1 block">{rightSub}</span>}
        </span>
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-ink-faint/60"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="m9 5 7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}

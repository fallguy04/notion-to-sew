import { startOfMonth, startOfYear, today, daysBetween } from "./format";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads a reporting period out of the query string.
 *
 * Anything that isn't a plain yyyy-mm-dd is discarded rather than passed to
 * Postgres to reject, and a backwards range is swapped rather than silently
 * returning nothing — a report that shows zero because the dates are the wrong
 * way round looks exactly like a report that shows zero because there were no
 * sales.
 */
export function readRange(
  params: Record<string, string | string[] | undefined>,
  fallback: "month" | "year" = "month",
): { from: string; to: string } {
  const pick = (v: string | string[] | undefined) => {
    const s = Array.isArray(v) ? v[0] : v;
    return s && ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : undefined;
  };

  let from = pick(params.from) ?? (fallback === "year" ? startOfYear() : startOfMonth());
  let to = pick(params.to) ?? today();
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

/**
 * The same span again, ending the day before this one starts — for "vs. last
 * period". The arithmetic is done in UTC on purpose: these are calendar dates
 * with no time of day, so a timezone would only introduce a chance of landing
 * on the wrong side of midnight.
 */
export function previousRange(from: string, to: string) {
  const days = daysBetween(from, to);
  const prevTo = shift(from, -1);
  const prevFrom = shift(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo };
}

/** Moves a yyyy-mm-dd date by whole days. */
export function shift(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

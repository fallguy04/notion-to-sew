/** Formatting used on both the server and the client, so it lives on its own. */

export const money = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });

/**
 * A price *each*, which may carry more than two decimals.
 *
 * Six buttons for 99c is 16.5c each. Printing that through the ordinary money
 * formatter gives "$0.17", and a customer reading "6 x $0.17 = $0.99" would
 * reasonably think the arithmetic was wrong. Totals stay at two decimals —
 * only the per-unit figure is allowed a third and fourth.
 */
export const unitPrice = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });

/** Signed, with losses in parentheses — the convention on a P&L. */
export const accounting = (n: number) => (n < 0 ? `(${money(Math.abs(n))})` : money(n));

/**
 * Every date and time in this app is the shop's, in Modesto.
 *
 * This has to be stated rather than inferred. The pages render on Vercel, whose
 * servers run in UTC: a sale rung up at five in the afternoon would otherwise
 * be dated the following day on its own invoice, and a report for "today"
 * would start seven hours early. Pinning to the shop's clock also means the
 * server and the browser agree, so nothing flickers to a different date when
 * the page hydrates.
 */
export const SHOP_TZ = "America/Los_Angeles";

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A bare "2026-08-01" is parsed by `new Date()` as midnight *UTC*, which in
 * California is the evening of July 31st — so a date picker set to August 1st
 * rendered as "Jul 31, 2026" one line above itself. Date-only values are built
 * as local dates instead; timestamps carry their own offset and are left alone.
 */
export function toDate(d: string | Date): Date {
  if (d instanceof Date) return d;
  const m = DATE_ONLY.exec(d);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(d);
}

/** Date-only strings are already the shop's day; timestamps must be converted. */
const zoneFor = (d: string | Date) =>
  typeof d === "string" && DATE_ONLY.test(d) ? undefined : SHOP_TZ;

/** "Mar 4, 2026" */
export function shortDate(d: string | Date | null | undefined) {
  if (!d) return "—";
  const dt = toDate(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: zoneFor(d),
  });
}

/** "Mar 4, 3:12 PM" — for lists where the year is obvious from context. */
export function dateTime(d: string | Date | null | undefined) {
  if (!d) return "—";
  const dt = toDate(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zoneFor(d),
  });
}

/** yyyy-mm-dd in the shop's timezone, which is what Postgres and <input type="date"> want. */
export function isoDate(d: Date | string): string {
  if (typeof d === "string" && DATE_ONLY.test(d)) return d;
  const dt = typeof d === "string" ? new Date(d) : d;
  // en-CA formats as yyyy-mm-dd, which saves reassembling the parts by hand.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

/** Today, this month and this year — all as the shop would reckon them. */
export const today = () => isoDate(new Date());

function shopParts() {
  const [y, m, d] = today().split("-").map(Number);
  return { y, m, d };
}

export const startOfMonth = () => {
  const { y, m } = shopParts();
  return `${y}-${String(m).padStart(2, "0")}-01`;
};

export const startOfYear = () => `${shopParts().y}-01-01`;

/** True when a due date has already passed, comparing whole shop days. */
export function isPast(d: string | Date | null | undefined) {
  if (!d) return false;
  const iso = typeof d === "string" && DATE_ONLY.test(d) ? d : isoDate(d);
  return iso < today();
}

/** (209) 555-0134 when it's a US number, otherwise whatever was typed. */
export function phone(raw: string | null | undefined) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10)
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits.startsWith("1"))
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return String(raw ?? "");
}

/**
 * A tax rate can be stored as 0.0875 or as 8.75 depending on which version of
 * the settings screen last wrote it, and the live value carries a "%" sign. All
 * three mean the same thing; guess by size.
 */
export function normaliseRate(raw: string | number | null | undefined): number {
  const n = parseFloat(String(raw ?? "").replace("%", "").trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return n > 1 ? n / 100 : n;
}

export const pct = (rate: number) => `${(rate * 100).toFixed(3).replace(/\.?0+$/, "")}%`;

/**
 * Shipping is stored as an ordinary line, the way all 1,374 migrated invoices
 * carry it. That means `invoices.subtotal` includes it — so a document that
 * printed the stored subtotal showed a different figure from the till, which
 * lists shipping on its own. These two pull it back out so both agree.
 */
export const isShippingLine = (l: { sku?: string | null; description: string }) =>
  (l.sku ?? "").toUpperCase() === "FREIGHT" || /^shipping\b/i.test(l.description);

export const shippingTotal = (
  lines: { sku?: string | null; description: string; line_total: number }[],
) => lines.reduce((s, l) => (isShippingLine(l) ? s + l.line_total : s), 0);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Works out which rows an invoice should print so that they add up to the total
 * it was actually settled for.
 *
 * Two conventions live in this data. Anything this app wrote stores a total
 * that includes sales tax. 1,046 records imported from the previous
 * bookkeeping software store the total *before* tax, with the tax alongside it
 * — so printing "subtotal + tax = total" on those produces a document that
 * visibly doesn't add up. A handful of others carry a bulk discount that the
 * old checkout applied to the money but never recorded.
 *
 * Rather than pick a convention and misstate somebody's invoice, this reads
 * each one: whichever arrangement lands on the recorded total is the one that
 * gets printed, and any remainder is shown as an adjustment instead of being
 * quietly absorbed.
 */
export function invoiceMaths(
  invoice: {
    subtotal: number;
    discount: number;
    tax: number;
    credit_applied: number;
    total: number;
  },
  lines: { sku?: string | null; description: string; line_total: number }[],
) {
  const shipping = round2(shippingTotal(lines));
  const goods = round2(invoice.subtotal - shipping);
  const base = round2(goods - invoice.discount + shipping - invoice.credit_applied);
  const withTax = round2(base + invoice.tax);

  const taxIncluded = Math.abs(withTax - invoice.total) <= Math.abs(base - invoice.total);
  const adjustment = round2(invoice.total - (taxIncluded ? withTax : base));

  return { goods, shipping, taxIncluded, adjustment };
}

/** Whole days between two yyyy-mm-dd dates, inclusive of both ends. */
export const daysBetween = (from: string, to: string) =>
  Math.max(
    1,
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1,
  );

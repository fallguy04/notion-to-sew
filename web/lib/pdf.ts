import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Invoice, InvoiceLine } from "./db";
import { money, shortDate, invoiceMaths } from "./format";

/**
 * Invoice and report PDFs.
 *
 * pdf-lib rather than a headless browser: it is pure JavaScript, so it runs
 * inside an ordinary Vercel function with no binary to install and no cold
 * start measured in seconds.
 *
 * The layout is deliberately plain — this is a document that gets printed on a
 * shop printer, folded, and mailed. Ink is expensive and a fax of it has to
 * stay readable.
 */

const PAGE = { w: 612, h: 792 }; // US Letter, in points
const M = 54; // margin
const INK = rgb(0.133, 0.125, 0.114);
const SOFT = rgb(0.34, 0.32, 0.29);
const FAINT = rgb(0.62, 0.59, 0.55);
const LINE = rgb(0.86, 0.84, 0.8);
const SPRUCE = rgb(0.122, 0.431, 0.353);

type Fonts = { regular: PDFFont; bold: PDFFont };

/** Latin-1 is all the standard PDF fonts can encode; a smart quote would throw. */
const safe = (s: string) =>
  String(s ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E]/g, "");

function truncate(text: string, font: PDFFont, size: number, maxWidth: number) {
  let s = safe(text);
  if (font.widthOfTextAtSize(s, size) <= maxWidth) return s;
  while (s.length > 1 && font.widthOfTextAtSize(s + "...", size) > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + "...";
}

function right(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = INK) {
  const s = safe(text);
  page.drawText(s, { x: x - font.widthOfTextAtSize(s, size), y, size, font, color });
}

function rule(page: PDFPage, y: number, from = M, to = PAGE.w - M, color = LINE) {
  page.drawLine({ start: { x: from, y }, end: { x: to, y }, thickness: 0.75, color });
}

export type InvoicePdfInput = {
  invoice: Invoice;
  lines: InvoiceLine[];
  company: { name: string; address: string };
  customer: { name: string; address?: string | null; email?: string | null };
};

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  let page = doc.addPage([PAGE.w, PAGE.h]);
  const { invoice, lines, company, customer } = input;

  // ---- masthead ----------------------------------------------------------
  let y = PAGE.h - M;
  page.drawText(safe(company.name), {
    x: M, y: y - 18, size: 22, font: fonts.bold, color: INK,
  });
  y -= 22;
  for (const l of company.address.split("\n")) {
    y -= 12;
    page.drawText(safe(l.trim()), { x: M, y: y - 6, size: 9.5, font: fonts.regular, color: SOFT });
  }

  const isPaid = invoice.status === "paid";
  const title = invoice.status === "void" ? "VOID" : isPaid ? "RECEIPT" : "INVOICE";
  right(page, title, PAGE.w - M, PAGE.h - M - 14, fonts.bold, 20, isPaid ? SPRUCE : INK);
  right(page, `No. ${invoice.id}`, PAGE.w - M, PAGE.h - M - 32, fonts.regular, 11, SOFT);

  y = Math.min(y, PAGE.h - M - 46) - 20;
  rule(page, y);

  // ---- bill to / meta ----------------------------------------------------
  y -= 22;
  page.drawText("BILL TO", { x: M, y, size: 8, font: fonts.bold, color: FAINT });
  const metaX = PAGE.w - M;
  right(page, "DATE", metaX - 92, y, fonts.bold, 8, FAINT);
  right(page, safe(shortDate(invoice.sold_at)), metaX, y, fonts.regular, 9.5, INK);

  let by = y - 15;
  page.drawText(truncate(customer.name, fonts.bold, 11.5, 280), {
    x: M, y: by, size: 11.5, font: fonts.bold, color: INK,
  });
  for (const l of String(customer.address ?? "").split("\n").filter(Boolean)) {
    by -= 12;
    page.drawText(truncate(l.trim(), fonts.regular, 9.5, 280), {
      x: M, y: by, size: 9.5, font: fonts.regular, color: SOFT,
    });
  }
  if (customer.email) {
    by -= 12;
    page.drawText(truncate(customer.email, fonts.regular, 9.5, 280), {
      x: M, y: by, size: 9.5, font: fonts.regular, color: SOFT,
    });
  }

  let my = y - 15;
  if (isPaid && invoice.paid_at) {
    right(page, "PAID", metaX - 92, my, fonts.bold, 8, FAINT);
    right(page, safe(shortDate(invoice.paid_at)), metaX, my, fonts.regular, 9.5, SPRUCE);
    my -= 15;
  } else {
    right(page, "DUE", metaX - 92, my, fonts.bold, 8, FAINT);
    right(page, invoice.due_date ? safe(shortDate(invoice.due_date)) : "Upon receipt",
      metaX, my, fonts.regular, 9.5, INK);
    my -= 15;
  }
  if (invoice.payment) {
    right(page, "PAYMENT", metaX - 92, my, fonts.bold, 8, FAINT);
    right(page, cap(invoice.payment), metaX, my, fonts.regular, 9.5, SOFT);
    my -= 15;
  }

  // ---- line items --------------------------------------------------------
  y = Math.min(by, my) - 30;

  const col = { sku: M, desc: M + 92, qty: 388, price: 462, total: PAGE.w - M };
  const header = (yy: number) => {
    page.drawText("ITEM", { x: col.sku, y: yy, size: 8, font: fonts.bold, color: FAINT });
    page.drawText("DESCRIPTION", { x: col.desc, y: yy, size: 8, font: fonts.bold, color: FAINT });
    right(page, "QTY", col.qty, yy, fonts.bold, 8, FAINT);
    right(page, "PRICE", col.price, yy, fonts.bold, 8, FAINT);
    right(page, "AMOUNT", col.total, yy, fonts.bold, 8, FAINT);
    rule(page, yy - 8);
  };
  header(y);
  y -= 24;

  for (const l of lines) {
    if (y < 150) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - M;
      header(y);
      y -= 24;
    }
    page.drawText(truncate(l.sku ?? "—", fonts.regular, 9, 84), {
      x: col.sku, y, size: 9, font: fonts.regular, color: SOFT,
    });
    page.drawText(truncate(l.description, fonts.regular, 9.5, col.qty - col.desc - 34), {
      x: col.desc, y, size: 9.5, font: fonts.regular, color: INK,
    });
    right(page, trimNum(l.qty), col.qty, y, fonts.regular, 9.5);
    right(page, money(l.unit_price), col.price, y, fonts.regular, 9.5);
    right(page, money(l.line_total), col.total, y, fonts.regular, 9.5);
    y -= 17;
  }

  // ---- totals ------------------------------------------------------------
  if (y < 190) {
    page = doc.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - M;
  }
  y -= 6;
  rule(page, y, 340);
  y -= 18;

  const totalRow = (label: string, value: string, opts?: { bold?: boolean; color?: typeof INK }) => {
    const font = opts?.bold ? fonts.bold : fonts.regular;
    right(page, label, col.price, y, font, opts?.bold ? 10 : 9.5, opts?.color ?? SOFT);
    right(page, value, col.total, y, font, opts?.bold ? 10 : 9.5, opts?.color ?? INK);
    y -= 16;
  };

  // Only rows that actually add up to the recorded total get printed. See
  // invoiceMaths: shipping is a line item, and older records keep tax outside
  // the total, so a fixed layout would produce documents that don't balance.
  const { goods, shipping, taxIncluded, adjustment } = invoiceMaths(invoice, lines);
  totalRow("Subtotal", money(goods));
  if (invoice.discount > 0) totalRow("Discount", `-${money(invoice.discount)}`);
  if (shipping > 0) totalRow("Shipping", money(shipping));
  if (taxIncluded && invoice.tax > 0) totalRow("Sales tax", money(invoice.tax));
  if (invoice.credit_applied > 0) totalRow("Store credit", `-${money(invoice.credit_applied)}`);
  if (Math.abs(adjustment) >= 0.01) {
    totalRow("Adjustment", `${adjustment < 0 ? "-" : ""}${money(Math.abs(adjustment))}`);
  }

  y -= 4;
  rule(page, y + 10, 340);
  y -= 4;
  totalRow(isPaid ? "Paid in full" : "Amount due", money(invoice.total), {
    bold: true,
    color: isPaid ? SPRUCE : INK,
  });

  if (!taxIncluded && invoice.tax > 0) {
    y -= 8;
    right(page, `Sales tax of ${money(invoice.tax)} recorded separately.`,
      col.total, y, fonts.regular, 8, FAINT);
    y -= 12;
  }

  if (invoice.note && !/^gift-credit:/.test(invoice.note)) {
    y -= 14;
    page.drawText(truncate(invoice.note, fonts.regular, 9, PAGE.w - 2 * M), {
      x: M, y, size: 9, font: fonts.regular, color: SOFT,
    });
  }

  // ---- footer ------------------------------------------------------------
  const foot = isPaid
    ? "Thank you for your business."
    : "Please make checks payable to " + company.name + ". Thank you!";
  page.drawText(safe(foot), { x: M, y: M - 12, size: 9, font: fonts.regular, color: FAINT });

  return doc.save();
}

export type IncomeStatementInput = {
  company: string;
  start: string;
  end: string;
  retail: number;
  wholesale: number;
  freight: number;
  giftCards: number;
  totalIncome: number;
  cogs: number;
  grossProfit: number;
  expenses: { category: string; amount: number }[];
  totalExpenses: number;
  netProfit: number;
  notes: string[];
};

export async function buildIncomeStatementPdf(d: IncomeStatementInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - M;

  page.drawText(safe(d.company), { x: M, y: y - 16, size: 18, font: fonts.bold, color: INK });
  y -= 34;
  page.drawText("Income Statement", { x: M, y, size: 12, font: fonts.bold, color: SOFT });
  y -= 14;
  page.drawText(safe(`${shortDate(d.start)} to ${shortDate(d.end)}`), {
    x: M, y, size: 9.5, font: fonts.regular, color: FAINT,
  });
  y -= 16;
  rule(page, y);
  y -= 26;

  const amountX = PAGE.w - M;
  const section = (label: string) => {
    page.drawText(safe(label), { x: M, y, size: 8.5, font: fonts.bold, color: FAINT });
    y -= 16;
  };
  const row = (label: string, amount: number, opts?: { bold?: boolean; indent?: boolean; ruleAbove?: boolean }) => {
    if (opts?.ruleAbove) {
      rule(page, y + 11, 360);
    }
    const font = opts?.bold ? fonts.bold : fonts.regular;
    page.drawText(truncate(label, font, 10, 300), {
      x: M + (opts?.indent ? 12 : 0), y, size: 10, font, color: opts?.bold ? INK : SOFT,
    });
    right(page, amount < 0 ? `(${money(Math.abs(amount))})` : money(amount), amountX, y, font, 10, INK);
    y -= 16;
  };

  // Retail and wholesale are each net of sales tax and already include any
  // shipping charged on those invoices, so they sum to total revenue exactly.
  // Shipping and gift certificates appear in the notes rather than as extra
  // revenue lines, because adding them here would count the same dollars twice.
  section("REVENUE");
  row("Retail sales", d.retail, { indent: true });
  row("Wholesale sales", d.wholesale, { indent: true });
  row("Total revenue", d.totalIncome, { bold: true, ruleAbove: true });
  y -= 10;

  section("COST OF GOODS SOLD");
  row("Cost of goods sold", d.cogs, { indent: true });
  row("Gross profit", d.grossProfit, { bold: true, ruleAbove: true });
  y -= 10;

  section("OPERATING EXPENSES");
  if (d.expenses.length === 0) {
    row("No expenses recorded in this period", 0, { indent: true });
  } else {
    for (const e of d.expenses) row(e.category, e.amount, { indent: true });
  }
  row("Total expenses", d.totalExpenses, { bold: true, ruleAbove: true });
  y -= 16;

  rule(page, y + 12, M, PAGE.w - M, INK);
  page.drawText("NET PROFIT", { x: M, y: y - 8, size: 12, font: fonts.bold, color: INK });
  right(
    page,
    d.netProfit < 0 ? `(${money(Math.abs(d.netProfit))})` : money(d.netProfit),
    amountX, y - 8, fonts.bold, 14,
    d.netProfit < 0 ? rgb(0.65, 0.23, 0.2) : SPRUCE,
  );
  y -= 34;

  if (d.notes.length) {
    rule(page, y);
    y -= 18;
    page.drawText("NOTES", { x: M, y, size: 8.5, font: fonts.bold, color: FAINT });
    y -= 14;
    for (const n of d.notes) {
      page.drawText(truncate("- " + n, fonts.regular, 9, PAGE.w - 2 * M), {
        x: M, y, size: 9, font: fonts.regular, color: SOFT,
      });
      y -= 13;
    }
  }

  page.drawText(safe(`Generated ${shortDate(new Date())}`), {
    x: M, y: M - 12, size: 8.5, font: fonts.regular, color: FAINT,
  });
  return doc.save();
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const trimNum = (n: number) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

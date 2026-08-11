import { NextResponse } from "next/server";
import { isStaff } from "@/lib/auth";
import { getIncomeStatement, getExpenseBreakdown, getSettings } from "@/lib/queries";
import { buildIncomeStatementPdf } from "@/lib/pdf";
import { readRange } from "@/lib/range";

/**
 * The income statement as a document, for the bookkeeper.
 *
 * The same numbers the Money screen shows, produced from the same queries — the
 * report and the screen cannot drift apart, which is a thing that quietly
 * happened when both were computed by hand in different places.
 */
export async function GET(request: Request) {
  if (!(await isStaff())) return new NextResponse("Not found", { status: 404 });

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { from, to } = readRange(params, "year");

  const [income, expenses, settings] = await Promise.all([
    getIncomeStatement(from, to),
    getExpenseBreakdown(from, to),
    getSettings(),
  ]);

  const totalIncome = income.retail + income.wholesale;
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const grossProfit = totalIncome - income.cogs;

  const notes: string[] = [];
  if (income.freight > 0) {
    notes.push(`Revenue includes ${fmt(income.freight)} of shipping charged to customers.`);
  }
  if (income.gift_cards > 0) {
    notes.push(
      `Revenue includes ${fmt(income.gift_cards)} of gift certificates sold, recorded when sold rather than when redeemed.`,
    );
  }
  if (income.skus_without_cost > 0) {
    notes.push(
      `${income.skus_without_cost} item${income.skus_without_cost === 1 ? "" : "s"} sold in this period have no unit cost recorded, so cost of goods sold is understated.`,
    );
  }
  if (income.invoices_without_lines > 0) {
    notes.push(
      `${income.invoices_without_lines} invoice${income.invoices_without_lines === 1 ? "" : "s"} have no line items recorded and contribute nothing to cost of goods sold.`,
    );
  }
  notes.push("Sales tax collected is excluded from revenue; it is money held for the state.");

  const pdf = await buildIncomeStatementPdf({
    company: settings.CompanyName || "Notion to Sew",
    start: from,
    end: to,
    retail: income.retail,
    wholesale: income.wholesale,
    freight: income.freight,
    giftCards: income.gift_cards,
    totalIncome,
    cogs: income.cogs,
    grossProfit,
    expenses: expenses.map((e) => ({ category: e.category, amount: e.amount })),
    totalExpenses,
    netProfit: grossProfit - totalExpenses,
    notes,
  });

  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="IncomeStatement_${from}_${to}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

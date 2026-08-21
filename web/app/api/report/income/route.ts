import { NextResponse } from "next/server";
import { isStaff } from "@/lib/auth";
import {
  getIncomeStatement,
  getExpenseBreakdown,
  getSettings,
  stockCategories,
  splitExpenses,
} from "@/lib/queries";
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

  const { operating, purchases, totalOperating, totalPurchases } = splitExpenses(
    expenses,
    stockCategories(settings),
  );
  const totalIncome = income.retail + income.wholesale;
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
  if (totalPurchases > 0) {
    notes.push(
      `Stock bought (${fmt(totalPurchases)}) is listed but not subtracted; it reaches profit through cost of goods as it sells.`,
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
    expenses: operating.map((e) => ({ category: e.category, amount: e.amount })),
    totalExpenses: totalOperating,
    purchases: purchases.map((e) => ({ category: e.category, amount: e.amount })),
    totalPurchases,
    netProfit: grossProfit - totalOperating,
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

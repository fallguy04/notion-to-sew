import { NextResponse } from "next/server";
import { getInvoice, getInvoiceLines, getSettings, getCustomer, payableTo, } from "@/lib/queries";
import { buildInvoicePdf } from "@/lib/pdf";
import { isStaff } from "@/lib/auth";
import { validReceiptToken } from "@/lib/receipt-token";

/**
 * The printable copy of an invoice.
 *
 * Opened in a new tab, the browser's own PDF viewer handles printing and
 * saving — no viewer to embed, no plugin, and it works the same on the iPad as
 * on the laptop. Access is either a staff session or the one-invoice token the
 * kiosk hands to the customer who just bought something.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return new NextResponse("Not found", { status: 404 });
  }

  const token = new URL(request.url).searchParams.get("t");
  const allowed = (await isStaff()) || validReceiptToken(id, token);
  if (!allowed) {
    return new NextResponse("Not found", { status: 404 });
  }

  const [invoice, lines, settings] = await Promise.all([
    getInvoice(id),
    getInvoiceLines(id),
    getSettings(),
  ]);
  if (!invoice) return new NextResponse("Not found", { status: 404 });

  const customer = invoice.customer_id ? await getCustomer(invoice.customer_id) : null;

  const pdf = await buildInvoicePdf({
    invoice,
    lines,
    company: {
      name: settings.CompanyName || "Notion to Sew",
      address: settings.Address || "",
      payableTo: payableTo(settings),
    },
    customer: {
      name: customer?.name ?? invoice.customer_name ?? "Guest",
      address: customer?.address,
      email: customer?.email,
    },
  });

  const label = invoice.status === "paid" ? "Receipt" : "Invoice";
  return new NextResponse(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      // inline so it opens in the tab's viewer rather than dropping into
      // Downloads, which on an iPad is somewhere a customer will never find.
      "Content-Disposition": `inline; filename="${label}_${id}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}

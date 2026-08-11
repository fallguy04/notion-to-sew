import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * A capability token for one invoice's PDF.
 *
 * The kiosk is a shared terminal with no login, and a customer finishing a sale
 * has to be able to print their own receipt. Requiring a staff session would
 * break that; leaving /api/invoice open would let anyone walk the invoice
 * numbers and read the shop's entire customer list. The token is derived from
 * the invoice number with the server's secret, so the kiosk can hand out a link
 * to the receipt it just created and to nothing else.
 */
const SECRET = process.env.KIOSK_SESSION_SECRET || process.env.KIOSK_ADMIN_PIN || "";

export function receiptToken(invoiceId: number): string {
  return createHmac("sha256", SECRET).update(`receipt:${invoiceId}`).digest("hex").slice(0, 24);
}

export function validReceiptToken(invoiceId: number, token: string | null): boolean {
  if (!token) return false;
  const expected = receiptToken(invoiceId);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

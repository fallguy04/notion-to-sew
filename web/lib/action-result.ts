/**
 * What every server action hands back.
 *
 * Actions never throw at the UI. A thrown error in a server action reaches the
 * browser as a generic "an error occurred" with the real message stripped in
 * production, which is precisely the experience the Streamlit app gave when a
 * save silently failed. Returning a result means the screen can say what went
 * wrong and keep the user's typing.
 */
export type ActionResult = { ok: boolean; message: string } | null;

/**
 * Text from a <textarea>, with the newlines browsers actually submit.
 *
 * The HTML spec says a textarea's value is normalised to CRLF on submit, so
 * every save of the shop address was quietly storing carriage returns that
 * nothing put there. Harmless on screen, but it means the stored value never
 * equals what was typed.
 */
export const multiline = (v: FormDataEntryValue | null) =>
  String(v ?? "").replace(/\r\n?/g, "\n").trim();

export const ok = (message = "Saved."): ActionResult => ({ ok: true, message });
export const fail = (message: string): ActionResult => ({ ok: false, message });

/** Turns whatever the database threw into something a shop owner can act on. */
export function explain(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/duplicate key.*customers_pkey/i.test(raw)) return "That customer id is already taken.";
  if (/duplicate key.*products_pkey/i.test(raw))
    return "That SKU already exists. Restock it instead of creating it again.";
  if (/violates foreign key.*invoice_lines_sku/i.test(raw))
    return "That item no longer exists in the catalogue.";
  if (/violates foreign key.*invoices_customer_id/i.test(raw))
    return "That customer no longer exists.";
  if (/update or delete on table "customers"/i.test(raw))
    return "This customer has invoices, so they can't be deleted. Their history would go with them.";
  if (/customers_credit_check/i.test(raw))
    return "That would take the customer's store credit below zero.";
  if (/check constraint "paid_has_timestamp"/i.test(raw))
    return "An invoice marked paid needs a payment date.";
  if (/fetch failed|ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(raw))
    return "Couldn't reach the database — check the internet connection and try again. Nothing was saved.";
  if (/Not signed in/i.test(raw)) return raw;
  return raw;
}

"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { ok, fail, explain, type ActionResult } from "@/lib/action-result";
import { putSecret, removeSecret, describeSecret } from "@/lib/secrets";
import { verifyMail, sendTestEmail, sendReceipt, mailConfigured } from "@/lib/mail";
import { getSettings, getInvoice, getInvoiceLines, getCustomer, payableTo, } from "@/lib/queries";
import { buildInvoicePdf } from "@/lib/pdf";
import { money } from "@/lib/format";

/**
 * The sending account, set from inside the app.
 *
 * The password is written and never read back — the form can only replace it,
 * and the screen shows a fingerprint rather than the value. That way the one
 * place it exists in plain text is Google's own settings page.
 */
export async function saveMailAccountAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const user = String(form.get("smtp_user") ?? "").trim();
    const pass = String(form.get("smtp_pass") ?? "").trim();
    const from = String(form.get("smtp_from") ?? "").trim();

    if (!user) return fail("Enter the Gmail address that should send receipts.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) return fail("That doesn't look like an email address.");
    if (from && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
      return fail("The reply-to address doesn't look like an email address.");
    }

    await putSecret("smtp_user", user);
    if (from) await putSecret("smtp_from", from);
    else await removeSecret("smtp_from");

    // An empty password field means "leave the stored one alone", so the
    // address can be corrected without retyping a 16-character code.
    if (pass) {
      const cleaned = pass.replace(/\s+/g, "");
      if (cleaned.length < 8) {
        return fail("That app password looks too short — Google's are 16 characters.");
      }
      await putSecret("smtp_pass", cleaned);
    }

    const check = await verifyMail();
    revalidatePath("/admin/settings");
    revalidatePath("/kiosk");
    return check.ok
      ? ok(`Saved. ${check.message}`)
      : fail(`Saved, but signing in failed: ${check.message}`);
  } catch (e) {
    return fail(explain(e));
  }
}

/** The Resend side: an API key, a verified from-address, and a webhook secret. */
export async function saveResendAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const from = String(form.get("resend_from") ?? "").trim();
    const key = String(form.get("resend_api_key") ?? "").trim();
    const hook = String(form.get("resend_webhook_secret") ?? "").trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from)) {
      return fail("Enter the address on your own domain that receipts should come from.");
    }
    if (key && !key.startsWith("re_")) return fail("A Resend API key starts with “re_”.");
    if (hook && !hook.startsWith("whsec_")) {
      return fail("A Resend signing secret starts with “whsec_”.");
    }

    await putSecret("resend_from", from);
    if (key) await putSecret("resend_api_key", key);
    if (hook) await putSecret("resend_webhook_secret", hook);

    const check = await verifyMail();
    revalidatePath("/admin/settings");
    revalidatePath("/kiosk");
    if (!check.ok) return fail(`Saved, but the check failed: ${check.message}`);
    return ok(
      hook || (await describeSecret("resend_webhook_secret"))
        ? `Saved. ${check.message} Delivery reports and replies are on.`
        : `Saved. ${check.message} Add the webhook secret to get delivery reports and replies.`,
    );
  } catch (e) {
    return fail(explain(e));
  }
}

export async function clearMailAccountAction(): Promise<ActionResult> {
  try {
    await requireStaff();
    await Promise.all([
      removeSecret("smtp_user"),
      removeSecret("smtp_pass"),
      removeSecret("smtp_from"),
      removeSecret("resend_api_key"),
      removeSecret("resend_from"),
      removeSecret("resend_webhook_secret"),
    ]);
    revalidatePath("/admin/settings");
    revalidatePath("/kiosk");
    return ok("Sending account removed. Email buttons will say it isn't set up.");
  } catch (e) {
    return fail(explain(e));
  }
}

export async function testConnectionAction(): Promise<ActionResult> {
  try {
    await requireStaff();
    const res = await verifyMail();
    return res.ok ? ok(res.message) : fail(res.message);
  } catch (e) {
    return fail(explain(e));
  }
}

export async function sendTestEmailAction(
  _prev: ActionResult,
  form: FormData,
): Promise<ActionResult> {
  try {
    await requireStaff();
    const to = String(form.get("to") ?? "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return fail("Enter an address to send it to.");
    const settings = await getSettings();
    const res = await sendTestEmail(to, settings.CompanyName || "Notion to Sew");
    revalidatePath("/admin/settings");
    return res.ok ? ok(res.message) : fail(res.message);
  } catch (e) {
    return fail(explain(e));
  }
}

/** Try a failed send again, to the same address, from the log. */
export async function resendAction(logId: number): Promise<ActionResult> {
  try {
    await requireStaff();
    if (!(await mailConfigured())) {
      return fail("No sending account is set up yet.");
    }
    const { sql } = await import("@/lib/db");
    const rows = (await sql`
      SELECT to_address, invoice_id FROM email_log WHERE id = ${logId}`) as {
      to_address: string;
      invoice_id: number | null;
    }[];
    const entry = rows[0];
    if (!entry) return fail("That log entry is gone.");
    if (!entry.invoice_id) return fail("That message wasn't about an invoice, so there's nothing to resend.");

    const [invoice, lines, settings] = await Promise.all([
      getInvoice(entry.invoice_id),
      getInvoiceLines(entry.invoice_id),
      getSettings(),
    ]);
    if (!invoice) return fail("That invoice no longer exists.");
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

    await sendReceipt({
      to: entry.to_address,
      invoiceId: invoice.id,
      pdf,
      companyName: settings.CompanyName || "Notion to Sew",
      total: money(invoice.total),
      paid: invoice.status === "paid",
      source: "admin",
    });
    revalidatePath("/admin/settings");
    return ok(`Sent again to ${entry.to_address}.`);
  } catch (e) {
    return fail(explain(e));
  }
}

/** Marks a reply as dealt with. */
export async function markReplyReadAction(id: number, read: boolean): Promise<ActionResult> {
  try {
    await requireStaff();
    const { sql } = await import("@/lib/db");
    await sql`UPDATE email_replies SET read_at = ${read ? new Date().toISOString() : null}
               WHERE id = ${id}`;
    revalidatePath("/admin/settings");
    revalidatePath("/admin");
    return ok(read ? "Marked as read." : "Marked as unread.");
  } catch (e) {
    return fail(explain(e));
  }
}

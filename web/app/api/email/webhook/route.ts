import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSecret } from "@/lib/secrets";
import { verifySvix } from "@/lib/webhook";

/**
 * What happened to the mail we sent, and anything sent back.
 *
 * Resend posts here as each message is delivered, opened or bounced, and again
 * when a customer replies. The endpoint is public by necessity, so the
 * signature is the only thing standing between it and anyone who can guess the
 * URL — an unsigned or stale request is refused before a single row is read.
 *
 * It always answers 200 once the signature checks out, even when the event is
 * one it does nothing with. A webhook that returns errors for events it simply
 * ignores gets retried forever and eventually disabled.
 */

type ResendEvent = {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string | { address?: string; name?: string };
    to?: string[] | string;
    subject?: string;
    bounce?: { message?: string; subType?: string };
    failed?: { reason?: string };
    attachments?: unknown[];
  };
};

export async function POST(request: Request) {
  // The raw bytes, because the signature covers exactly what was sent. Parsing
  // and re-serialising would reorder keys and never match again.
  const body = await request.text();

  const secret =
    (await getSecret("resend_webhook_secret")) ?? process.env.RESEND_WEBHOOK_SECRET ?? "";

  const check = verifySvix({
    secret,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body,
  });
  if (!check.ok) {
    console.warn("[email webhook] refused:", check.reason);
    return new NextResponse("Not found", { status: 404 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const id = event.data?.email_id;
  const at = event.created_at ?? new Date().toISOString();

  try {
    switch (event.type) {
      case "email.delivered":
        if (id) {
          await sql`UPDATE email_log SET delivered_at = ${at}
                     WHERE message_id = ${id} AND delivered_at IS NULL`;
        }
        break;

      case "email.opened":
        if (id) {
          await sql`UPDATE email_log SET opened_at = ${at}
                     WHERE message_id = ${id} AND opened_at IS NULL`;
        }
        break;

      case "email.bounced":
      case "email.failed":
      case "email.complained": {
        const reason =
          event.data?.bounce?.message ??
          event.data?.failed?.reason ??
          (event.type === "email.complained" ? "Marked as spam by the recipient" : event.type);
        if (id) {
          await sql`UPDATE email_log
                       SET bounced_at = ${at}, failure_reason = ${reason}
                     WHERE message_id = ${id}`;
        }
        break;
      }

      case "email.received":
        await storeReply(event, at);
        break;

      default:
        // sent, scheduled, delivery_delayed, clicked, domain.*, contact.* …
        break;
    }
  } catch (e) {
    // Tell Resend to try again — but only for our own failures, never for a
    // request we already decided to ignore.
    console.error("[email webhook] handling failed:", e);
    return new NextResponse("retry later", { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * A reply, filed against whoever sent it.
 *
 * Both links are guesses made politely: the address is matched to a customer,
 * and an invoice number is read out of the subject line. An unmatched reply is
 * still stored and still shown — losing a customer's message because we
 * couldn't place it would be worse than showing it unattached.
 */
async function storeReply(event: ResendEvent, at: string) {
  const raw = event.data?.from;
  const address = (typeof raw === "string" ? extractAddress(raw) : raw?.address) ?? "";
  if (!address) return;
  const name = typeof raw === "string" ? extractName(raw) : (raw?.name ?? null);
  const subject = event.data?.subject ?? null;

  const invoiceId = subject ? Number(/No\.\s*(\d{1,10})/i.exec(subject)?.[1] ?? NaN) : NaN;

  // The webhook carries metadata only; what they actually wrote takes a second
  // call. Best-effort — a reply with no body is still worth knowing about.
  const body = await fetchReplyBody(event.data?.email_id);

  await sql`
    INSERT INTO email_replies (received_at, provider_id, from_address, from_name, subject,
                               body, attachments, customer_id, invoice_id)
    VALUES (
      ${at},
      ${event.data?.email_id ?? null},
      ${address},
      ${name},
      ${subject},
      ${body},
      ${Array.isArray(event.data?.attachments) ? event.data.attachments.length : 0},
      (SELECT id FROM customers WHERE lower(email) = lower(${address}) LIMIT 1),
      ${Number.isFinite(invoiceId) ? invoiceId : null}
    )
    ON CONFLICT (provider_id) DO NOTHING`;
}

/** GET /emails/receiving/{id} — the only place the reply text lives. */
async function fetchReplyBody(emailId: string | undefined): Promise<string | null> {
  if (!emailId) return null;
  const key = (await getSecret("resend_api_key")) ?? process.env.RESEND_API_KEY ?? "";
  if (!key) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { text?: string; html?: string };
    const text = body.text ?? stripTags(body.html ?? "");
    // Long enough to read the message, short enough that a pasted thread
    // doesn't fill the page.
    return text ? text.slice(0, 4000) : null;
  } catch {
    return null;
  }
}

const stripTags = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const extractAddress = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim();
const extractName = (s: string) => {
  const m = /^\s*"?([^"<]+?)"?\s*</.exec(s);
  return m ? m[1].trim() : null;
};

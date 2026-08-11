import "server-only";
import nodemailer from "nodemailer";
import { sql } from "./db";
import { getSecret } from "./secrets";

/**
 * Sending receipts, through whichever of two routes is set up.
 *
 * **Gmail** is the simple one: an app password, and mail goes out from the
 * shop's own address. What it cannot tell you is whether anything arrived —
 * SMTP hands the message to Google and the story ends there.
 *
 * **Resend** is an API that reports back. Every message raises webhooks as it
 * is delivered, opened, or bounced, and it can receive replies too. It needs a
 * domain of the shop's own, which Gmail does not.
 *
 * Both are first-class. If a Resend key is configured it wins, because it can
 * do strictly more; otherwise Gmail carries on exactly as before.
 */

export type Sender =
  | { kind: "resend"; apiKey: string; from: string; replyTo: string | null }
  | {
      kind: "smtp";
      user: string;
      pass: string;
      from: string;
      replyTo: string | null;
      host: string;
      port: number;
    };

export async function mailSender(): Promise<Sender | null> {
  const apiKey = (await getSecret("resend_api_key")) ?? process.env.RESEND_API_KEY ?? "";
  const replyTo = (await getSecret("smtp_from")) || process.env.SMTP_FROM || null;

  if (apiKey) {
    const from = (await getSecret("resend_from")) || process.env.RESEND_FROM || "";
    if (from) return { kind: "resend", apiKey, from, replyTo };
  }

  const user = (await getSecret("smtp_user")) ?? process.env.SMTP_USER ?? "";
  const pass = (await getSecret("smtp_pass")) ?? process.env.SMTP_PASS ?? "";
  if (!user || !pass) return null;
  return {
    kind: "smtp",
    user,
    pass,
    from: user,
    replyTo: replyTo && replyTo !== user ? replyTo : null,
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
  };
}

export async function mailConfigured(): Promise<boolean> {
  return (await mailSender()) !== null;
}

/** Whether delivery reports are possible at all — only Resend can answer that. */
export async function tracksDelivery(): Promise<boolean> {
  return (await mailSender())?.kind === "resend";
}

type Message = {
  to: string;
  subject: string;
  text: string;
  attachment?: { filename: string; content: Uint8Array };
  companyName: string;
};

async function deliver(sender: Sender, msg: Message): Promise<string | null> {
  if (sender.kind === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sender.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${msg.companyName} <${sender.from}>`,
        to: [msg.to],
        ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
        subject: msg.subject,
        text: msg.text,
        ...(msg.attachment
          ? {
              attachments: [
                {
                  filename: msg.attachment.filename,
                  content: Buffer.from(msg.attachment.content).toString("base64"),
                },
              ],
            }
          : {}),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new Error(body.message ?? `Resend returned ${res.status}`);
    return body.id ?? null;
  }

  const info = await nodemailer
    .createTransport({
      host: sender.host,
      port: sender.port,
      // 465 is implicit TLS; 587 and friends start plain and upgrade. Hardcoding
      // `true` meant the only working configuration was the default one.
      secure: sender.port === 465,
      auth: { user: sender.user, pass: sender.pass },
    })
    .sendMail({
      from: `"${msg.companyName}" <${sender.from}>`,
      to: msg.to,
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      subject: msg.subject,
      text: msg.text,
      attachments: msg.attachment
        ? [
            {
              filename: msg.attachment.filename,
              content: Buffer.from(msg.attachment.content),
              contentType: "application/pdf",
            },
          ]
        : [],
    });
  return info.messageId ?? null;
}

export type LogEntry = {
  to: string;
  subject: string;
  kind: "receipt" | "invoice" | "test";
  source: "admin" | "kiosk" | "settings";
  invoiceId?: number | null;
  status: "sent" | "failed";
  messageId?: string | null;
  provider?: string;
  error?: string | null;
};

async function log(entry: LogEntry) {
  try {
    await sql`
      INSERT INTO email_log (to_address, subject, kind, source, invoice_id, status,
                             message_id, provider, error)
      VALUES (${entry.to}, ${entry.subject}, ${entry.kind}, ${entry.source},
              ${entry.invoiceId ?? null}, ${entry.status}, ${entry.messageId ?? null},
              ${entry.provider ?? "smtp"}, ${entry.error ?? null})`;
  } catch {
    // A failure to write the log must never turn a successful send into a
    // failed one. The email is the thing that matters.
  }
}

export async function sendReceipt(opts: {
  to: string;
  invoiceId: number;
  pdf: Uint8Array;
  companyName: string;
  total: string;
  paid: boolean;
  source: "admin" | "kiosk";
}) {
  const sender = await mailSender();
  const noun = opts.paid ? "receipt" : "invoice";
  const subject = `Your ${noun} from ${opts.companyName} — No. ${opts.invoiceId}`;

  if (!sender) {
    await log({
      to: opts.to, subject, kind: noun, source: opts.source, invoiceId: opts.invoiceId,
      status: "failed", error: "No sending account is set up.",
    });
    throw new Error(
      "Email isn't set up yet. Add the sending account under Settings before sending receipts.",
    );
  }

  const text = [
    `Hello,`,
    ``,
    opts.paid
      ? `Thank you for shopping at ${opts.companyName}. Your receipt for order ${opts.invoiceId} (${opts.total}) is attached.`
      : `Attached is invoice ${opts.invoiceId} from ${opts.companyName} for ${opts.total}.`,
    ``,
    `Questions? Just reply to this email.`,
    ``,
    `— ${opts.companyName}`,
  ].join("\n");

  try {
    const messageId = await deliver(sender, {
      to: opts.to,
      subject,
      text,
      companyName: opts.companyName,
      attachment: {
        filename: `${opts.paid ? "Receipt" : "Invoice"}_${opts.invoiceId}.pdf`,
        content: opts.pdf,
      },
    });
    await log({
      to: opts.to, subject, kind: noun, source: opts.source, invoiceId: opts.invoiceId,
      status: "sent", messageId, provider: sender.kind,
    });
    return { messageId };
  } catch (e) {
    await log({
      to: opts.to, subject, kind: noun, source: opts.source, invoiceId: opts.invoiceId,
      status: "failed", provider: sender.kind,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** Proves the credentials work before they matter, without sending anything. */
export async function verifyMail() {
  const sender = await mailSender();
  if (!sender) return { ok: false, message: "No sending account is set up yet." };

  if (sender.kind === "resend") {
    try {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${sender.apiKey}` },
      });
      if (!res.ok) {
        return { ok: false, message: `Resend rejected the API key (${res.status}).` };
      }
      const body = (await res.json()) as { data?: { name: string; status: string }[] };
      const domain = sender.from.split("@")[1];
      const match = body.data?.find((d) => domain?.endsWith(d.name));
      if (!match) {
        return {
          ok: false,
          message: `The key works, but ${domain} isn't a verified domain on this Resend account.`,
        };
      }
      if (match.status !== "verified") {
        return { ok: false, message: `${match.name} is still ${match.status} at Resend.` };
      }
      return { ok: true, message: `Resend is ready, sending as ${sender.from}.` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }

  try {
    await nodemailer
      .createTransport({
        host: sender.host,
        port: sender.port,
        secure: sender.port === 465,
        auth: { user: sender.user, pass: sender.pass },
      })
      .verify();
    return { ok: true, message: `Signed in as ${sender.user}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** A real message to a real address, so the shop can see one arrive. */
export async function sendTestEmail(to: string, companyName: string) {
  const sender = await mailSender();
  const subject = `Test message from ${companyName}`;
  if (!sender) {
    await log({ to, subject, kind: "test", source: "settings", status: "failed",
      error: "No sending account is set up." });
    return { ok: false, message: "No sending account is set up yet." };
  }
  try {
    const messageId = await deliver(sender, {
      to, subject, companyName,
      text:
        `This is a test from ${companyName}'s till.\n\n` +
        `If you're reading it, receipts and invoices will send too.\n`,
    });
    await log({ to, subject, kind: "test", source: "settings", status: "sent",
      messageId, provider: sender.kind });
    return { ok: true, message: `Sent to ${to}. Check that it arrives.` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await log({ to, subject, kind: "test", source: "settings", status: "failed",
      provider: sender.kind, error: message });
    return { ok: false, message };
  }
}

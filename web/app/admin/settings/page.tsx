import Link from "next/link";
import { headers } from "next/headers";
import {
  getSettings,
  getTaxRate,
  getInvoiceNumbering,
  getEmailLog,
  getEmailCounts,
  getReplies,
  expenseCategories,
  type EmailLogRow,
} from "@/lib/queries";
import { mailSender } from "@/lib/mail";
import { describeSecret } from "@/lib/secrets";
import { dateTime } from "@/lib/format";
import { Card, CardHead, PageHead, Note, Empty } from "@/components/ui";
import ActionButton from "@/components/action-button";
import SettingsForm from "./settings-form";
import EmailForm from "./email-form";
import { tidySequenceAction } from "./actions";
import { resendAction, markReplyReadAction } from "./email-actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, rate, numbering, sender, passInfo, keyInfo, hookInfo, log, counts, replies] =
    await Promise.all([
      getSettings(),
      getTaxRate(),
      getInvoiceNumbering(),
      mailSender(),
      describeSecret("smtp_pass"),
      describeSecret("resend_api_key"),
      describeSecret("resend_webhook_secret"),
      getEmailLog(50),
      getEmailCounts(),
      getReplies(20),
    ]);

  const host = (await headers()).get("host") ?? "your-site.vercel.app";
  const proto = (await headers()).get("x-forwarded-proto") ?? "https";

  return (
    <>
      <PageHead title="Settings" hint="Shop details, tax and the plumbing." />

      <SettingsForm
        settings={settings}
        ratePct={(rate * 100).toFixed(3).replace(/\.?0+$/, "")}
        categories={expenseCategories(settings).join(", ")}
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHead
            title="Invoice numbers"
            hint="Handed out by the database, one at a time."
          />
          <div className="px-5 py-5">
            <div className="flex items-baseline gap-6">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  Highest issued
                </div>
                <div className="tabular font-display mt-1 text-[22px] font-semibold">
                  {numbering.highest || "—"}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  Next will be
                </div>
                <div className="tabular font-display mt-1 text-[22px] font-semibold">
                  {numbering.sequence_at + 1}
                </div>
              </div>
            </div>

            <p className="mt-4 text-[13.5px] leading-relaxed text-ink-soft">
              A number is only used once the sale is actually written, so a failed save no longer
              burns one. That was the fault behind the six sales that vanished from the old
              system.
            </p>

            {numbering.gap > 0 && (
              <div className="mt-4">
                <Note tone="info">
                  There&apos;s a gap of {numbering.gap} unused number
                  {numbering.gap === 1 ? "" : "s"} between the last invoice and the next one.
                  Harmless, but you can close it.
                </Note>
                <div className="mt-3">
                  <ActionButton
                    action={tidySequenceAction}
                    className="btn btn-ghost btn-sm"
                    confirm={{
                      title: "Close the numbering gap?",
                      body: `The next invoice would become number ${numbering.highest + 1} instead of ${numbering.sequence_at + 1}. Existing invoices are untouched.`,
                      verb: "Close the gap",
                    }}
                  >
                    Close the gap
                  </ActionButton>
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHead
            title="Emailing receipts"
            hint="Sent through Gmail from the shop's own address."
          />
          <EmailForm
            kind={sender?.kind ?? null}
            gmailUser={sender?.kind === "smtp" ? sender.user : ""}
            resendFrom={sender?.kind === "resend" ? sender.from : ""}
            replyTo={sender?.replyTo ?? ""}
            passHint={passInfo?.hint ?? null}
            keyHint={keyInfo?.hint ?? null}
            webhookHint={hookInfo?.hint ?? null}
            webhookUrl={`${proto}://${host}/api/email/webhook`}
          />
        </Card>
      </div>

      <Card className="mt-5">
        <CardHead
          title="Sent mail"
          hint={
            counts.total === 0
              ? "Every receipt and invoice this app sends is recorded here."
              : `${counts.total} message${counts.total === 1 ? "" : "s"} · ${counts.last_30} in the last 30 days${
                  counts.failed > 0 ? ` · ${counts.failed} failed` : ""
                }`
          }
        />
        {log.length === 0 ? (
          <div className="p-5">
            <Empty
              title="Nothing sent yet"
              hint="Receipts emailed from the till or the kiosk will appear here, whether they succeeded or not."
            />
          </div>
        ) : (
          <div className="overflow-x-auto px-2 py-3">
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>To</th>
                  <th>About</th>
                  <th>Where from</th>
                  <th>Result</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {log.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap text-ink-soft">{dateTime(e.sent_at)}</td>
                    <td className="max-w-[220px] truncate">{e.to_address}</td>
                    <td>
                      {e.invoice_id ? (
                        <Link
                          href={`/admin/invoices/${e.invoice_id}`}
                          className="font-medium hover:text-spruce"
                        >
                          #{e.invoice_id}
                        </Link>
                      ) : (
                        <span className="text-ink-faint capitalize">{e.kind}</span>
                      )}
                    </td>
                    <td className="capitalize text-ink-faint">{e.source}</td>
                    <td>
                      <DeliveryPill entry={e} />
                    </td>
                    <td className="num">
                      {e.status === "failed" && e.invoice_id && (
                        <ActionButton
                          action={resendAction.bind(null, e.id)}
                          className="btn btn-quiet btn-sm"
                        >
                          Try again
                        </ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-3 pb-1 pt-3 text-[12.5px] leading-relaxed text-ink-faint">
              {sender?.kind === "resend"
                ? "Hover a message to see what the mail server said. Delivered and Opened come back from Resend."
                : "Gmail can only confirm a message left — “Sent” here does not mean it arrived. Switch to the other option above for delivery reports."}
            </p>
          </div>
        )}
      </Card>

      <Card className="mt-5">
        <CardHead
          title="Replies"
          hint={
            sender?.kind === "resend"
              ? "What customers wrote back, matched to their account where possible."
              : "Needs the delivery-reports option above — Gmail replies stay in Gmail."
          }
        />
        {replies.length === 0 ? (
          <div className="p-5">
            <Empty
              title="No replies yet"
              hint={
                sender?.kind === "resend"
                  ? "Anything a customer sends back to a receipt will appear here."
                  : "Set up the delivery-reports option and point its webhook at this app, and replies will land here."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line-soft">
            {replies.map((r) => (
              <li key={r.id} className={`px-5 py-4 ${r.read_at ? "" : "bg-amber-light/30"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[15px] font-medium">
                    {r.customer_id ? (
                      <Link href={`/admin/customers/${r.customer_id}`} className="hover:text-spruce">
                        {r.customer_name ?? r.from_name ?? r.from_address}
                      </Link>
                    ) : (
                      (r.from_name ?? r.from_address)
                    )}
                    {!r.read_at && <span className="pill pill-due ml-2">New</span>}
                  </span>
                  <span className="text-[12.5px] text-ink-faint">{dateTime(r.received_at)}</span>
                </div>
                <div className="mt-0.5 text-[13px] text-ink-faint">
                  {r.from_address}
                  {r.invoice_id && (
                    <>
                      {" · "}
                      <Link href={`/admin/invoices/${r.invoice_id}`} className="hover:text-spruce">
                        invoice #{r.invoice_id}
                      </Link>
                    </>
                  )}
                  {r.attachments > 0 && ` · ${r.attachments} attachment${r.attachments === 1 ? "" : "s"}`}
                </div>
                {r.subject && <div className="mt-2 text-[14px] font-medium">{r.subject}</div>}
                {r.body && (
                  <p className="select-ok mt-1 whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink-soft">
                    {r.body.length > 600 ? `${r.body.slice(0, 600)}…` : r.body}
                  </p>
                )}
                <div className="mt-2 flex gap-2">
                  <ActionButton
                    action={markReplyReadAction.bind(null, r.id, !r.read_at)}
                    className="btn btn-quiet btn-sm"
                  >
                    {r.read_at ? "Mark unread" : "Mark read"}
                  </ActionButton>
                  <a
                    href={`mailto:${r.from_address}?subject=${encodeURIComponent(`Re: ${r.subject ?? ""}`)}`}
                    className="btn btn-quiet btn-sm"
                  >
                    Reply
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-5">
        <CardHead title="The kiosk" hint="What customers see on the iPad." />
        <div className="px-5 py-5 text-[14px] leading-relaxed text-ink-soft">
          <p>
            The kiosk opens automatically on the iPad. On any other device you get the chooser
            first, and the admin side asks for the PIN.
          </p>
          <p className="mt-3">
            From the kiosk itself, <strong>tap the shop&apos;s name three times</strong> to get
            back here. Holding the faint dot in the bottom-right corner works too.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <a href="/kiosk" className="btn btn-ghost btn-sm" target="_blank" rel="noopener">
              Open the kiosk
            </a>
            <a href="/?choose=1" className="btn btn-quiet btn-sm" target="_blank" rel="noopener">
              Open the chooser
            </a>
          </div>
        </div>
      </Card>
    </>
  );
}

/**
 * What actually happened to a message.
 *
 * "Sent" is deliberately the weakest word here: over SMTP it is all anyone can
 * honestly claim. Delivered and Opened only ever appear when a provider told
 * us so.
 */
function DeliveryPill({ entry }: { entry: EmailLogRow }) {
  if (entry.bounced_at) {
    return (
      <span className="pill pill-late" title={entry.failure_reason ?? undefined}>
        Bounced
      </span>
    );
  }
  if (entry.status === "failed") {
    return (
      <span className="pill pill-late" title={entry.error ?? undefined}>
        Failed
      </span>
    );
  }
  if (entry.opened_at) {
    return (
      <span className="pill pill-paid" title={`Opened ${dateTime(entry.opened_at)}`}>
        Opened
      </span>
    );
  }
  if (entry.delivered_at) {
    return (
      <span className="pill pill-paid" title={`Delivered ${dateTime(entry.delivered_at)}`}>
        Delivered
      </span>
    );
  }
  return (
    <span
      className="pill pill-quiet"
      title={entry.provider === "smtp" ? "Gmail can't report whether it arrived" : "Waiting on the delivery report"}
    >
      Sent
    </span>
  );
}

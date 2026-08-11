"use client";

import { useActionState, useState } from "react";
import { Field, Note } from "@/components/ui";
import { Submit, Result } from "@/components/form";
import ActionButton from "@/components/action-button";
import {
  saveMailAccountAction,
  saveResendAction,
  clearMailAccountAction,
  testConnectionAction,
  sendTestEmailAction,
} from "./email-actions";

type Kind = "resend" | "smtp" | null;

export default function EmailForm({
  kind,
  gmailUser,
  resendFrom,
  replyTo,
  passHint,
  keyHint,
  webhookHint,
  webhookUrl,
}: {
  kind: Kind;
  gmailUser: string;
  resendFrom: string;
  replyTo: string;
  passHint: string | null;
  keyHint: string | null;
  webhookHint: string | null;
  webhookUrl: string;
}) {
  const [tab, setTab] = useState<"resend" | "smtp">(kind === "resend" ? "resend" : "smtp");
  const [gmailResult, saveGmail] = useActionState(saveMailAccountAction, null);
  const [resendResult, saveResend] = useActionState(saveResendAction, null);
  const [testResult, test] = useActionState(sendTestEmailAction, null);
  // Open from the start for anyone who hasn't set this up — the whole point is
  // that a first-timer shouldn't have to know to go looking for it.
  const [showHelp, setShowHelp] = useState(kind === null);

  return (
    <div className="px-5 py-5">
      {kind === null && (
        <div className="mb-4">
          <Note tone="warn">
            Not set up yet, so every Email button says so plainly instead of failing in front of a
            customer.
          </Note>
        </div>
      )}
      {kind === "smtp" && (
        <div className="mb-4">
          <Note tone="info">
            Sending through Gmail. Mail goes out, but Gmail can&apos;t tell you whether it arrived —
            for delivery reports and replies, set up the other option.
          </Note>
        </div>
      )}

      <div className="mb-5 flex gap-1 rounded-xl border border-line bg-paper p-1">
        {(
          [
            ["smtp", "Gmail"],
            ["resend", "Delivery reports & replies"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`tap flex-1 rounded-lg px-3 py-2 text-[13.5px] font-medium ${
              tab === k ? "bg-surface text-ink shadow-[var(--shadow-lift)]" : "text-ink-faint"
            }`}
          >
            {label}
            {kind === k && <span className="ml-1.5 text-spruce">·</span>}
          </button>
        ))}
      </div>

      {tab === "smtp" ? (
        <>
          <form action={saveGmail} className="flex flex-col gap-3.5">
            <Field label="Send from" hint="The Gmail address receipts go out from.">
              <input
                name="smtp_user"
                type="email"
                defaultValue={gmailUser}
                placeholder="shop@gmail.com"
                autoComplete="off"
                required
                className="field"
              />
            </Field>

            <Field
              label="App password"
              hint={
                passHint
                  ? `One is stored — ${passHint}. Leave blank to keep it.`
                  : "16 characters from Google. Not your Gmail password."
              }
            >
              <input
                name="smtp_pass"
                type="password"
                placeholder={passHint ? "•••• •••• •••• ••••" : "abcd efgh ijkl mnop"}
                autoComplete="new-password"
                spellCheck={false}
                className="field"
              />
            </Field>

            <Field label="Reply-to" hint="Optional. Leave blank to use the sending address.">
              <input
                name="smtp_from"
                type="email"
                defaultValue={replyTo}
                placeholder="hello@notiontosew.com"
                autoComplete="off"
                className="field"
              />
            </Field>

            <Result result={gmailResult} />

            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setShowHelp((v) => !v)}
                className="btn btn-quiet btn-sm"
              >
                {showHelp ? "Hide" : "Where do I get an app password?"}
              </button>
              <Submit pendingLabel="Checking…">Save &amp; sign in</Submit>
            </div>
          </form>

          {showHelp && (
            <div className="rise mt-4 rounded-xl border border-line-soft bg-paper/60 p-4 text-[13.5px] leading-relaxed text-ink-soft">
              <p className="text-[14px] font-medium text-ink">
                Getting an app password from Google
              </p>
              <p className="mt-1.5">
                This is <em>not</em> your Gmail password — typing that one here won&apos;t work.
                It&apos;s a separate 16-character code that can only send mail. It can&apos;t read
                your inbox and it can&apos;t sign in to your account.
              </p>

              <ol className="mt-3 space-y-3">
                <li>
                  <span className="font-medium text-ink">1. Turn on 2-Step Verification.</span>{" "}
                  Google won&apos;t offer app passwords without it — this is the step people get
                  stuck on.
                  <br />
                  <a
                    href="https://myaccount.google.com/signinoptions/twosv"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-spruce underline"
                  >
                    myaccount.google.com/signinoptions/twosv
                  </a>
                  <br />
                  <span className="text-ink-faint">
                    Skip if it&apos;s already on. Check you&apos;re signed in as the account the
                    shop sends from, not a personal one.
                  </span>
                </li>

                <li>
                  <span className="font-medium text-ink">2. Create the password.</span>
                  <br />
                  <a
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-spruce underline"
                  >
                    myaccount.google.com/apppasswords
                  </a>
                  <br />
                  <span className="text-ink-faint">
                    Type a name you&apos;ll recognise later — “Notion to Sew” — and press Create.
                  </span>
                </li>

                <li>
                  <span className="font-medium text-ink">3. Copy what it shows you.</span>
                  <br />
                  <span className="text-ink-faint">
                    16 characters in four groups, like{" "}
                    <code className="select-ok">abcd efgh ijkl mnop</code>. Paste it in the box
                    above — the spaces don&apos;t matter. Google only shows it once, so if it gets
                    lost, delete that one and make another.
                  </span>
                </li>
              </ol>

              <p className="mt-3 border-t border-line-soft pt-3">
                <span className="font-medium text-ink">
                  If Google says app passwords aren&apos;t available:
                </span>{" "}
                2-Step Verification hasn&apos;t finished turning on, or the account belongs to an
                organisation whose administrator has switched them off.
              </p>
              <p className="mt-2">
                You can revoke it any time on that same page, without changing your Gmail password
                or affecting anything else.
              </p>
            </div>
          )}
        </>
      ) : (
        <form action={saveResend} className="flex flex-col gap-3.5">
          <div className="rounded-xl border border-line-soft bg-paper/60 p-4 text-[13.5px] leading-relaxed text-ink-soft">
            <p className="font-medium text-ink">This is the one that answers your question.</p>
            <p className="mt-1.5">
              Resend reports back on every message — delivered, opened, or bounced — and can pass
              replies into this app. Free for 3,000 messages a month, which is far more than the
              shop sends.
            </p>
            <p className="mt-2">
              It needs a domain of your own, because mail claiming to come from a gmail.com address
              through somebody else&apos;s server lands in spam. A domain is about $12 a year.
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-4">
              <li>Buy a domain and add it at resend.com → Domains, then add the DNS records it asks for.</li>
              <li>Create an API key and paste it below.</li>
              <li>
                Add a webhook pointing at{" "}
                <code className="select-ok break-all text-[12px]">{webhookUrl}</code> and paste its
                signing secret below.
              </li>
            </ol>
          </div>

          <Field label="Send from" hint="An address on your verified domain.">
            <input
              name="resend_from"
              type="email"
              defaultValue={resendFrom}
              placeholder="receipts@notiontosew.com"
              autoComplete="off"
              required
              className="field"
            />
          </Field>

          <Field
            label="API key"
            hint={keyHint ? `One is stored — ${keyHint}. Leave blank to keep it.` : "Starts with re_"}
          >
            <input
              name="resend_api_key"
              type="password"
              placeholder={keyHint ? "••••••••••••" : "re_..."}
              autoComplete="new-password"
              spellCheck={false}
              className="field"
            />
          </Field>

          <Field
            label="Webhook signing secret"
            hint={
              webhookHint
                ? `One is stored — ${webhookHint}. Without it, delivery reports and replies are refused.`
                : "Starts with whsec_. Without it, delivery reports and replies are refused."
            }
          >
            <input
              name="resend_webhook_secret"
              type="password"
              placeholder={webhookHint ? "••••••••••••" : "whsec_..."}
              autoComplete="new-password"
              spellCheck={false}
              className="field"
            />
          </Field>

          <Result result={resendResult} />

          <div className="mt-1 flex justify-end">
            <Submit pendingLabel="Checking…">Save &amp; check</Submit>
          </div>
        </form>
      )}

      {kind && (
        <div className="mt-5 border-t border-line-soft pt-5">
          <form action={test} className="flex flex-wrap items-end gap-2">
            <Field label="Send a test message" className="min-w-[220px] flex-1">
              <input
                name="to"
                type="email"
                placeholder="you@example.com"
                autoComplete="off"
                className="field"
              />
            </Field>
            <Submit className="btn btn-ghost" pendingLabel="Sending…">
              Send test
            </Submit>
          </form>
          <Result result={testResult} />

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <ActionButton action={testConnectionAction} className="btn btn-quiet btn-sm">
              Test the connection
            </ActionButton>
            <ActionButton
              action={clearMailAccountAction}
              className="btn btn-quiet btn-sm text-ink-faint hover:text-clay"
              confirm={{
                title: "Remove the sending account?",
                body: "Receipts and invoices stop sending until a new one is set up. Anything stored here is deleted; revoke it at Google or Resend too if it's no longer needed.",
                verb: "Remove it",
                danger: true,
              }}
            >
              Remove
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

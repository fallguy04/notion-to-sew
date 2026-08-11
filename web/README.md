# Notion to Sew — web

The shop's kiosk and back office. Next.js on Vercel, Postgres on Neon.

## Running it

```bash
npm install
cp .env.example .env.local   # then fill in DATABASE_URL, KIOSK_ADMIN_PIN, KIOSK_SESSION_SECRET
npm run dev
```

`npm run build` type-checks and builds; `npx eslint .` lints.

> **The database is the live shop.** There is no staging copy. Browsing is
> safe; completing a checkout, saving a bulk edit or deleting an invoice writes
> to the real books. If you need to exercise the write paths, run them inside a
> transaction that you abort — see "Verifying" below.

## How it fits together

| Path | What it is |
| --- | --- |
| `/` | Chooser. Statically prerendered, so it survives a wifi drop. A pre-paint script sends iPads and touch Macs straight to `/kiosk`. |
| `/kiosk` | The customer terminal. Revalidated every 60s, so a hiccup serves the last good catalogue instead of an error. |
| `/admin/*` | Back office, gated by `app/admin/layout.tsx`. |
| `/api/invoice/[id]` | Invoice PDF. Staff session **or** a per-invoice receipt token. |
| `/api/report/income` | Income statement PDF. Staff only. |
| `proxy.ts` | Sends phones to the kiosk. Not `middleware.ts` — that name is deprecated in Next 16. |

### Where the rules live

- `lib/queries.ts` — every read. All aggregation happens in SQL.
- `lib/mutations.ts` — every write. Plain functions, no auth, no cache logic.
- `app/**/actions.ts` — server actions: authorise, validate, call a mutation,
  revalidate. Actions are their own endpoints, so each one calls
  `requireStaff()` itself rather than trusting the layout.
- `lib/format.ts` — money and dates. **Every date is the shop's**, in
  `America/Los_Angeles`. Vercel runs in UTC, so this is stated explicitly
  rather than inferred.

### Two things that are easy to get wrong again

**Timezones.** Neon's HTTP driver gives every query its own UTC session, so
`sold_at >= '2026-08-01'::date` means "from 5pm on July 31st" in the shop. Every
date comparison converts explicitly:

```sql
sold_at >= (${start}::date)::timestamp AT TIME ZONE 'America/Los_Angeles'
```

On one sample day this was the difference between 17 invoices and 5.

**Prices.** The kiosk is unauthenticated by design — it is a shared terminal
with no login. So the browser sends item numbers and quantities, never prices;
`app/kiosk/actions.ts` looks up every amount of money itself. The point of sale
does the same and additionally checks its own total against the one the screen
showed, refusing the sale if they differ by more than a cent.

## Verifying

There is no test runner. What exists instead is a script that exercises the real
queries and the real write paths against the live database inside transactions
that deliberately fail, so nothing is persisted:

```
scratchpad/verify.mjs   (see the session notes; not committed)
```

It asserts that reads return sane figures, that every write path runs to
completion, and that the constraints still refuse each of the incidents that
motivated them — duplicate customer ids, duplicate SKUs, negative store credit,
orphan invoice lines, and an invoice marked paid with no payment date.

## Email

Two routes, both configured in the app under **Settings → Emailing receipts**;
credentials are encrypted with the server's session secret and stored in
`app_secrets`, never rendered back to the screen.

- **Gmail** — an app password. Simple, sends from the shop's own address, and
  cannot tell you whether anything arrived. "Sent" in the log means exactly
  that and no more.
- **Resend** — an API key plus a verified domain. Reports back through a
  webhook as each message is delivered, opened or bounced, and delivers
  replies into `email_replies`. Needs a domain because mail claiming to come
  from a gmail.com address via a third party lands in spam.

Resend's webhook posts to `/api/email/webhook`, verified against its Svix
signature by hand in `lib/webhook.ts` — unsigned, stale and tampered requests
are all refused with a 404. Google OAuth is deliberately not used: Gmail's
scopes are *restricted*, so a published app needs an annual third-party
security assessment, and an unpublished one has refresh tokens that expire
every seven days.

## Deploying

Set `DATABASE_URL`, `KIOSK_ADMIN_PIN` and `KIOSK_SESSION_SECRET` in the Vercel
dashboard (plus the `SMTP_*` pair if you want emailed receipts). Push; Vercel
builds. The repository is public — no secret ever belongs in it.

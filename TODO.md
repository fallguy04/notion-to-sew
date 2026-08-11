# Notion to Sew — To-do

Ordered by consequence. **P0** means a real risk is live right now.
"Owner" is who has to do it — several of these need information only Mom has.

---

## P0 — DONE: credentials rotated (2026-08-11)

The Google service-account key has been revoked and verified dead. The app no
longer uses a Google key at all — the live code path references zero of them —
so the copy in this repo's history is inert. `.streamlit/secrets.toml` is no
longer tracked.

**Still confirm:** the *old* Gmail app password and the *old* admin PIN are in
the git history too. Deleting the old app password at
myaccount.google.com/apppasswords is what kills it; changing the PIN in
Streamlit Cloud is what kills that one. Neither can be verified from outside.

<details><summary>Original instructions, kept for reference</summary>

### Credentials were public

`.streamlit/secrets.toml` is committed to this repository and the repository is
public. It contains the Google service-account **private key** (full read/write
on the customer database), the **Gmail app password**, and the **admin PIN**.
Exposed since at least April 2026.

**Deleting the file does not fix this — it stays in the git history.** The
credentials have to be replaced. Order matters; step 5 before step 4 takes the
shop offline.

| # | Step | Owner |
|---|------|-------|
| 1 | Google Cloud → IAM → Service Accounts → `inventory-bot@idyllic-web-418117` → Keys → **delete the existing key**, then Add key → Create new key (JSON) | Michael |
| 2 | myaccount.google.com/apppasswords → revoke "Notion to Sew Kiosk", create a new one | Michael |
| 3 | Choose a new admin PIN | Michael |
| 4 | Put all three into share.streamlit.io → app → Settings → Secrets. **Confirm the app still works.** | Michael |
| 5 | Only then: `git rm --cached .streamlit/secrets.toml` and commit. `.gitignore` already blocks re-adding it | Michael |
| 6 | Consider making the repo private, or deleting and recreating it so the history goes. Note: Streamlit Community Cloud needs private-repo access granted first, or the deployment breaks | Michael |

Until step 1 is done, treat the database as compromised.

---

</details>

---

## DONE: running on Postgres (2026-08-11)

Neon `us-west-2`, Postgres 18.4. The Streamlit app reads and writes it; the
Google Sheet is frozen and should be renamed to make that obvious.

    customers 226 · products 1507 · invoices 1374 · lines 7825
    paid revenue $74,749.47 · integrity problems 0

Every incident from this project is now refused by the engine rather than
policed by application code: duplicate CustomerID, duplicate SKU, duplicate
invoice number, negative credit, orphan lines, paid-with-no-timestamp. Selling
is one `record_sale()` transaction.

**Next: rename the Sheet** to "NotionToSew_DB (ARCHIVED — read only)" so nobody
trusts a stale number.

---

## DONE: the new front end (2026-08-11)

`web/` is a complete Next.js replacement for both Streamlit screens, on the same
Postgres database. Every feature of `Home.py` and `pages/Kiosk.py` is present.
See `web/README.md` for how it fits together.

What changed on purpose rather than being ported as-is:

| Old | New | Why |
|---|---|---|
| Restock by typing a SKU, offering to create one if it didn't match | Searchable picker; creating an item is a separate action | That box is what put four different books under the SKU "Book" |
| Checkout asked for the customer **last** | Asks **first** | Wholesale pricing, tax rate and store credit all depend on who is buying; everything before that was a guess |
| Payment options: Cash / Card / Venmo / Invoice | …plus **Check** | 826 of 1,374 historical invoices were paid by check, and the old screen couldn't record one |
| Free-form spreadsheet grid over the whole inventory | Bulk edit of prices, costs and counts only | Identity stays fixed; a stock change is written to the ledger as a counted adjustment instead of overwriting a cell |
| "Next Invoice ID" as an editable setting | Read-only, from the database sequence | The editable version is what burned six invoice numbers |
| Venmo QR fetched from api.qrserver.com | Drawn on the server | No third party learns the shop's handle, and it still works when the wifi doesn't |
| Customer list paged 25 at a time | Whole book, filtered as you type | 226 names is nothing to send and everything to gain |

Two things worth knowing about the design:

- **Dates are the shop's**, not the server's. Vercel runs in UTC and Neon's HTTP
  driver gives every query its own UTC session, so every date comparison
  converts to `America/Los_Angeles` explicitly. On 31 March that is the
  difference between 17 invoices and 5.
- **The kiosk never sends prices.** It is unauthenticated by design — a shared
  terminal with no login — so the browser sends item numbers and quantities and
  the server looks up every amount of money itself.

---

## DONE: returns (2026-08-11)

Virginia Skiles bought five serger threads and brought one back, and there was
no way to say so. The only options were deleting a sale that really happened or
leaving the books wrong.

A return is recorded as what it is: a sale with negative quantities, linked to
the invoice it came from (`invoices.returns_id`). That makes the arithmetic look
after itself — revenue drops, sales tax drops, the thread goes back on the
shelf as a `return` in the stock ledger, and the customer's history shows both
halves rather than neither. Migration `db/006_returns.sql`.

Everything the browser sends is a line and a quantity. Prices come off the
original invoice and the tax is recomputed at the rate **that invoice** charged,
not today's, so a refund can only ever be for what was actually taken.

- Quantities are capped at what was bought, less anything already returned.
- The money goes back as cash, check, card, Venmo or store credit.
- Deleting a sale that has a return against it is refused — delete the return
  first, or the return would be left pointing at nothing.
- Deleting a store-credit return takes the credit back off the account, the
  same trap the gift certificate had.
- The document prints as a **RETURN** with positive figures and "Refunded",
  because a customer holding the slip should not have to read minus signs.

## DONE: Mom's counter feedback (2026-08-11)

- **Long invoices.** Past about five lines the item just added fell below the
  fold, so entering Calico Point's invoice meant scrolling down to fix the
  quantity and back up to search again. New lines now go to the **top** of the
  basket with the quantity box focused and selected: type the number, press
  Enter, and the cursor is back in the search box for the next item.
- **Wholesale.** The feature was built and working; nobody had ever been marked
  as a wholesale account, so it never showed itself anywhere. Filtering the
  customer list to "Wholesale only" now says so, and says where the switch is.

---

## P1 — Sales tax sits outside the total on 1,046 imported invoices

Found by a live end-to-end test on 11 August 2026.

The previous bookkeeping software recorded an invoice's total **before** sales
tax, with the tax in a column of its own. Everything this app has ever written
records the total **including** tax. Both conventions are now sitting in the
same table:

| Where the record came from | Invoices | Total excludes tax | Tax outside totals |
|---|---|---|---|
| Imported (id below 10000) | 1,251 | 1,046 | **$1,885.78** |
| Written by the app (id 10000+) | 123 | 0 | — |

Reports compute revenue as `total − tax`. On the 1,046 that already exclude it,
that subtracts the tax a second time, so **revenue is understated by up to
$1,885.78 across all time** — about $593 of it in 2025 alone. Taxable sales on
the Sales tax screen are off by the same reasoning.

**Nothing has been changed.** Which figure is right depends on a fact only Mom
has: on a $6.45 order in January 2025, did the customer hand over $6.45 or
$6.95? The Money screen now says so in as many words, and reprinted invoices
show only the rows that add up to what the invoice says it was settled for,
with the tax as a footnote.

- [ ] **Mom:** for a pre-2026 order, did the amount you were paid include the
      sales tax or not?
- [ ] **Michael:** once she answers, a one-off migration can put the 1,046
      records on the same footing as everything else, and this note can go.

---

## P1 — Four bulk discounts were applied but never recorded

Same test, same day. Invoices **10047, 10048, 10057 and 10105** were settled for
less than their line items come to — $50.49, $8.78, $0.92 and $3.40 less. The
old checkout let you enter a bulk discount percentage, applied it to the money,
and then called `commit_sale`, which had no discount parameter: the invoice
recorded `discount = 0`.

Harmless to the bank, but the line items on those four documents don't explain
their totals. The new point of sale stores the discount, so this cannot recur.
Reprinted invoices show the difference as an "Adjustment" rather than printing
figures that don't add up.

(Invoice 10146 is out by 3¢ — a rounding artefact, not worth chasing.)

---

## P1 — Six sales were lost and are not recoverable from the app

`commit_sale` used to claim the invoice number from Settings *before* writing the
transaction row, so any failure at that moment spent the number and the sale
vanished — no row, no line items, nothing. **This is fixed** (the counter now
rolls back and checkout reports the failure), but the six already lost were never
written and cannot be recovered. Each can be bracketed by the invoices either
side of it:

| Lost invoice | Rung up between |
|---|---|
| 10032 | 2026-03-31 04:03 → 17:08 |
| 10040 | 2026-03-31 18:57 → 19:16 |
| 10081 | 2026-05-05 17:06 → 2026-05-07 11:51 |
| 10101 | 2026-05-18 13:49 → 2026-05-19 10:41 |
| 10124 | 2026-06-16 14:44 → 2026-06-23 11:19 |
| 10143 | 2026-07-07 11:34 → 12:27 |

- [ ] **Mom:** re-enter the Calico Point sale ($357.17). The amount appears nowhere
      in the database — not as a total, a line-item sum, or any cell — so it is
      almost certainly one of these. She checked back to April, which rules out
      the two from March, leaving 10081 / 10101 / 10124 / 10143.
      Checkout → Calico Point Fabric → items → Payment: **Check** (records it paid
      immediately; "Invoice (Pay Later)" is what creates an open invoice).
- [ ] **Mom:** check paper records against the other three dates for anything else
      that never made it in.
- [ ] **Open question:** the invoice PDF is generated *after* the save, so a failed
      save should not have produced anything to mail. Does she have a copy of what
      she sent Calico Point? If so, something else went wrong too and it is worth
      chasing.

---

## P2 — Needs Mom's knowledge, blocks nothing

- [ ] **Two merged prices.** Four duplicate-SKU pairs were combined; two disagreed
      on price and the first was kept. Confirm or correct in the inventory editor:
      `13534 C8` kept **$0.80** (other row said $1.10); `8103 C87` kept **$0.45**
      (other said $0.50).
- [ ] **`13534 C8` is at zero stock** — it summed −13 + 13. Needs a physical count.
- [ ] **Merged names carry one dye lot.** "Cream 7/16" triangle shell" and "Dark
      Lilac Corozo" each now hold both colours. Rename if confusing.
- [ ] **21 items show negative stock** (worst: `4099 ABR` at −76, `3110 C20A` at
      −62) — sales recorded without matching restocks. Zero them out or count them.
- [ ] **Expenses:** superseded by other software, per Mom. Left as-is. Note that
      any "profit" the app reports is therefore really just revenue.

---

## P2 — Switching over

- [ ] **Michael:** deploy `web/` and set `DATABASE_URL`, `KIOSK_ADMIN_PIN` and
      `KIOSK_SESSION_SECRET` in the Vercel dashboard. Confirm the PIN opens the
      back office and the kiosk lists items.
- [ ] **Michael:** add `SMTP_USER` and `SMTP_PASS` (a Gmail *app password*) if
      Mom wants emailed receipts. Until then every Email button says so plainly
      instead of failing in front of a customer. Settings has a "Test the
      connection" button.
- [ ] **Mom:** try the new kiosk on the iPad and the back office on the laptop
      *before* the Streamlit app is switched off. Both read and write the same
      database, so they can run side by side for as long as it takes.
- [ ] **Michael:** once she's happy, take the Streamlit app down. `Home.py`,
      `pages/`, `backend.py`, `backend_sheets_legacy.py`, `documents.py`, `ui.py`,
      `assets/`, `.streamlit/` and `requirements.txt` all go with it. Keep `db/`
      — that is the schema and the migration record.

---

## P3 — Engineering, in rough value order

- [ ] **Invoice 175** (2023-05-13, $24.00) points at customer `C-104`, who no longer
      exists. Shows as "Guest" in reports. Harmless, pre-existing.
- [ ] **No automated tests.** What exists is a script that runs the real queries
      and write paths against the live database inside transactions that
      deliberately abort, so nothing persists (25 checks, all passing). It is not
      committed and does not run in CI. A Neon branch would give a disposable
      copy to test against properly.
- [ ] **`stock_moves` is append-only but nothing reads it in bulk.** Per-item
      history exists in the inventory dialog. A "why did this month's stock
      move" view would make the 21 negative-stock items explicable rather than
      just visible.
- [ ] **The kiosk ships the whole catalogue** (~1,500 items) so search survives a
      wifi drop. Worth watching if the catalogue triples.
- [ ] **No offline write queue.** Search works offline; finishing a sale does
      not. The basket survives, the error is explicit and nothing is lost — but a
      genuinely offline checkout would need a service worker and a sync queue.

---

## Done

### Data repairs (2026-08-10)
Backup of the pre-repair state is in Drive as
"NotionToSew_DB — BACKUP before CustomerID fix 2026-08-10".

- **Duplicate CustomerIDs.** `C-5` was shared by Calico Point Fabric and a bogus
  record, `C-6` by County Line Fabrics and another. Clicking "Manage" on the real
  shop opened the wrong profile and hid its invoices. Both bogus records — which
  arrived with the March 2026 import from the previous bookkeeping software, not
  from this app — were removed. Calico Point now owns C-5 with its 15 invoices;
  County Line owns C-6 with 12.
- **27 phantom transaction rows.** The same import fanned every C-5/C-6 invoice
  into two identical rows, double-counting **$18,822.52**. Removed.
- **5 duplicate SKUs.** Four pairs merged with stock summed; the four books that
  all shared the SKU "Book" are now `BOOK1`–`BOOK4`, and their 12 historical line
  items were retagged by product name so each keeps its own sales history.
- **6 duplicate customer records** from repeated New Customer submissions removed
  (all had zero invoices and zero credit).

Final state: 226 customers, 1,243 inventory items, 1,374 invoices,
`check_integrity()` reporting zero problems.

### Code
- `check_integrity()` detects duplicate CustomerIDs, SKUs and invoice numbers;
  shown as a banner in the admin portal. Guarded so it can never crash the app.
- `add_customer` regenerates its ID until unique.
- All eleven `worksheet.find()` calls scoped with `in_column=1` — they previously
  scanned whole sheets, so an ID could match a phone number and write to the
  wrong row.
- Manage button stores the clicked row, not just the ID.
- Customer deletion blocked while an ID is shared.
- Accounts Receivable collapses duplicate IDs before merging and keys widgets by
  row index; it would otherwise have crashed on a duplicate key.
- Checkout and Kiosk resolve customers by row with disambiguated labels.
- Invoice-number rollback on a failed write, plus a visible "sale was not saved".
- Store-credit deduction failures now fail the sale instead of being swallowed.
- "Saved!"/"Deleted." check the return value first.
- Totals and tax rounded to cents on write.
- Every dependency pinned.

### Performance
Workbook opened once per session instead of re-searched on every write, and each
tab cached independently so a write invalidates only what it touched.
Measured on live data: refresh after a customer edit went **5.3s → 0.33s**.

### Look and feel
Warm paper ground with a deep spruce accent, softer radii, visible widget
borders, semantic colours warmed to match. Customer list is one compact row per
person, paged 25 at a time. Emoji labels no longer glued to their text.

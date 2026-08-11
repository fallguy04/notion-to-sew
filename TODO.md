# Notion to Sew — To-do

Ordered by consequence. **P0** means a real risk is live right now.
"Owner" is who has to do it — several of these need information only Mom has.

---

## P0 — Credentials are public. Do this first.

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

## P3 — Engineering, in rough value order

- [ ] **Migrate off Google Sheets to Neon Postgres.** Every serious problem found
      in this project was a missing primary key: two CustomerIDs shared by two
      customers, 27 duplicated transaction rows overstating revenue by $18,822.52,
      five SKUs shared by multiple products. A `PRIMARY KEY` rejects all of them at
      write time. Keep the Streamlit UI; replace `backend.py`'s storage layer and
      mirror nightly to a read-only Sheet so Mom keeps the view she trusts.
      Neon's free tier auto-resumes in ~500ms (Supabase's free tier pauses after a
      week and needs a manual wake).
- [ ] **`st.dialog` for the customer profile.** Would delete the
      `active_cust_id` / `active_cust_row` session-state juggling entirely — the
      exact machinery that caused the original wrong-customer bug.
- [ ] **Inventory search selectbox ships all 1,243 items to the browser** on every
      rerun, on both the admin checkout and the kiosk. Fine today, worth watching.
- [ ] **`delete_invoice` loops `find`/`delete_rows` per line item** — one API round
      trip each. A 26-line invoice is 26 sequential calls.
- [ ] **No write is transactional.** `commit_sale` writes the transaction, then the
      items, then the stock. A failure between steps leaves a partial sale. The ID
      rollback covers the worst case; the rest goes away with Postgres.
- [ ] **Invoice 175** (2023-05-13, $24.00) points at customer `C-104`, who no longer
      exists. Shows as "Unknown" in reports. Harmless, pre-existing.
- [ ] **Streamlit Cloud sleeps on inactivity** — the 9-minute health ping in
      `Kiosk.py` helps but does not fully solve it, since sleep is based on
      WebSocket inactivity. If the iPad kiosk needs instant-on all day, that is
      worth ~$5/mo on Fly.io or Render.
- [ ] **`fpdf` is pinned at 1.7.2**, the last release under that name, from 2012.
      The invoice layout is written against its API. Migrating to `fpdf2` is its
      own task with the PDFs compared side by side — not a dependency bump.

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

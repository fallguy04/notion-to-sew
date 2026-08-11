# Notion to Sew — Outstanding Tasks

## 🚨 1. URGENT: Rotate the exposed credentials

`.streamlit/secrets.toml` is committed to this repository, and the repository is
public. That file contains the Google service-account private key (full read/write
on the customer database), the Gmail app password, and the admin PIN. Anyone who
found the repo has had full access.

**Removing the file is not enough — it stays in the git history.** The credentials
themselves have to be replaced. Do these in order:

1. **Google Cloud** → IAM & Admin → Service Accounts → `inventory-bot@idyllic-web-418117`
   → Keys → delete the existing key, then **Add key → Create new key (JSON)**.
2. **Gmail** → myaccount.google.com/apppasswords → revoke the "Notion to Sew Kiosk"
   password, create a new one.
3. **Pick a new admin PIN** (the current one is in the public repo).
4. Put all three into **share.streamlit.io → your app → Settings → Secrets**.
   Confirm the app still works after saving.
5. Only once step 4 is confirmed working: `git rm --cached .streamlit/secrets.toml`
   and commit. `.gitignore` now prevents it being re-added.
6. Consider making this repository private, or deleting and recreating it so the
   history goes away. Note: Streamlit Community Cloud needs private-repo access
   granted before the repo can be flipped to private, or the deployment breaks.

Until step 1 is done, treat the database as compromised.

---

## 2. Questions for Mom

**Merged inventory items** — four pairs of duplicate SKUs were combined. Two had
conflicting prices and the first was kept; please confirm or correct in the
inventory editor:

| SKU | Kept | Other row said | Note |
|-----|------|----------------|------|
| `13534 C8` | $0.80 | $1.10 | Stock came out at **0** — needs a physical count |
| `8103 C87` | $0.45 | $0.50 | |

The merged rows still carry one dye-lot colour in their names (“Cream 7/16"
triangle shell”, “Dark Lilac Corozo”) even though each now holds both lots.
Rename if that's confusing.

**Negative stock** — 21 items show negative quantities (worst: `4099 ABR` at −76,
`3110 C20A` at −62). These are sales recorded without matching restocks. Decide
whether to zero them out or do a count.

**Expenses** — 34 of the 40 expense rows have an amount of $0.00; all are 2023
"Vendor Payment" entries where the figures did not survive the migration. Any
profit number the app shows is really just revenue until these are filled in.
Does the bookkeeper still have the totals?

**Six sales were lost and need re-entering.** `commit_sale` used to reserve the
invoice number before writing the row, so a failed write spent the number and
the sale disappeared with no row and no line items. That is fixed, but the six
already lost cannot be recovered from the app — the data was never written.
Each can be bracketed by the invoices either side of it:

| Lost invoice | Rung up between |
|---|---|
| 10032 | 2026-03-31 04:03 and 2026-03-31 17:08 |
| 10040 | 2026-03-31 18:57 and 2026-03-31 19:16 |
| 10081 | 2026-05-05 17:06 and 2026-05-07 11:51 |
| 10101 | 2026-05-18 13:49 and 2026-05-19 10:41 |
| 10124 | 2026-06-16 14:44 and 2026-06-23 11:19 |
| 10143 | 2026-07-07 11:34 and 2026-07-07 12:27 |

**The Calico Point sale ($357.17)** is almost certainly one of these — the amount
appears nowhere in the database, as a total, a line-item sum, or any cell. She
looked back to April, which rules out the two from March, leaving 10081, 10101,
10124 and 10143. Re-enter it via Checkout → Calico Point Fabric → items →
Payment: **Check** (that records it as paid immediately; "Invoice (Pay Later)"
is the one that creates an open invoice). Worth checking her paper records
against the other three dates too.

---

## 3. Kiosk "Default Page" Behavior

Currently the app opens to the Admin portal by default (Home.py).
The kiosk lives at `/Kiosk` (pages/Kiosk.py).

**Options to make Kiosk the "default" on the iPad:**
- Bookmark the direct kiosk URL on the iPad instead of the home URL
- Or ask if you want a redirect added to Home.py that sends the iPad
  straight to the kiosk page (can detect by screen width or add a URL param)

---

## 4. Keep-Alive Status

The kiosk page pings `/_stcore/health` every 9 minutes via JavaScript.
This helps, but Streamlit Cloud's sleep is based on WebSocket inactivity.

**If the app still goes to sleep**, the proper fix is the `streamlit-autorefresh`
package which triggers a true Streamlit re-run (keeps the WebSocket alive):

```bash
pip install streamlit-autorefresh
```

Then add `streamlit-autorefresh` back to `requirements.txt` and redeploy.
The import is already removed from Home.py — you'd add it to `Kiosk.py` instead:

```python
from streamlit_autorefresh import st_autorefresh
st_autorefresh(interval=9 * 60 * 1000, key="keepalive")
```

---

## Data repairs completed (2026-08-10)

The database had no way to enforce unique IDs, and three collisions had built up.
All are fixed; a backup of the pre-repair state is in Google Drive as
"NotionToSew_DB — BACKUP before CustomerID fix 2026-08-10".

- **Duplicate CustomerIDs.** `C-5` was shared by Calico Point Fabric and a bogus
  record, `C-6` by County Line Fabrics and another. Clicking "Manage" on the real
  shop opened the wrong profile and hid its invoices. The two bogus records (which
  arrived with the March 2026 import, not from this app) were removed. Calico Point
  now owns C-5 with its 15 invoices; County Line owns C-6 with 12.
- **27 phantom transaction rows.** The same import fanned every C-5/C-6 invoice into
  two identical rows, double-counting **$18,822.52** of revenue. Removed;
  TransactionItems was untouched and needed no changes.
- **5 duplicate SKUs.** Four pairs merged with stock summed; the four books that all
  shared the SKU "Book" now have `BOOK1`–`BOOK4`, and their 12 historical line items
  were retagged by product name so each book keeps its own sales history.
- **6 duplicate customer records** from repeated New Customer submissions removed
  (all had zero invoices and zero credit).

### Code changes that prevent recurrence

- `check_integrity()` in `backend.py` detects duplicate CustomerIDs, SKUs and invoice
  numbers; `Home.py` shows a red banner when any exist.
- `add_customer` now checks existing IDs and regenerates until unique.
- All eleven `worksheet.find()` calls are scoped with `in_column=1` — they previously
  scanned entire sheets, so an ID could match a phone number or note and write to the
  wrong row.
- The customer "Manage" button stores the clicked row, not just the ID.
- Customer deletion is blocked while an ID is shared.
- Accounts Receivable collapses duplicate IDs before merging and includes the row
  index in widget keys (it would otherwise crash on a duplicate-key error).
- Checkout and Kiosk resolve the customer by row with disambiguated labels instead of
  by name.

### Known remaining wrinkle

Invoice 175 (2023-05-13, $24.00) points at customer `C-104`, who no longer exists.
It shows as "Unknown" in reports. Harmless, pre-existing.

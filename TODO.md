# Notion to Sew — Outstanding Tasks

## 1. Set Up Gmail for Email Receipts

The kiosk now sends PDF receipts by email, but it needs real credentials to work.

### Step 1: Create a Gmail App Password
1. Go to your Google Account → **Security**
2. Make sure **2-Step Verification** is turned ON
3. Search for **"App passwords"** (or go to myaccount.google.com/apppasswords)
4. Create a new app password — name it "Notion to Sew Kiosk"
5. Copy the 16-character password it gives you (e.g. `abcd efgh ijkl mnop`)

### Step 2: Update secrets.toml (local)
Open `.streamlit/secrets.toml` and fill in the placeholders at the bottom:
```toml
[email]
sender = "notiontosew217@gmail.com"       # The Gmail address sending the receipts
app_password = "iysa dmqg itzb yzkp"  # The App Password from Step 1
```

### Step 3: Update Streamlit Cloud secrets
1. Go to your app on share.streamlit.io
2. Click **Settings → Secrets**
3. Add the same two lines from Step 2 to the Secrets editor there

### Notes
- The email is sent FROM the Gmail account you set as `sender`
- The customer's email is pre-filled from their customer record if they're in the system
- If email fails, the success screen shows a warning and a download button instead
- Guest/walk-in customers can type in their email manually at checkout

---

## 2. Kiosk "Default Page" Behavior

Currently the app opens to the Admin portal by default (Home.py).
The kiosk lives at `/Kiosk` (pages/kiosk.py).

**Options to make Kiosk the "default" on the iPad:**
- Bookmark the direct kiosk URL on the iPad instead of the home URL
- Or ask if you want a redirect added to Home.py that sends the iPad
  straight to the kiosk page (can detect by screen width or add a URL param)

---

## 3. Keep-Alive Status

The kiosk page now pings `/_stcore/health` every 9 minutes via JavaScript.
This helps, but Streamlit Cloud's sleep is based on WebSocket inactivity.

**If the app still goes to sleep**, the proper fix is the `streamlit-autorefresh`
package which triggers a true Streamlit re-run (keeps the WebSocket alive):

```bash
pip install streamlit-autorefresh
```

Then add `streamlit-autorefresh` back to `requirements.txt` and redeploy.
The import is already removed from Home.py — you'd add it to `kiosk.py` instead:

```python
from streamlit_autorefresh import st_autorefresh
st_autorefresh(interval=9 * 60 * 1000, key="keepalive")
```

---

## 4. Change the Staff PIN (do this before going live!)

The default PIN is `1234` — change it in two places:

**Local:** `.streamlit/secrets.toml`
```toml
[admin]
pin = "your-new-pin"
```

**Streamlit Cloud:** Settings → Secrets → add the same `[admin]` block

---

## Done ✅
- [x] App opens to Kiosk by default
- [x] Staff access via hidden sidebar PIN on kiosk page
- [x] "Back to Kiosk" button in Admin sidebar
- [x] Email receipt function added to backend.py (send_receipt_email)
- [x] Email input added to kiosk checkout (pre-fills from customer record)
- [x] Kiosk success screen shows email confirmation, no PDF iframe
- [x] Keep-alive JS ping added to kiosk.py
- [x] streamlit_autorefresh import error fixed (removed from Home.py)
- [x] Expense logger bug fixed (was a dangling selectbox with no form/submit)
- [x] Removed time.sleep(0.5) blocking call from kiosk
- [x] Removed unused imports (base64, components) from Home.py

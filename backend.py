import uuid
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
import streamlit as st
import gspread
import pandas as pd
from google.oauth2.service_account import Credentials
from datetime import datetime, timedelta
import pytz
from fpdf import FPDF

# --- CONNECTIVITY ---
SPREADSHEET_NAME = "NotionToSew_DB"

# Which worksheet backs each key of get_data(), so a write can invalidate just
# the tab it touched instead of re-downloading the whole workbook.
SHEETS = {
    "inventory":    "Inventory",
    "transactions": "Transactions",
    "items":        "TransactionItems",
    "customers":    "Customers",
    "settings":     "Settings",
    "expenses":     "Expenses",
}

@st.cache_resource
def get_client():
    """Connects to Google Cloud."""
    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
    creds = Credentials.from_service_account_info(st.secrets["gcp_service_account"], scopes=scopes)
    return gspread.authorize(creds)

@st.cache_resource
def get_sheet():
    """Opens the workbook once per session and reuses the handle.

    Every write used to call client.open(SPREADSHEET_NAME), which costs a Drive
    search on each call (~0.75s vs ~0.15s for open_by_key). Set a top-level
    `spreadsheet_key` in secrets to skip the search entirely; opening by name
    also risks picking up a different file that happens to share the title.
    """
    client = get_client()
    key = None
    try:
        key = st.secrets.get("spreadsheet_key") or None
    except Exception:
        pass
    return client.open_by_key(key) if key else client.open(SPREADSHEET_NAME)

@st.cache_data(ttl=600)
def _read_sheet(tab_name):
    """One worksheet as a DataFrame, cached per tab."""
    return pd.DataFrame(get_sheet().worksheet(tab_name).get_all_records())

def get_data():
    """All data tables. Each tab is cached separately, so refreshing after a
    write only re-downloads what actually changed."""
    try:
        out = {}
        for key, tab in SHEETS.items():
            try:
                out[key] = _read_sheet(tab)
            except Exception:
                # A missing optional tab (Expenses) shouldn't sink the whole load.
                if key == "expenses":
                    out[key] = pd.DataFrame()
                else:
                    raise
        return out
    except Exception as e:
        st.error(f"🚨 Database Error: {e}")
        return {}

# --- HELPER: Force Cache Clear ---
def force_refresh(*tabs):
    """Invalidates cached reads. Pass the worksheet names that changed, e.g.
    force_refresh("Customers"). With no arguments every tab is dropped."""
    if tabs:
        for tab in tabs:
            try:
                _read_sheet.clear(tab)
            except Exception:
                _read_sheet.clear()   # older Streamlit can't clear a single entry
    else:
        _read_sheet.clear()
    return True

def check_integrity():
    """Returns a list of plain-English data problems, or [] if the DB is clean.

    Sheets can't enforce a primary key, so the two failure modes that silently
    corrupt the books are caught here instead: a duplicate CustomerID merges two
    customers' invoice histories, and a duplicate TransactionID double-counts
    revenue in every report.
    """
    data = get_data()
    problems = []

    cust = data.get("customers")
    if cust is not None and not cust.empty and 'CustomerID' in cust.columns:
        ids = cust['CustomerID'].astype(str).str.strip()
        counts = ids[ids != ""].value_counts()
        for cid, n in counts[counts > 1].items():
            who = ", ".join(cust.loc[ids == cid, 'Name'].astype(str))
            problems.append(
                f"CustomerID **{cid}** is shared by {n} customers ({who}). "
                "Their invoices and store credit are merged, and the Manage "
                "button opens whichever one comes first in the sheet."
            )

    invn = data.get("inventory")
    if invn is not None and not invn.empty and 'SKU' in invn.columns:
        skus = invn['SKU'].astype(str).str.strip()
        counts = skus[skus != ""].value_counts()
        for sku, n in counts[counts > 1].items():
            names = ", ".join(invn.loc[skus == sku, 'Name'].astype(str).head(4))
            problems.append(
                f"SKU **{sku}** is used by {n} products ({names}). They all ring up at "
                "the first one's price, and stock is deducted from a different row than "
                "restocking adds to — give each product its own SKU."
            )

    trans = data.get("transactions")
    if trans is not None and not trans.empty and 'TransactionID' in trans.columns:
        tids = trans['TransactionID'].astype(str).str.strip()
        counts = tids[tids != ""].value_counts()
        dupes = counts[counts > 1]
        if not dupes.empty:
            problems.append(
                f"{len(dupes)} invoice number(s) appear more than once in Transactions "
                f"({', '.join(str(i) for i in dupes.index[:5])}"
                f"{'…' if len(dupes) > 5 else ''}) — revenue is being double-counted."
            )

    return problems

def get_settings_dict():
    """Returns the Settings sheet as a plain key→value dict."""
    data = get_data()
    if "settings" not in data or data["settings"].empty:
        return {}
    return dict(zip(data["settings"]["Key"], data["settings"]["Value"]))

def get_tax_rate() -> float:
    """Returns the tax rate as a decimal (e.g. 0.0875)."""
    s = get_settings_dict()
    raw = s.get("TaxRate", "0.08")
    try:
        val = float(str(raw).replace("%", "").strip())
        return val / 100 if val > 1 else val
    except Exception:
        return 0.0

# --- LOGIC & WRITES ---

def add_customer(name, email, is_wholesale=False):
    sh = get_sheet()
    ws = sh.worksheet("Customers")
    # Ensure IsWholesale and TaxRate column headers exist
    headers = ws.row_values(1)
    if 'IsWholesale' not in headers:
        ws.update_cell(1, 9, 'IsWholesale')
    if 'TaxRate' not in headers:
        ws.update_cell(1, 10, 'TaxRate')
    # Sheets has no UNIQUE constraint, so enforce it here. A collision silently
    # merges two customers' invoice histories and makes the Manage button open
    # the wrong profile — see check_integrity().
    existing = {v.strip() for v in ws.col_values(1)[1:] if v.strip()}
    new_id = f"C-{uuid.uuid4().hex[:8]}"
    while new_id in existing:
        new_id = f"C-{uuid.uuid4().hex[:8]}"

    date_joined = datetime.now().strftime("%Y-%m-%d")
    ws.append_row([new_id, name, email, "", date_joined, "", "", 0.0, "TRUE" if is_wholesale else "FALSE", ""])
    force_refresh("Customers")
    return new_id

# UPDATED: Added cost parameter
def add_inventory_item(sku, name, price, stock, wholesale_price, cost):
    sh = get_sheet()
    ws = sh.worksheet("Inventory")
    # Cost is added as the 6th column (Column F)
    ws.append_row([sku, name, price, stock, wholesale_price, cost])
    return force_refresh("Inventory")

# NEW: Specific function to Restock (Safer than full rewrite)
def restock_item(sku, qty_to_add, new_cost=None):
    sh = get_sheet()
    ws = sh.worksheet("Inventory")
    
    try:
        cell = ws.find(str(sku), in_column=1)
        # Update Stock (Column 4 / D)
        current_stock = int(ws.cell(cell.row, 4).value or 0)
        ws.update_cell(cell.row, 4, current_stock + qty_to_add)
        
        # Update Cost (Column 6 / F) if provided
        if new_cost is not None:
             # Check if col 6 exists, if not we might need to be careful, 
             # but assuming schema is set:
            ws.update_cell(cell.row, 6, new_cost)
            
        return force_refresh("Inventory")
    except Exception:
        return False

# CRITICAL FIX: Safer Batch Update
def update_inventory_batch(df_changes):
    if df_changes.empty:
        return False # Safety guard: never wipe the sheet if DF is empty
        
    sh = get_sheet()
    ws = sh.worksheet("Inventory")
    
    # 1. Prepare data
    headers = df_changes.columns.tolist()
    data = df_changes.astype(str).values.tolist()
    payload = [headers] + data
    
    # 2. Update the data range only (overwrite)
    # This prevents the "window of death" where data is cleared but not yet written
    ws.update(values=payload, range_name="A1")
    
    # 3. Optional: Clear only rows below the new dataset if the list got shorter
    # (Prevents "ghost" rows if you deleted items)
    current_row_count = len(ws.get_all_values())
    new_row_count = len(payload)
    if current_row_count > new_row_count:
        # Clear rows from (new_last_row + 1) to (old_last_row), spanning all columns
        last_col = chr(ord('A') + len(headers) - 1)
        ws.batch_clear([f"A{new_row_count + 1}:{last_col}{current_row_count}"])

    return force_refresh("Inventory")

# ... (Rest of commit_sale, mark_invoice_paid, etc. remains the same) ...

def commit_sale(cart, total, tax, cust_id, payment_method, is_wholesale, status="Paid", credit_used=0.0):
    sh = get_sheet()
    
    # 1. Deduct Credit
    if credit_used > 0 and cust_id:
        ws_cust = sh.worksheet("Customers")
        try:
            cell = ws_cust.find(cust_id, in_column=1)
            current_credit = float(ws_cust.cell(cell.row, 8).value or 0)
            ws_cust.update_cell(cell.row, 8, max(0.0, current_credit - credit_used))
        except Exception as e:
            # Silently keeping the credit means the customer is charged twice for
            # it later. Fail the sale instead so it can be redone.
            raise RuntimeError(f"Could not apply store credit for {cust_id}: {e}")

    # 2. Invoice ID
    tz = pytz.timezone("America/Los_Angeles")
    date_now = datetime.now(tz)

    ws_set = sh.worksheet("Settings")
    counter_cell = None
    try:
        cell = ws_set.find("NextInvoiceID", in_column=1)
        current_id = int(ws_set.cell(cell.row, cell.col + 1).value)
        ws_set.update_cell(cell.row, cell.col + 1, current_id + 1)
        invoice_id = str(current_id)
        counter_cell = (cell.row, cell.col + 1, current_id)
    except:
        invoice_id = f"INV-{date_now.strftime('%H%M%S')}"

    due_date = (date_now + timedelta(days=30 if is_wholesale else 0)).strftime("%Y-%m-%d")
    final_pay_method = f"{payment_method} (+${credit_used} Credit)" if credit_used > 0 else payment_method

    # 3. Transaction
    # The invoice number is reserved above *before* this row is written. If the
    # write fails the number is spent and the sale disappears with no trace —
    # six sales were lost that way before this rollback existed. Put the counter
    # back so the next attempt reuses the number rather than skipping it.
    try:
        sh.worksheet("Transactions").append_row([
            invoice_id, date_now.strftime("%Y-%m-%d %H:%M:%S"), round(float(total), 2), final_pay_method,
            cust_id, status, due_date, round(float(tax), 2), "TRUE" if is_wholesale else "FALSE"
        ])
    except Exception as e:
        if counter_cell:
            row, col, original = counter_cell
            try: ws_set.update_cell(row, col, original)
            except Exception: pass
        raise RuntimeError(f"Sale was NOT saved — invoice {invoice_id} could not be written: {e}")

    # 4. Items
    items_rows = []
    for item in cart:
        items_rows.append([invoice_id, item['sku'], item['qty'], item['price'], item['name']])
    sh.worksheet("TransactionItems").append_rows(items_rows)
    
    # 5. Inventory Deduct
    ws_inv = sh.worksheet("Inventory")
    inv_data = ws_inv.get_all_records()
    sku_map = {str(row['SKU']): i + 2 for i, row in enumerate(inv_data)}
    updates = []
    for item in cart:
        s_key = str(item['sku'])
        if s_key in sku_map:
            row_num = sku_map[s_key]
            raw_val = ws_inv.cell(row_num, 4).value
            try: curr_stock = int(float(raw_val or 0))
            except: curr_stock = 0
            updates.append({'range': f'D{row_num}', 'values': [[max(0, curr_stock - item['qty'])]]})
    if updates: ws_inv.batch_update(updates)
    force_refresh("Transactions", "TransactionItems", "Inventory", "Customers", "Settings")
    return invoice_id

def record_freight(invoice_id, amount):
    """Appends a freight line item to TransactionItems."""
    sh = get_sheet()
    sh.worksheet("TransactionItems").append_row([invoice_id, "FREIGHT", 1, round(float(amount), 2), "Shipping"])
    force_refresh("TransactionItems")
    return True

def mark_invoice_paid(invoice_id):
    sh = get_sheet()
    ws = sh.worksheet("Transactions")
    invoice_id_str = str(invoice_id).strip()
    # Try direct find first (fast path)
    try:
        cell = ws.find(invoice_id_str, in_column=1)
        ws.update_cell(cell.row, 6, "Paid")
        return force_refresh("Transactions")
    except Exception:
        pass
    # Fallback: scan all rows to handle float-formatted IDs ("1001.0" vs "1001")
    try:
        all_rows = ws.get_all_values()
        for row_idx, row_vals in enumerate(all_rows):
            if row_idx == 0:  # skip header
                continue
            if not row_vals:
                continue
            cell_val = str(row_vals[0]).strip()
            match = False
            try:
                match = float(cell_val) == float(invoice_id_str)
            except (ValueError, TypeError):
                match = cell_val == invoice_id_str
            if match:
                ws.update_cell(row_idx + 1, 6, "Paid")
                return force_refresh("Transactions")
    except Exception:
        pass
    return False

def delete_invoice(invoice_id):
    sh = get_sheet()
    ws_trans = sh.worksheet("Transactions")
    try: ws_trans.delete_rows(ws_trans.find(str(invoice_id), in_column=1).row)
    except: pass
    ws_items = sh.worksheet("TransactionItems")
    try:
        while True: ws_items.delete_rows(ws_items.find(str(invoice_id), in_column=1).row)
    except: pass
    return force_refresh("Transactions", "TransactionItems")

def update_customer_details(cust_id, new_name, address, phone, notes, is_wholesale=None, tax_rate_override=None):
    sh = get_sheet()
    ws = sh.worksheet("Customers")
    try:
        cell = ws.find(cust_id, in_column=1)
        ws.update_cell(cell.row, 2, new_name)
        ws.update_cell(cell.row, 4, phone)
        ws.update_cell(cell.row, 6, address)
        ws.update_cell(cell.row, 7, notes)
        if is_wholesale is not None or tax_rate_override is not None:
            headers = ws.row_values(1)
            if is_wholesale is not None:
                if 'IsWholesale' not in headers:
                    ws.update_cell(1, len(headers) + 1, 'IsWholesale')
                    headers.append('IsWholesale')
                ws.update_cell(cell.row, headers.index('IsWholesale') + 1, "TRUE" if is_wholesale else "FALSE")
            if tax_rate_override is not None:
                if 'TaxRate' not in headers:
                    ws.update_cell(1, len(headers) + 1, 'TaxRate')
                    headers.append('TaxRate')
                val = str(tax_rate_override) if tax_rate_override else ""
                ws.update_cell(cell.row, headers.index('TaxRate') + 1, val)
        return force_refresh("Customers")
    except Exception: return False

def delete_customer(cust_id):
    sh = get_sheet()
    ws = sh.worksheet("Customers")
    try:
        ws.delete_rows(ws.find(cust_id, in_column=1).row)
        return force_refresh("Customers")
    except: return False

def sell_gift_certificate(giver_id, receiver_id, amount, pay_method):
    sh = get_sheet()
    
    # 1. Invoice ID & Timestamp
    tz = pytz.timezone("America/Los_Angeles")
    date_now = datetime.now(tz)
    
    ws_set = sh.worksheet("Settings")
    try:
        cell = ws_set.find("NextInvoiceID", in_column=1)
        current_id = int(ws_set.cell(cell.row, cell.col + 1).value)
        ws_set.update_cell(cell.row, cell.col + 1, current_id + 1)
        invoice_id = str(current_id)
    except: 
        invoice_id = f"INV-{date_now.strftime('%H%M%S')}"

    ws_cust = sh.worksheet("Customers")
    try: receiver_name = ws_cust.cell(ws_cust.find(receiver_id, in_column=1).row, 2).value
    except: receiver_name = "Unknown"

    sh.worksheet("Transactions").append_row([
        invoice_id, date_now.strftime("%Y-%m-%d %H:%M:%S"), amount, pay_method, 
        giver_id, "Paid", date_now.strftime("%Y-%m-%d"), 0.0, "FALSE"
    ])
    sh.worksheet("TransactionItems").append_row([
        invoice_id, "GIFT-CERT", 1, amount, f"Gift Certificate for {receiver_name}"
    ])
    
    try:
        cell = ws_cust.find(receiver_id, in_column=1)
        curr = float(ws_cust.cell(cell.row, 8).value or 0)
        ws_cust.update_cell(cell.row, 8, curr + amount)
    except: pass

    force_refresh("Transactions", "TransactionItems", "Customers", "Settings")
    return invoice_id

def update_settings(updates_dict):
    sh = get_sheet()
    ws = sh.worksheet("Settings")
    data = ws.get_all_records()
    key_map = {row['Key']: i + 2 for i, row in enumerate(data)}
    for key, new_val in updates_dict.items():
        if key in key_map: ws.update_cell(key_map[key], 2, new_val)
        else: ws.append_row([key, new_val])
    return force_refresh("Settings")

def add_expense(date, category, amount, description):
    sh = get_sheet()
    ws = sh.worksheet("Expenses")
    ws.append_row([str(date), category, f"{float(amount):.3f}", description])
    return force_refresh("Expenses")

# --- PDF GENERATOR ---
def create_pdf(invoice_id, customer_name, company_address, cart, subtotal, tax, total, due_date, credit_applied=0.0, transaction_date=None, discount_amount=0.0, freight_amount=0.0):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20); pdf.cell(0, 10, "Notion to Sew", ln=True)
    pdf.set_font("Helvetica", "", 10)
    for line in company_address.split("\n"): pdf.cell(0, 5, line.strip(), ln=True)
    pdf.ln(10)

    # Handle Date and Timezone (Los Angeles)
    tz = pytz.timezone("America/Los_Angeles")
    if transaction_date:
        # If transaction_date is a string, we assume it's already in the correct format or try to parse it
        # If it's datetime, we use it.
        if isinstance(transaction_date, str):
            try: 
                display_date = datetime.strptime(transaction_date, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d")
            except: 
                try: display_date = datetime.strptime(transaction_date, "%Y-%m-%d").strftime("%Y-%m-%d")
                except: display_date = transaction_date # Fallback to original string
        elif isinstance(transaction_date, datetime):
            display_date = transaction_date.strftime("%Y-%m-%d")
        else:
            display_date = str(transaction_date)
    else:
        display_date = datetime.now(tz).strftime("%Y-%m-%d")

    pdf.set_font("Helvetica", "B", 12); pdf.cell(0, 10, f"INVOICE #{invoice_id}", ln=True, align='R')
    pdf.set_font("Helvetica", "", 10); pdf.cell(0, 5, f"Date: {display_date}", ln=True, align='R')
    pdf.cell(0, 5, f"Due: {due_date}", ln=True, align='R'); pdf.ln(5)
    pdf.set_font("Helvetica", "B", 10); pdf.cell(0, 5, f"Bill To: {customer_name}", ln=True); pdf.ln(10)

    pdf.set_fill_color(240, 240, 240); pdf.set_font("Helvetica", "B", 9)
    pdf.cell(35, 8, "Part #", 1, 0, 'L', 1); pdf.cell(85, 8, "Description", 1, 0, 'L', 1)
    pdf.cell(20, 8, "Qty", 1, 0, 'C', 1); pdf.cell(25, 8, "Price", 1, 0, 'R', 1); pdf.cell(25, 8, "Total", 1, 1, 'R', 1)

    pdf.set_font("Helvetica", "", 9)
    for item in cart:
        pdf.cell(35, 8, str(item['sku'])[:18], 1); pdf.cell(85, 8, str(item['name'])[:45], 1)
        pdf.cell(20, 8, str(item['qty']), 1, 0, 'C'); pdf.cell(25, 8, f"${item['price']:.2f}", 1, 0, 'R')
        pdf.cell(25, 8, f"${item['qty']*item['price']:.2f}", 1, 1, 'R')

    pdf.ln(5); pdf.set_font("Helvetica", "", 10)
    pdf.cell(165, 6, "Subtotal:", 0, 0, 'R'); pdf.cell(25, 6, f"${subtotal:.2f}", 0, 1, 'R')
    if discount_amount > 0:
        pdf.cell(165, 6, "Bulk Discount:", 0, 0, 'R'); pdf.cell(25, 6, f"-${discount_amount:.2f}", 0, 1, 'R')
        pdf.cell(165, 6, "Discounted Subtotal:", 0, 0, 'R'); pdf.cell(25, 6, f"${subtotal - discount_amount:.2f}", 0, 1, 'R')
    
    if freight_amount > 0:
        pdf.cell(165, 6, "Freight:", 0, 0, 'R'); pdf.cell(25, 6, f"${freight_amount:.2f}", 0, 1, 'R')

    pdf.cell(165, 6, "Tax:", 0, 0, 'R'); pdf.cell(25, 6, f"${tax:.2f}", 0, 1, 'R')
    if credit_applied > 0:
        pdf.cell(165, 6, "Store Credit Used:", 0, 0, 'R'); pdf.cell(25, 6, f"-${credit_applied:.2f}", 0, 1, 'R')
    pdf.set_font("Helvetica", "B", 12); pdf.cell(165, 8, "AMOUNT DUE:", 0, 0, 'R'); pdf.cell(25, 8, f"${max(0.0, total - credit_applied):.2f}", 0, 1, 'R')
    return pdf.output(dest='S').encode('latin-1')
# --- EMAIL RECEIPT ---
def send_receipt_email(to_email: str, invoice_id: str, pdf_bytes: bytes):
    """Sends the PDF receipt as an email attachment via Gmail SMTP.
    Requires [email] sender and app_password keys in st.secrets.
    """
    # 1. Direct root access
    sender = st.secrets.get("sender")
    password = st.secrets.get("app_password")

    # 2. Section-based search (looks in [email], [admin], or any other block)
    if not sender or not password:
        for key in st.secrets.keys():
            try:
                # We try to treat every top-level key as a dictionary/section
                section = st.secrets[key]
                if not sender: sender = section.get("sender")
                if not password: password = section.get("app_password")
            except:
                continue # Skip if the key isn't a section (like a simple string)
            if sender and password: break

    # 3. Final validation with detailed error
    if not sender or not password:
        all_found_keys = list(st.secrets.keys())
        raise KeyError(
            f"Email credentials missing. I can see these sections: {all_found_keys}. "
            "If you just added 'sender' and 'app_password' to the Streamlit Cloud dashboard, "
            "please go to the dashboard and click 'Reboot App' to force a refresh."
        )
    
    # Try to get company name from settings
    try:
        settings = get_settings_dict()
        company_name = settings.get("CompanyName", "Notion to Sew")
    except:
        company_name = "Notion to Sew"

    msg = MIMEMultipart()
    msg['From'] = f"{company_name} <{sender}>"
    msg['To'] = to_email
    msg['Subject'] = f"Your Receipt from {company_name} — Invoice #{invoice_id}"

    body = (
        f"Hi there!\n\n"
        f"Thank you for shopping at {company_name}. "
        f"Your receipt for Invoice #{invoice_id} is attached as a PDF.\n\n"
        f"Questions? Just reply to this email.\n\n"
        f"— {company_name}"
    )
    msg.attach(MIMEText(body, 'plain'))

    attachment = MIMEBase('application', 'pdf')
    attachment.set_payload(pdf_bytes)
    encoders.encode_base64(attachment)
    attachment.add_header(
        'Content-Disposition',
        f'attachment; filename="Receipt_{invoice_id}.pdf"'
    )
    msg.attach(attachment)

    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
        smtp.login(sender, password)
        smtp.send_message(msg)

# --- REPORT GENERATION ---
def generate_income_statement_pdf(start_date, end_date, financials):
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    
    # 1. Header (Tighter spacing)
    pdf.set_font("Arial", 'B', 16)
    pdf.cell(0, 8, "Notion to Sew", 0, 1, 'C')
    pdf.set_font("Arial", 'B', 12)
    pdf.cell(0, 6, "Income Statement - Classified", 0, 1, 'C')
    
    pdf.set_font("Arial", '', 10)
    pdf.cell(0, 5, f"Period: {start_date.strftime('%m/%d/%Y')} - {end_date.strftime('%m/%d/%Y')}", 0, 1, 'C')
    pdf.ln(5) # Small gap
    
    # Helper for lines
    def add_line(label, amount, bold=False, indent=0, is_total=False):
        pdf.set_font("Arial", 'B' if bold else '', 10)
        x_start = 10 + (indent * 5)
        pdf.set_x(x_start)
        
        page_width = 190
        amount_str = f"${amount:,.2f}" if amount >= 0 else f"(${abs(amount):,.2f})"
        
        # Draw label
        pdf.cell(100, 5, label, 0, 0)
        
        # Draw Amount aligned right
        pdf.set_x(page_width - 40)
        pdf.cell(30, 5, amount_str, 0, 1, 'R')

    # 2. REVENUE
    pdf.set_font("Arial", 'B', 10); pdf.cell(0, 6, "REVENUE", 0, 1)
    
    add_line("Retail Sales (Taxable)", financials['retail_sales'], indent=1)
    add_line("Wholesale Sales (Non-Taxable)", financials['wholesale_sales'], indent=1)
    
    if financials.get('freight_income', 0) > 0:
        add_line("Freight Income", financials['freight_income'], indent=1)

    pdf.ln(1)
    add_line("Total Revenue:", financials['total_income'], bold=True, indent=0)
    pdf.ln(3)

    # 3. COGS
    pdf.set_font("Arial", 'B', 10); pdf.cell(0, 6, "COST OF GOODS SOLD", 0, 1)
    
    add_line("Cost of Goods Sold", financials['cogs'], indent=1)
    
    pdf.ln(1)
    add_line("Total COGS:", financials['cogs'], bold=True, indent=0)
    pdf.ln(2)
    add_line("Gross Profit:", financials['gross_profit'], bold=True, indent=0)
    pdf.ln(4)

    # 4. EXPENSES
    pdf.set_font("Arial", 'B', 10); pdf.cell(0, 6, "EXPENSES", 0, 1)
    
    if financials['expenses_breakdown']:
        for cat, amt in financials['expenses_breakdown'].items():
            add_line(f"{cat}", amt, indent=1)
    else:
        add_line("No Expenses Recorded", 0.0, indent=1)

    pdf.ln(1)
    add_line("Total Expenses:", financials['total_expenses'], bold=True, indent=0)
    
    # 5. NET PROFIT (Big & Bold)
    pdf.ln(5)
    pdf.set_font("Arial", 'B', 12)
    pdf.cell(0, 8, f"Net Profit / (Loss):   ${financials['net_profit']:,.2f}", 0, 1, 'R')
    
    # Footer (Absolute positioning to ensure it stays on page 1 if space permits)
    pdf.set_y(-20)
    pdf.set_font("Arial", 'I', 8)
    pdf.cell(0, 5, f"Generated: {datetime.now().strftime('%m/%d/%Y %H:%M')}", 0, 1, 'C')

    return pdf.output(dest='S').encode('latin-1')

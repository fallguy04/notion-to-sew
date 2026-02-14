import uuid
import streamlit as st
import gspread
import pandas as pd
from google.oauth2.service_account import Credentials
from datetime import datetime, timedelta
from fpdf import FPDF
import time

# --- CONNECTIVITY ---
@st.cache_resource
def get_client():
    """Connects to Google Cloud."""
    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
    creds = Credentials.from_service_account_info(st.secrets["gcp_service_account"], scopes=scopes)
    return gspread.authorize(creds)

@st.cache_data(ttl=600)
def get_data():
    """Fetches all data tables (Cached to save Quota)."""
    client = get_client()
    try:
        sh = client.open("NotionToSew_DB")
        return {
            "inventory": pd.DataFrame(sh.worksheet("Inventory").get_all_records()),
            "transactions": pd.DataFrame(sh.worksheet("Transactions").get_all_records()),
            "items": pd.DataFrame(sh.worksheet("TransactionItems").get_all_records()),
            "customers": pd.DataFrame(sh.worksheet("Customers").get_all_records()),
            "settings": pd.DataFrame(sh.worksheet("Settings").get_all_records())
        }
    except gspread.exceptions.APIError as e:
        if "429" in str(e):
            st.error("⏳ Google says we are moving too fast! Please wait 1 minute before refreshing.")
            st.stop()
        else:
            st.error(f"Database Error: {e}")
            return {}

# --- HELPER: Force Cache Clear ---
def force_refresh():
    get_data.clear()
    return True

# --- LOGIC & WRITES ---

def add_customer(name, email):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Customers")
    new_id = f"C-{str(uuid.uuid4())[:5]}"
    date_joined = datetime.now().strftime("%Y-%m-%d")
    ws.append_row([new_id, name, email, "", date_joined, "", "", 0.0])
    return force_refresh()

# UPDATED: Added cost parameter
def add_inventory_item(sku, name, price, stock, wholesale_price, cost):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Inventory")
    # Cost is added as the 6th column (Column F)
    ws.append_row([sku, name, price, stock, wholesale_price, cost])
    return force_refresh()

# NEW: Specific function to Restock (Safer than full rewrite)
def restock_item(sku, qty_to_add, new_cost=None):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Inventory")
    
    try:
        cell = ws.find(str(sku))
        # Update Stock (Column 4 / D)
        current_stock = int(ws.cell(cell.row, 4).value or 0)
        ws.update_cell(cell.row, 4, current_stock + qty_to_add)
        
        # Update Cost (Column 6 / F) if provided
        if new_cost is not None:
             # Check if col 6 exists, if not we might need to be careful, 
             # but assuming schema is set:
            ws.update_cell(cell.row, 6, new_cost)
            
        return force_refresh()
    except Exception as e:
        return False

# CRITICAL FIX: Safer Batch Update
def update_inventory_batch(df_changes):
    if df_changes.empty:
        return False # Safety guard: never wipe the sheet if DF is empty
        
    client = get_client()
    sh = client.open("NotionToSew_DB")
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
        # Clear rows from (new_last_row + 1) to (old_last_row)
        ws.batch_clear([f"A{new_row_count + 1}:F{current_row_count}"])

    return force_refresh()

# ... (Rest of commit_sale, mark_invoice_paid, etc. remains the same) ...

def commit_sale(cart, total, tax, cust_id, payment_method, is_wholesale, status="Paid", credit_used=0.0):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    
    # 1. Deduct Credit
    if credit_used > 0 and cust_id:
        ws_cust = sh.worksheet("Customers")
        try:
            cell = ws_cust.find(cust_id)
            current_credit = float(ws_cust.cell(cell.row, 8).value or 0)
            ws_cust.update_cell(cell.row, 8, max(0.0, current_credit - credit_used))
        except: pass

    # 2. Invoice ID
    ws_set = sh.worksheet("Settings")
    try:
        cell = ws_set.find("NextInvoiceID")
        current_id = int(ws_set.cell(cell.row, cell.col + 1).value)
        ws_set.update_cell(cell.row, cell.col + 1, current_id + 1)
        invoice_id = str(current_id)
    except:
        invoice_id = f"INV-{datetime.now().strftime('%H%M%S')}"

    date_now = datetime.now()
    due_date = (date_now + timedelta(days=30 if is_wholesale else 0)).strftime("%Y-%m-%d")
    final_pay_method = f"{payment_method} (+${credit_used} Credit)" if credit_used > 0 else payment_method
    
    # 3. Transaction
    sh.worksheet("Transactions").append_row([
        invoice_id, date_now.strftime("%Y-%m-%d %H:%M:%S"), total, final_pay_method, 
        cust_id, status, due_date, tax, "TRUE" if is_wholesale else "FALSE"
    ])
    
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
            curr_stock = int(ws_inv.cell(row_num, 4).value or 0) 
            updates.append({'range': f'D{row_num}', 'values': [[max(0, curr_stock - item['qty'])]]})
    if updates: ws_inv.batch_update(updates)
            
    return invoice_id # Note: commit_sale doesn't return force_refresh bool, but cache is cleared inside next call

def mark_invoice_paid(invoice_id):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Transactions")
    try:
        cell = ws.find(str(invoice_id))
        ws.update_cell(cell.row, 6, "Paid")
        return force_refresh()
    except: return False

def delete_invoice(invoice_id):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws_trans = sh.worksheet("Transactions")
    try: ws_trans.delete_rows(ws_trans.find(str(invoice_id)).row)
    except: pass
    ws_items = sh.worksheet("TransactionItems")
    try:
        while True: ws_items.delete_rows(ws_items.find(str(invoice_id)).row)
    except: pass
    return force_refresh()

def update_customer_details(cust_id, new_name, address, phone, notes):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Customers")
    try:
        cell = ws.find(cust_id)
        ws.update_cell(cell.row, 2, new_name)
        ws.update_cell(cell.row, 4, phone)
        ws.update_cell(cell.row, 6, address)
        ws.update_cell(cell.row, 7, notes)
        return force_refresh()
    except: return False

def delete_customer(cust_id):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Customers")
    try:
        ws.delete_rows(ws.find(cust_id).row)
        return force_refresh()
    except: return False

def sell_gift_certificate(giver_id, receiver_id, amount, pay_method):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    
    # Invoice ID
    ws_set = sh.worksheet("Settings")
    try:
        cell = ws_set.find("NextInvoiceID")
        current_id = int(ws_set.cell(cell.row, cell.col + 1).value)
        ws_set.update_cell(cell.row, cell.col + 1, current_id + 1)
        invoice_id = str(current_id)
    except: invoice_id = f"INV-{datetime.now().strftime('%H%M%S')}"

    date_now = datetime.now()
    ws_cust = sh.worksheet("Customers")
    try: receiver_name = ws_cust.cell(ws_cust.find(receiver_id).row, 2).value
    except: receiver_name = "Unknown"

    sh.worksheet("Transactions").append_row([
        invoice_id, date_now.strftime("%Y-%m-%d %H:%M:%S"), amount, pay_method, 
        giver_id, "Paid", date_now.strftime("%Y-%m-%d"), 0.0, "FALSE"
    ])
    sh.worksheet("TransactionItems").append_row([
        invoice_id, "GIFT-CERT", 1, amount, f"Gift Certificate for {receiver_name}"
    ])
    
    try:
        cell = ws_cust.find(receiver_id)
        curr = float(ws_cust.cell(cell.row, 8).value or 0)
        ws_cust.update_cell(cell.row, 8, curr + amount)
    except: pass

    force_refresh()
    return invoice_id

def update_settings(updates_dict):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Settings")
    data = ws.get_all_records()
    key_map = {row['Key']: i + 2 for i, row in enumerate(data)}
    for key, new_val in updates_dict.items():
        if key in key_map: ws.update_cell(key_map[key], 2, new_val)
        else: ws.append_row([key, new_val])
    return force_refresh()

def add_expense(date, category, amount, description):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Expenses")
    ws.append_row([str(date), category, f"{float(amount):.3f}", description])
    return force_refresh()

# --- PDF GENERATOR ---
def create_pdf(invoice_id, customer_name, company_address, cart, subtotal, tax, total, due_date, credit_applied=0.0):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20); pdf.cell(0, 10, "Notion to Sew", ln=True)
    pdf.set_font("Helvetica", "", 10)
    for line in company_address.split("\n"): pdf.cell(0, 5, line.strip(), ln=True)
    pdf.ln(10)
    pdf.set_font("Helvetica", "B", 12); pdf.cell(0, 10, f"INVOICE #{invoice_id}", ln=True, align='R')
    pdf.set_font("Helvetica", "", 10); pdf.cell(0, 5, f"Date: {datetime.now().strftime('%Y-%m-%d')}", ln=True, align='R')
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
    pdf.cell(165, 6, "Tax:", 0, 0, 'R'); pdf.cell(25, 6, f"${tax:.2f}", 0, 1, 'R')
    if credit_applied > 0:
        pdf.cell(165, 6, "Store Credit Used:", 0, 0, 'R'); pdf.cell(25, 6, f"-${credit_applied:.2f}", 0, 1, 'R')
    pdf.set_font("Helvetica", "B", 12); pdf.cell(165, 8, "AMOUNT DUE:", 0, 0, 'R'); pdf.cell(25, 8, f"${max(0.0, total - credit_applied):.2f}", 0, 1, 'R')
    return pdf.output(dest='S').encode('latin-1')

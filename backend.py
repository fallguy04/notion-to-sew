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
    scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"]
    creds = Credentials.from_service_account_info(st.secrets["gcp_service_account"], scopes=scopes)
    return gspread.authorize(creds)

@st.cache_data(ttl=600)
def get_data():
    client = get_client()
    try:
        sh = client.open("NotionToSew_DB")
        data = {
            "inventory": pd.DataFrame(sh.worksheet("Inventory").get_all_records()),
            "transactions": pd.DataFrame(sh.worksheet("Transactions").get_all_records()),
            "items": pd.DataFrame(sh.worksheet("TransactionItems").get_all_records()),
            "customers": pd.DataFrame(sh.worksheet("Customers").get_all_records()),
            "settings": pd.DataFrame(sh.worksheet("Settings").get_all_records()),
            "expenses": pd.DataFrame(sh.worksheet("Expenses").get_all_records())
        }
        if 'Wholesale' not in data['transactions'].columns:
            data['transactions']['Wholesale'] = "FALSE"
        if 'Cost' not in data['inventory'].columns:
            data['inventory']['Cost'] = 0.0
        return data
    except Exception as e:
        return {}

def force_refresh():
    get_data.clear()
    return True

# --- HELPER: FIND COLUMN ---
def get_col_index(worksheet, header_name):
    headers = worksheet.row_values(1)
    try: return headers.index(header_name) + 1
    except ValueError: return None

# --- INVENTORY ---
def add_inventory_item(sku, name, price, stock, wholesale_price, cost):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Inventory")
    headers = ws.row_values(1)
    new_row = [""] * len(headers)
    map_dict = {"SKU": sku, "Name": name, "Price": price, "StockQty": stock, "WholesalePrice": wholesale_price, "Cost": cost}
    for col_name, val in map_dict.items():
        if col_name in headers:
            idx = headers.index(col_name)
            new_row[idx] = val
    ws.append_row(new_row)
    return force_refresh()

def restock_inventory(sku, qty_to_add, new_unit_cost):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Inventory")
    try: cell = ws.find(str(sku)); row = cell.row
    except: return False, "SKU not found"
    
    col_stock = get_col_index(ws, "StockQty")
    col_cost = get_col_index(ws, "Cost")
    if not col_stock: return False, "StockQty col missing"
    
    curr_stock = int(ws.cell(row, col_stock).value or 0)
    if col_cost:
        try: curr_cost = float(ws.cell(row, col_cost).value or 0)
        except: curr_cost = 0.0
        total_qty = curr_stock + qty_to_add
        if total_qty > 0:
            new_avg = ((curr_stock * curr_cost) + (qty_to_add * new_unit_cost)) / total_qty
        else: new_avg = new_unit_cost
        ws.update_cell(row, col_cost, new_avg)
    
    ws.update_cell(row, col_stock, curr_stock + qty_to_add)
    force_refresh()
    return True, f"New Stock: {curr_stock + qty_to_add}"

def update_inventory_batch(df_changes):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Inventory")
    headers = [df_changes.columns.tolist()]
    values = df_changes.astype(str).values.tolist()
    ws.clear(); ws.update(values=headers + values, range_name="A1")
    return force_refresh()

# --- CUSTOMERS & SALES ---
def add_customer(name, email):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    ws = sh.worksheet("Customers")
    new_id = f"C-{str(uuid.uuid4())[:5]}"
    ws.append_row([new_id, name, email, "", datetime.now().strftime("%Y-%m-%d"), "", "", 0.0])
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
    try: ws.delete_rows(ws.find(cust_id).row); return force_refresh()
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
    except: invoice_id = f"GC-{datetime.now().strftime('%H%M%S')}"

    date_now = datetime.now()
    
    # Add Transaction (Giver pays)
    ws_trans = sh.worksheet("Transactions")
    # Check if 'Wholesale' header exists
    if "Wholesale" not in ws_trans.row_values(1): ws_trans.update_cell(1, 9, "Wholesale")
    
    ws_trans.append_row([
        invoice_id, date_now.strftime("%Y-%m-%d %H:%M:%S"), amount, pay_method, 
        giver_id, "Paid", date_now.strftime("%Y-%m-%d"), 0.0, "FALSE"
    ])
    
    # Add Item
    sh.worksheet("TransactionItems").append_row([
        invoice_id, "GIFT-CERT", 1, amount, f"Gift Certificate Credit", 0.0
    ])

    # Add Credit to Receiver
    if receiver_id:
        ws_cust = sh.worksheet("Customers")
        try:
            cell = ws_cust.find(receiver_id)
            col_cred = get_col_index(ws_cust, "Credit") or 8
            curr = float(ws_cust.cell(cell.row, col_cred).value or 0)
            ws_cust.update_cell(cell.row, col_cred, curr + amount)
        except: pass
    
    force_refresh()
    return invoice_id

def commit_sale(cart, total, tax, cust_id, payment_method, is_wholesale, status="Paid", credit_used=0.0):
    client = get_client()
    sh = client.open("NotionToSew_DB")
    
    ws_set = sh.worksheet("Settings")
    try:
        cell = ws_set.find("NextInvoiceID")
        current_id = int(ws_set.cell(cell.row, cell.col + 1).value)
        ws_set.update_cell(cell.row, cell.col + 1, current_id + 1)
        invoice_id = str(current_id)
    except: invoice_id = f"INV-{datetime.now().strftime('%H%M%S')}"

    date_now = datetime.now()
    due = (date_now + timedelta(days=30)).strftime("%Y-%m-%d") if status == "Pending" else ""
    
    ws_trans = sh.worksheet("Transactions")
    if "Wholesale" not in ws_trans.row_values(1): ws_trans.update_cell(1, 9, "Wholesale")
    
    ws_trans.append_row([
        invoice_id, date_now.strftime("%Y-%m-%d %H:%M:%S"), total, payment_method, 
        cust_id, status, due, tax, "TRUE" if is_wholesale else "FALSE"
    ])
    
    df_inv = get_data()['inventory']
    items_rows = []
    for item in cart:
        try:
            row = df_inv[df_inv['SKU'].astype(str) == str(item['sku'])].iloc[0]
            unit_cost = float(row.get('Cost', 0))
        except: unit_cost = 0.0
        items_rows.append([invoice_id, item['sku'], item['qty'], item['price'], item['name'], unit_cost])
    sh.worksheet("TransactionItems").append_rows(items_rows)

    ws_inv = sh.worksheet("Inventory")
    col_stock = get_col_index(ws_inv, "StockQty"); col_sku = get_col_index(ws_inv, "SKU")
    if col_stock and col_sku:
        inv_data = ws_inv.get_all_records()
        sku_map = {str(row['SKU']): i + 2 for i, row in enumerate(inv_data)}
        for item in cart:
            s_key = str(item['sku'])
            if s_key in sku_map:
                row_num = sku_map[s_key]
                curr = int(ws_inv.cell(row_num, col_stock).value or 0)
                ws_inv.update_cell(row_num, col_stock, max(0, curr - item['qty']))
                
    if credit_used > 0 and cust_id:
        ws_cust = sh.worksheet("Customers")
        try:
            cell = ws_cust.find(cust_id)
            col_cred = get_col_index(ws_cust, "Credit") or 8
            curr = float(ws_cust.cell(cell.row, col_cred).value or 0)
            ws_cust.update_cell(cell.row, col_cred, max(0.0, curr - credit_used))
        except: pass
    return invoice_id

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
    ws.append_row([str(date), category, amount, description])
    return force_refresh()

# --- PDF GENERATORS ---
def create_invoice_pdf(invoice_id, customer_name, company_address, cart, subtotal, tax, total, due_date, credit_applied=0.0):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20); pdf.cell(0, 10, "Notion to Sew", ln=True)
    pdf.set_font("Helvetica", "", 10)
    for line in company_address.split("\n"): pdf.cell(0, 5, line.strip(), ln=True)
    pdf.ln(10)
    pdf.set_font("Helvetica", "B", 12); pdf.cell(0, 10, f"INVOICE #{invoice_id}", ln=True, align='R')
    pdf.set_font("Helvetica", "", 10); pdf.cell(0, 5, f"Date: {datetime.now().strftime('%Y-%m-%d')}", ln=True, align='R')
    if due_date: pdf.cell(0, 5, f"Due: {due_date}", ln=True, align='R')
    pdf.ln(5)
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
        pdf.cell(165, 6, "Credit Used:", 0, 0, 'R'); pdf.cell(25, 6, f"-${credit_applied:.2f}", 0, 1, 'R')
    pdf.set_font("Helvetica", "B", 12); pdf.cell(165, 8, "TOTAL:", 0, 0, 'R'); pdf.cell(25, 8, f"${max(0.0, total - credit_applied):.2f}", 0, 1, 'R')
    return pdf.output(dest='S').encode('latin-1')

def create_income_statement_pdf(start_date, end_date, revenue, cogs, expenses_df):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16); pdf.cell(0, 10, "Notion to Sew", ln=True, align='C')
    pdf.set_font("Helvetica", "B", 12); pdf.cell(0, 10, "Income Statement", ln=True, align='C')
    pdf.set_font("Helvetica", "I", 10); pdf.cell(0, 10, f"Period: {start_date} to {end_date}", ln=True, align='C'); pdf.ln(10)
    pdf.set_font("Helvetica", "B", 10); pdf.cell(100, 8, "REVENUE", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(130, 6, "Total Sales", 0, 0); pdf.cell(30, 6, f"{revenue:,.2f}", 0, 1, 'R'); pdf.ln(5)
    pdf.set_font("Helvetica", "B", 10); pdf.cell(100, 8, "COST OF GOODS SOLD", ln=True)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(130, 6, "Cost of Goods", 0, 0); pdf.cell(30, 6, f"{cogs:,.2f}", 0, 1, 'R'); pdf.ln(5)
    gross = revenue - cogs
    pdf.set_font("Helvetica", "B", 11); pdf.cell(130, 8, "GROSS PROFIT:", 0, 0); pdf.cell(30, 8, f"{gross:,.2f}", "T", 1, 'R'); pdf.ln(5)
    pdf.set_font("Helvetica", "B", 10); pdf.cell(100, 8, "EXPENSES", ln=True)
    pdf.set_font("Helvetica", "", 10)
    total_exp = 0.0
    if not expenses_df.empty:
        expenses_df['Amount'] = pd.to_numeric(expenses_df['Amount'], errors='coerce')
        grouped = expenses_df.groupby('Category')['Amount'].sum()
        for cat, amt in grouped.items():
            pdf.cell(130, 6, f"  {cat}", 0, 0); pdf.cell(30, 6, f"{amt:,.2f}", 0, 1, 'R')
            total_exp += amt
    net = gross - total_exp
    pdf.ln(5); pdf.set_font("Helvetica", "B", 14); pdf.cell(130, 10, "NET PROFIT:", 0, 0); pdf.cell(30, 10, f"{net:,.2f}", "TB", 1, 'R')
    return pdf.output(dest='S').encode('latin-1')

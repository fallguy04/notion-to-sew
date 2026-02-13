import streamlit as st
import pandas as pd
import backend as db
from datetime import datetime, date
import base64
import time

# --- CONFIG ---
st.set_page_config(page_title="Notion to Sew ERP", layout="wide", page_icon="🧵")

# --- CUSTOM CSS ---
st.markdown("""
<style>
    .stApp { background-color: #f8f9fa; }
    div[data-testid="stMetric"], div[data-testid="stContainer"] {
        background-color: #ffffff;
        border: 1px solid #e0e0e0;
        padding: 15px;
        border-radius: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    .stButton button { border-radius: 5px; }
    /* Big Buttons for Kiosk Mode */
    .big-btn button { height: 60px !important; font-size: 22px !important; }
</style>
""", unsafe_allow_html=True)

# --- INIT STATE ---
if 'data' not in st.session_state:
    with st.spinner("Connecting to Headquarters..."):
        st.session_state['data'] = db.get_data()
if 'cart' not in st.session_state: st.session_state['cart'] = []
if 'kiosk_cart' not in st.session_state: st.session_state['kiosk_cart'] = []
if 'last_order_id' not in st.session_state: st.session_state['last_order_id'] = None

# --- HELPER: AUTO REFRESH ---
def auto_refresh():
    if 'data' in st.session_state: del st.session_state['data']
    st.rerun()

# ==========================================
# 🛑 THE GATEKEEPER
# ==========================================
with st.sidebar:
    st.title("🧵 Notion to Sew")
    app_mode = st.radio("Select Mode", ["🛍️ Kiosk (iPad)", "🔐 Admin HQ"], index=1)
    st.divider()
    
    if app_mode == "🔐 Admin HQ":
        password = st.text_input("Admin Password", type="password")
        if password != "1234": 
            st.warning("Enter password to access HQ.")
            st.stop()
    
    if st.button("🔄 Refresh Data"):
        auto_refresh()

# ==========================================
# 🛍️ MODE 1: KIOSK
# ==========================================
if app_mode == "🛍️ Kiosk (iPad)":
    
    if 'kiosk_page' not in st.session_state: st.session_state['kiosk_page'] = 'shop'
    
    def go_shop(): st.session_state['kiosk_page'] = 'shop'
    def go_checkout(): st.session_state['kiosk_page'] = 'checkout'
    
    # --- SUCCESS SCREEN (NEW) ---
    if st.session_state['kiosk_page'] == 'success':
        st.balloons()
        st.title("✅ Order Complete!")
        st.success(f"Transaction recorded: #{st.session_state.get('last_order_id', '???')}")
        
        # Receipt Button
        if 'last_invoice_pdf' in st.session_state:
            b64_pdf = base64.b64encode(st.session_state['last_invoice_pdf']).decode('utf-8')
            pdf_display = f'<iframe src="data:application/pdf;base64,{b64_pdf}" width="100%" height="400"></iframe>'
            with st.expander("📄 View Receipt", expanded=True):
                st.markdown(pdf_display, unsafe_allow_html=True)

        if st.button("🏠 Start New Order", type="primary", use_container_width=True):
            st.session_state['last_order_id'] = None
            go_shop()
            st.rerun()

    # --- PAGE 1: SHOP ---
    elif st.session_state['kiosk_page'] == 'shop':
        c1, c2 = st.columns([4, 1])
        c1.title("Shop Kiosk")
        cart_cnt = sum(i['qty'] for i in st.session_state['kiosk_cart'])
        if c2.button(f"🛒 Cart ({cart_cnt})", type="primary", use_container_width=True):
            go_checkout(); st.rerun()

        st.markdown("### 🔍 Search Inventory")
        df = st.session_state['data']['inventory'].copy()
        df['lookup'] = df['SKU'].astype(str) + " | " + df['Name']
        
        search = st.selectbox("Scan or Type...", df['lookup'], index=None, placeholder="Tap to search...", label_visibility="collapsed")
        
        if search:
            sku = search.split(" | ")[0]
            row = df[df['SKU'].astype(str).str.strip() == sku.strip()].iloc[0]
            
            st.divider()
            with st.container(border=True):
                c_det, c_add = st.columns([2, 1])
                c_det.subheader(row['Name']); c_det.caption(f"SKU: {row['SKU']}")
                c_det.markdown(f"## ${row['Price']:.2f}")
                
                with c_add:
                    q = st.number_input("Qty", 1, 100, 1, key="kq_main")
                    st.write("")
                    if st.button("➕ ADD", type="primary", use_container_width=True):
                        st.session_state['kiosk_cart'].append({"sku": row['SKU'], "name": row['Name'], "price": row['Price'], "qty": q})
                        st.toast(f"Added {q} {row['Name']}")
                        time.sleep(0.5); st.rerun()

    # --- PAGE 2: CHECKOUT ---
    elif st.session_state['kiosk_page'] == 'checkout':
        st.title("Checkout")
        if st.button("⬅️ Back"): go_shop(); st.rerun()
        st.divider()
        
        c_list, c_pay = st.columns([1.5, 1])
        with c_list:
            if not st.session_state['kiosk_cart']: st.info("Cart is empty")
            for i, item in enumerate(st.session_state['kiosk_cart']):
                with st.container(border=True):
                    c1, c2 = st.columns([3, 1])
                    c1.write(f"**{item['name']}** ({item['qty']}x)"); c2.button("🗑️", key=f"kd_{i}", on_click=lambda: st.session_state['kiosk_cart'].pop(i) and st.rerun())

        with c_pay:
            sub = sum(i['qty']*i['price'] for i in st.session_state['kiosk_cart'])
            
            # Tax Logic
            if 'settings' in st.session_state['data']:
                s_dict = dict(zip(st.session_state['data']['settings']['Key'], st.session_state['data']['settings']['Value']))
                raw_rate = s_dict.get("TaxRate", "0.08"); venmo = s_dict.get("VenmoUser", "")
                addr = s_dict.get("Address", "Modesto, CA")
            else: raw_rate="0.08"; venmo=""; addr="Modesto, CA"
            
            try: tax_r = float(str(raw_rate).replace("%",""))
            except: tax_r=0.08
            
            tax = sub * tax_r
            total = sub + tax
            
            st.write(f"Sub: ${sub:.2f}"); st.write(f"Tax: ${tax:.2f}")
            st.metric("Total", f"${total:.2f}")
            
            cust_list = st.session_state['data']['customers']['Name']
            sel_cust = st.selectbox("Customer", cust_list, index=None)
            pay = st.radio("Pay Method", ["Cash", "Venmo", "Invoice"], horizontal=True)
            
            if st.button("✅ Finish", type="primary", use_container_width=True):
                if sel_cust:
                    cid = st.session_state['data']['customers'][st.session_state['data']['customers']['Name']==sel_cust].iloc[0]['CustomerID']
                    stat = "Pending" if pay == "Invoice" else "Paid"
                    with st.spinner("Processing..."):
                        new_id = db.commit_sale(st.session_state['kiosk_cart'], total, tax, cid, pay, False, stat)
                        
                        # GENERATE RECEIPT FOR SUCCESS SCREEN
                        pdf_bytes = db.create_invoice_pdf(new_id, sel_cust, addr, st.session_state['kiosk_cart'], sub, tax, total, "Paid")
                        st.session_state['last_invoice_pdf'] = pdf_bytes
                        
                        st.session_state['last_order_id'] = new_id
                        st.session_state['kiosk_cart'] = []
                        
                        # Go to success page instead of auto-refresh
                        st.session_state['kiosk_page'] = 'success'
                        st.rerun()
                else: st.error("Select Customer")

# ==========================================
# 🔐 MODE 2: ADMIN HQ
# ==========================================
elif app_mode == "🔐 Admin HQ":
    
    menu = st.sidebar.radio("HQ Menu", ["📊 Dashboard", "📦 Inventory", "🛒 POS", "👥 Customers", "📝 Reports", "⚙️ Settings"])
    
    # --- 1. DASHBOARD ---
    if menu == "📊 Dashboard":
        st.title("Manager Dashboard")
        df = st.session_state['data']['transactions']
        today = date.today(); start = date(today.year, today.month, 1)
        c1, c2 = st.columns(2)
        d1 = c1.date_input("From", start); d2 = c2.date_input("To", today)
        df['DateObj'] = pd.to_datetime(df['Timestamp']).dt.date
        mask = (df['DateObj'] >= d1) & (df['DateObj'] <= d2)
        df_show = df[mask]
        
        rev = pd.to_numeric(df_show['TotalAmount'], errors='coerce').sum()
        m1, m2 = st.columns(2)
        m1.metric("Revenue", f"${rev:,.2f}")
        m2.metric("Orders", len(df_show))
        st.dataframe(df_show.sort_values("Timestamp", ascending=False).head(10), use_container_width=True, hide_index=True)

    # --- 2. INVENTORY (UPDATED WITH RESTOCK) ---
    elif menu == "📦 Inventory":
        st.title("Inventory")
        t1, t2, t3 = st.tabs(["📋 Edit List", "➕ Add New Item", "🚚 Restock (Add Qty)"])
        
        with t1:
            df_inv = st.session_state['data']['inventory']
            edited = st.data_editor(df_inv, use_container_width=True, num_rows="dynamic")
            if st.button("💾 Save Changes"):
                db.update_inventory_batch(edited); st.success("Saved!"); auto_refresh()
        
        with t2:
            st.subheader("Create Completely New SKU")
            with st.form("new_item"):
                c1, c2 = st.columns(2)
                sku = c1.text_input("SKU")
                name = c2.text_input("Name")
                pr = c1.number_input("Retail Price", 0.0)
                cost = c2.number_input("Unit Cost (For Profit Calc)", 0.0)
                whol = c1.number_input("Wholesale Price", 0.0)
                stk = c2.number_input("Opening Stock", 0)
                if st.form_submit_button("Create New Item"):
                    db.add_inventory_item(sku, name, pr, stk, whol, cost)
                    st.success("Added!"); auto_refresh()

        with t3:
            st.subheader("Restock Existing Item")
            df_inv = st.session_state['data']['inventory']
            df_inv['lookup'] = df_inv['SKU'].astype(str) + " | " + df_inv['Name']
            
            sel_restock = st.selectbox("Select Item to Restock", df_inv['lookup'])
            
            if sel_restock:
                sku_r = sel_restock.split(" | ")[0]
                row_r = df_inv[df_inv['SKU'].astype(str) == sku_r].iloc[0]
                
                st.info(f"Current Stock: {row_r['StockQty']} | Current Cost: ${float(row_r.get('Cost',0)):.2f}")
                
                with st.form("restock_form"):
                    c1, c2 = st.columns(2)
                    qty_add = c1.number_input("Quantity Arrived", 1, 10000)
                    new_cost = c2.number_input("New Unit Cost ($)", 0.0, 1000.0, float(row_r.get('Cost', 0)))
                    
                    if st.form_submit_button("🚚 Add Stock"):
                        success, msg = db.restock_inventory(sku_r, qty_add, new_cost)
                        if success: st.success(msg); time.sleep(1); auto_refresh()
                        else: st.error(msg)

    # --- 3. POS (UPDATED WITH SUCCESS SCREEN) ---
    elif menu == "🛒 POS":
        st.title("Point of Sale")
        
        # CHECK IF ORDER JUST COMPLETED
        if st.session_state.get('last_order_id'):
            st.balloons()
            st.success(f"Order #{st.session_state['last_order_id']} Completed!")
            
            if 'last_invoice_pdf' in st.session_state:
                b64_pdf = base64.b64encode(st.session_state['last_invoice_pdf']).decode('utf-8')
                pdf_display = f'<iframe src="data:application/pdf;base64,{b64_pdf}" width="100%" height="500"></iframe>'
                st.markdown(pdf_display, unsafe_allow_html=True)
            
            if st.button("Start Next Order", type="primary"):
                st.session_state['last_order_id'] = None
                st.rerun()
        
        else:
            c1, c2 = st.columns([1.5, 1])
            with c1:
                st.subheader("Add Item")
                is_wholesale = st.checkbox("Apply Wholesale Pricing?", value=False)
                inv = st.session_state['data']['inventory']
                inv['lookup'] = inv['SKU'].astype(str) + " | " + inv['Name']
                selected_item_str = st.selectbox("Search Item", inv['lookup'], index=None)
                
                if selected_item_str:
                    sku_str = selected_item_str.split(" | ")[0].strip()
                    item_row = inv[inv['SKU'].astype(str) == sku_str].iloc[0]
                    with st.container(border=True):
                        base_price = item_row['WholesalePrice'] if is_wholesale and item_row['WholesalePrice'] else item_row['Price']
                        c_qty, c_price = st.columns(2)
                        qty = c_qty.number_input("Quantity", 1, 1000, 1)
                        final_price = c_price.number_input("Unit Price ($)", 0.0, 10000.0, float(base_price))
                        if st.button("Add to Cart", type="primary", use_container_width=True):
                            st.session_state['cart'].append({
                                "sku": sku_str, "name": item_row['Name'], "qty": qty, "price": final_price, "total": qty * final_price
                            })
                            st.rerun()

            with c2:
                with st.container(border=True):
                    st.subheader("Order Summary")
                    if not st.session_state['cart']: st.info("Cart is empty.")
                    else:
                        subtotal = sum(item['total'] for item in st.session_state['cart'])
                        for i, item in enumerate(st.session_state['cart']):
                            c_a, c_b = st.columns([3, 1])
                            c_a.write(f"**{item['name']}** ({item['qty']} x ${item['price']:.2f})")
                            c_b.write(f"${item['total']:.2f}")
                        
                        st.divider()
                        
                        if 'settings' in st.session_state['data']:
                            s_df = st.session_state['data']['settings']
                            settings_cache = dict(zip(s_df['Key'], s_df['Value']))
                            raw_rate = settings_cache.get("TaxRate", "0.08")
                            venmo_user = settings_cache.get("VenmoUser", "")
                            addr = settings_cache.get("Address", "Modesto, CA")
                        else: raw_rate = "0.08"; venmo_user = ""; addr="Modesto, CA"
                        
                        try: tax_rate = float(str(raw_rate).replace("%", "").strip())
                        except: tax_rate = 0.08
                        
                        apply_tax = st.checkbox(f"Apply Tax", value=not is_wholesale)
                        tax_amt = subtotal * tax_rate if apply_tax else 0.0
                        cart_total = subtotal + tax_amt
                        
                        # Customer
                        cust = st.session_state['data']['customers']
                        selected_cust_name = st.selectbox("Customer", cust['Name'], index=None)
                        
                        st.write(f"Sub: ${subtotal:.2f}"); st.write(f"Tax: ${tax_amt:.2f}")
                        st.metric("Total Due", f"${cart_total:.2f}")
                        
                        pay_method = st.selectbox("Payment", ["Cash", "Card", "Venmo", "Invoice"])
                        
                        if st.button("✅ Complete Order", type="primary", use_container_width=True):
                            if selected_cust_name:
                                cid = cust[cust['Name']==selected_cust_name].iloc[0]['CustomerID']
                                status = "Pending" if pay_method == "Invoice" else "Paid"
                                with st.spinner("Processing..."):
                                    new_id = db.commit_sale(
                                        st.session_state['cart'], cart_total, tax_amt, cid, 
                                        pay_method, is_wholesale, status
                                    )
                                    
                                    # Generate PDF for View
                                    pdf_bytes = db.create_invoice_pdf(new_id, selected_cust_name, addr, st.session_state['cart'], subtotal, tax_amt, cart_total, "Upon Receipt")
                                    st.session_state['last_invoice_pdf'] = pdf_bytes
                                    st.session_state['last_order_id'] = new_id
                                    st.session_state['cart'] = []
                                    st.rerun()
                            else: st.error("Select Customer")

    # --- 4. CUSTOMERS ---
    elif menu == "👥 Customers":
        st.title("Customers")
        st.info("Use Kiosk Mode or Search Bar in future updates.") 
        # (Keeping this brief to save space, previous logic applies if you want to paste it back)

    # --- 5. REPORTS (UPDATED) ---
    elif menu == "📝 Reports":
        st.title("Financial Reports")
        tab1, tab2, tab3 = st.tabs(["📄 Income Statement", "🏛️ Sales Tax Split", "📉 Expense Log"])
        
        with tab1:
            st.header("Income Statement")
            c1, c2 = st.columns(2)
            d_start = c1.date_input("Start Date", value=date(date.today().year, 1, 1))
            d_end = c2.date_input("End Date", value=date.today())
            
            if st.button("Generate Statement"):
                # Filter Transactions
                df_t = st.session_state['data']['transactions'].copy()
                df_t['DateObj'] = pd.to_datetime(df_t['Timestamp']).dt.date
                df_t = df_t[(df_t['DateObj'] >= d_start) & (df_t['DateObj'] <= d_end)]
                
                revenue = pd.to_numeric(df_t['TotalAmount'], errors='coerce').sum()
                
                # Filter Items for COGS (Using Cost column if available)
                df_i = st.session_state['data']['items'].copy()
                # Join with transactions to filter by date
                df_i['TransactionID'] = df_i['TransactionID'].astype(str)
                df_t['TransactionID'] = df_t['TransactionID'].astype(str)
                merged = df_i.merge(df_t[['TransactionID']], on='TransactionID', how='inner')
                
                # Sum COGS (Cost * Qty)
                # Note: This relies on 'Cost' being in TransactionItems. If empty, it's 0.
                if 'Cost' in merged.columns:
                    merged['CostTotal'] = pd.to_numeric(merged['Cost'], errors='coerce') * pd.to_numeric(merged['QtySold'], errors='coerce')
                    cogs = merged['CostTotal'].sum()
                else:
                    cogs = 0.0
                    st.warning("⚠️ No 'Cost' data found in sales items. COGS is $0.")

                # Filter Expenses
                df_e = st.session_state['data']['expenses'].copy()
                if not df_e.empty:
                    df_e['DateObj'] = pd.to_datetime(df_e['Date']).dt.date
                    df_e = df_e[(df_e['DateObj'] >= d_start) & (df_e['DateObj'] <= d_end)]
                
                pdf_data = db.create_income_statement_pdf(str(d_start), str(d_end), revenue, cogs, df_e)
                b64 = base64.b64encode(pdf_data).decode('utf-8')
                st.markdown(f'<iframe src="data:application/pdf;base64,{b64}" width="100%" height="600"></iframe>', unsafe_allow_html=True)

        with tab2:
            st.header("Sales Tax Report")
            c1, c2 = st.columns(2)
            t_start = c1.date_input("Start", value=date(date.today().year, 1, 1), key="tax_s")
            t_end = c2.date_input("End", value=date.today(), key="tax_e")
            
            df_t = st.session_state['data']['transactions'].copy()
            df_t['DateObj'] = pd.to_datetime(df_t['Timestamp']).dt.date
            df_t = df_t[(df_t['DateObj'] >= t_start) & (df_t['DateObj'] <= t_end)]
            
            # SPLIT LOGIC
            # Wholesale column is "TRUE" string or "FALSE" string
            retail_sales = df_t[df_t['Wholesale'] == "FALSE"]
            whole_sales = df_t[df_t['Wholesale'] == "TRUE"]
            
            ret_rev = pd.to_numeric(retail_sales['TotalAmount'], errors='coerce').sum()
            whol_rev = pd.to_numeric(whole_sales['TotalAmount'], errors='coerce').sum()
            tax_coll = pd.to_numeric(df_t['TaxAmount'], errors='coerce').sum()
            
            c1, c2, c3 = st.columns(3)
            c1.metric("Retail Sales (Taxable)", f"${ret_rev:,.2f}")
            c2.metric("Wholesale (Non-Taxable)", f"${whol_rev:,.2f}")
            c3.metric("Tax Collected", f"${tax_coll:,.2f}")

        with tab3:
            st.subheader("Log Expense")
            with st.form("exp_form"):
                d = st.date_input("Date")
                cat = st.selectbox("Category", ["Fabric", "Notions", "Advertising", "Office Supplies", "Rent", "Owner's Draw", "Other"])
                amt = st.number_input("Amount", 0.0)
                desc = st.text_input("Description")
                if st.form_submit_button("Log Expense"):
                    db.add_expense(d, cat, amt, desc)
                    st.success("Logged!"); auto_refresh()

    # --- 6. SETTINGS ---
    elif menu == "⚙️ Settings":
        st.title("Settings")
        st.info("Edit Tax Rate and Address here.")

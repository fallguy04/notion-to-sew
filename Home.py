import streamlit as st
import pandas as pd
import backend as db
from datetime import datetime, date
import base64
import time

st.set_page_config(page_title="Notion to Sew ERP", layout="wide", page_icon="🧵")
st.markdown("""<style>.stApp { background-color: #f8f9fa; } 
div[data-testid="stMetric"], div[data-testid="stContainer"] { background-color: #ffffff; border: 1px solid #e0e0e0; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); } 
.stButton button { border-radius: 5px; } .big-btn button { height: 60px !important; font-size: 22px !important; }</style>""", unsafe_allow_html=True)

if 'data' not in st.session_state:
    with st.spinner("Connecting..."): st.session_state['data'] = db.get_data()
if 'cart' not in st.session_state: st.session_state['cart'] = []
if 'kiosk_cart' not in st.session_state: st.session_state['kiosk_cart'] = []
if 'last_order_id' not in st.session_state: st.session_state['last_order_id'] = None
if 'admin_unlocked' not in st.session_state: st.session_state['admin_unlocked'] = False

def auto_refresh():
    if 'data' in st.session_state: del st.session_state['data']
    st.rerun()

with st.sidebar:
    st.title("🧵 Notion to Sew")
    app_mode = st.radio("Select Mode", ["🛍️ Kiosk (iPad)", "🔐 Admin HQ"], index=1)
    st.divider()
    if app_mode == "🔐 Admin HQ":
        if not st.session_state['admin_unlocked']:
            password = st.text_input("Enter Admin Password", type="password")
            if password == "1234": st.session_state['admin_unlocked'] = True; st.rerun()
            elif password: st.error("Incorrect."); st.stop()
        else:
            if st.button("🔒 Lock Admin"): st.session_state['admin_unlocked'] = False; st.rerun()
    if st.button("🔄 Refresh Data"): auto_refresh()

# --- HELPER: GENERATE VIEWABLE PDF ---
def show_pdf_viewer(pdf_bytes):
    b64 = base64.b64encode(pdf_bytes).decode('utf-8')
    st.download_button("⬇️ Download PDF", pdf_bytes, file_name=f"Invoice.pdf", mime="application/pdf")
    with st.expander("📄 Preview Invoice", expanded=True):
        st.markdown(f'<iframe src="data:application/pdf;base64,{b64}" width="100%" height="500"></iframe>', unsafe_allow_html=True)

# ==========================================
# 🛍️ MODE 1: THE KIOSK
# ==========================================
if app_mode == "🛍️ Kiosk (iPad)":
    # --- KIOSK LOGIC (Simplified for Single File) ---
    if 'page' not in st.session_state: st.session_state['page'] = 'shop'
    
    def go_shop(): st.session_state['page'] = 'shop'
    def go_checkout(): st.session_state['page'] = 'checkout'
    
    # HEADER
    c1, c2 = st.columns([4, 1])
    c1.title("Shop Kiosk")
    cart_count = sum(item['qty'] for item in st.session_state['kiosk_cart'])
    if c2.button(f"🛒 Cart ({cart_count})", type="primary", use_container_width=True):
        go_checkout(); st.rerun()

    # KIOSK PAGE 1: SHOP
    if st.session_state['page'] == 'shop':
        st.markdown("### 🔍 Scan or Search")
        df = st.session_state['data']['inventory'].copy()
        df['lookup'] = df['SKU'].astype(str) + " | " + df['Name']
        
        # Search Box
        search = st.selectbox("Find Item...", df['lookup'], index=None, placeholder="Tap to search...", label_visibility="collapsed")
        
        if search:
            sku = search.split(" | ")[0]
            row = df[df['SKU'].astype(str).str.strip() == sku.strip()].iloc[0]
            
            # Big Item Card
            st.divider()
            with st.container(border=True):
                c_img, c_det, c_add = st.columns([1, 2, 2])
                c_det.subheader(row['Name']); c_det.caption(f"SKU: {row['SKU']}")
                c_det.markdown(f"## ${row['Price']:.2f}")
                
                with c_add:
                    q = st.number_input("Qty", 1, 100, 1, key="k_q_main")
                    st.write("")
                    if st.button("➕ ADD TO CART", type="primary", use_container_width=True):
                        st.session_state['kiosk_cart'].append({
                            "sku": row['SKU'], "name": row['Name'], 
                            "price": row['Price'], "qty": q
                        })
                        st.toast(f"Added {q} {row['Name']}")
                        time.sleep(0.5); st.rerun()

    # KIOSK PAGE 2: CHECKOUT
    elif st.session_state['page'] == 'checkout':
        st.title("Checkout")
        if st.button("⬅️ Back to Shop"): go_shop(); st.rerun()
        st.divider()
        
        c_list, c_pay = st.columns([1.5, 1])
        
        with c_list:
            if not st.session_state['kiosk_cart']: st.info("Empty Cart")
            for i, item in enumerate(st.session_state['kiosk_cart']):
                with st.container(border=True):
                    cl1, cl2, cl3 = st.columns([3, 1, 1])
                    cl1.write(f"**{item['name']}** ({item['qty']}x)")
                    cl2.write(f"${item['qty']*item['price']:.2f}")
                    if cl3.button("🗑️", key=f"kdel_{i}"):
                        st.session_state['kiosk_cart'].pop(i); st.rerun()

        with c_pay:
            subtotal = sum(item['qty']*item['price'] for item in st.session_state['kiosk_cart'])
            
            # Tax Logic
            if 'settings' in st.session_state['data']:
                s_df = st.session_state['data']['settings']
                s_dict = dict(zip(s_df['Key'], s_df['Value']))
                raw_rate = s_dict.get("TaxRate", "0.08"); venmo = s_dict.get("VenmoUser", "")
            else: raw_rate = "0.08"; venmo = ""
            try: tax_rate = float(str(raw_rate).replace("%",""))/100 if float(str(raw_rate).replace("%",""))>1 else float(str(raw_rate).replace("%",""))
            except: tax_rate=0.0
            
            tax = subtotal * tax_rate
            total = subtotal + tax
            
            st.write(f"Subtotal: ${subtotal:.2f}"); st.write(f"Tax: ${tax:.2f}")
            st.metric("Total", f"${total:.2f}")
            
            # Customer
            cust_list = st.session_state['data']['customers']['Name']
            sel_cust = st.selectbox("Customer Name", cust_list, index=None)
            
            # Pay
            pay = st.radio("Method", ["Cash", "Venmo", "Invoice"], horizontal=True)
            if pay == "Venmo" and venmo:
                st.image(f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://venmo.com/u/{venmo}", width=120)

            if st.button("✅ Finish", type="primary", use_container_width=True):
                if sel_cust:
                    cid = st.session_state['data']['customers'][st.session_state['data']['customers']['Name']==sel_cust].iloc[0]['CustomerID']
                    status = "Pending" if pay == "Invoice" else "Paid"
                    with st.spinner("Processing..."):
                        new_id = db.commit_sale(st.session_state['kiosk_cart'], total, tax, cid, pay, False, status)
                        st.session_state['kiosk_cart'] = []
                        st.success("Done!"); time.sleep(2); go_shop(); auto_refresh()
                else: st.error("Select Customer")

elif app_mode == "🔐 Admin HQ":
    menu = st.sidebar.radio("HQ Menu", ["📊 Dashboard", "📦 Inventory", "🛒 POS", "👥 Customers", "📝 Reports", "⚙️ Settings"])
    
    # --- RESTORED: DASHBOARD (WITH NAMES) ---
    if menu == "📊 Dashboard":
        st.title("Manager Dashboard")
        df_trans = st.session_state['data']['transactions'].copy()
        df_cust = st.session_state['data']['customers'].copy()
        
        # Merge to get Names
        if not df_trans.empty and not df_cust.empty:
            df_trans['CustomerID'] = df_trans['CustomerID'].astype(str)
            df_cust['CustomerID'] = df_cust['CustomerID'].astype(str)
            merged = df_trans.merge(df_cust[['CustomerID', 'Name']], on='CustomerID', how='left')
            merged['Name'] = merged['Name'].fillna("Walk-in/Unknown")
        else: merged = df_trans
        
        today = date.today(); start = date(today.year, today.month, 1)
        c1, c2 = st.columns(2)
        d1 = c1.date_input("From", start); d2 = c2.date_input("To", today)
        merged['DateObj'] = pd.to_datetime(merged['Timestamp']).dt.date
        df_show = merged[(merged['DateObj'] >= d1) & (merged['DateObj'] <= d2)]
        
        rev = pd.to_numeric(df_show['TotalAmount'], errors='coerce').sum()
        m1, m2 = st.columns(2)
        m1.metric("Revenue", f"${rev:,.2f}")
        m2.metric("Orders", len(df_show))
        
        st.subheader("Recent Activity")
        disp_cols = ['Timestamp', 'Name', 'TotalAmount', 'Status', 'TransactionID']
        st.dataframe(df_show[disp_cols].sort_values("Timestamp", ascending=False).head(10), use_container_width=True, hide_index=True)

    elif menu == "📦 Inventory":
        st.title("Inventory")
        t1, t2, t3 = st.tabs(["📋 Edit List", "➕ Add New Item", "🚚 Restock"])
        with t1:
            df_inv = st.session_state['data']['inventory']
            edited = st.data_editor(df_inv, use_container_width=True, num_rows="dynamic")
            if st.button("💾 Save Changes"): db.update_inventory_batch(edited); st.success("Saved!"); auto_refresh()
        with t2:
            st.subheader("New SKU")
            with st.form("new_item"):
                c1, c2 = st.columns(2)
                sku = c1.text_input("SKU"); name = c2.text_input("Name")
                pr = c1.number_input("Retail Price", 0.0); cost = c2.number_input("Unit Cost", 0.0)
                whol = c1.number_input("Wholesale Price", 0.0); stk = c2.number_input("Opening Stock", 0)
                if st.form_submit_button("Create"): db.add_inventory_item(sku, name, pr, stk, whol, cost); st.success("Added!"); auto_refresh()
        with t3:
            st.subheader("Restock")
            df_inv = st.session_state['data']['inventory']
            df_inv['lookup'] = df_inv['SKU'].astype(str) + " | " + df_inv['Name']
            sel_restock = st.selectbox("Select Item", df_inv['lookup'])
            if sel_restock:
                sku_r = sel_restock.split(" | ")[0]
                row_r = df_inv[df_inv['SKU'].astype(str) == sku_r].iloc[0]
                try: raw_cost = str(row_r.get('Cost', 0)).replace('$', '').replace(',', ''); curr_cost = float(raw_cost) if raw_cost else 0.0
                except: curr_cost = 0.0
                st.info(f"Current Stock: {row_r['StockQty']} | Cost: ${curr_cost:.2f}")
                with st.form("restock_form"):
                    c1, c2 = st.columns(2)
                    qty_add = c1.number_input("Quantity Arrived", 1, 10000)
                    new_cost = c2.number_input("New Unit Cost ($)", 0.0, 1000.0, curr_cost)
                    if st.form_submit_button("🚚 Add Stock"):
                        success, msg = db.restock_inventory(sku_r, qty_add, new_cost)
                        if success: st.success(msg); time.sleep(1); auto_refresh()
                        else: st.error(msg)

    elif menu == "🛒 POS":
        st.title("Point of Sale")
        c1, c2 = st.columns([1.5, 1])
        with c1:
            st.subheader("Add Item")
            inv = st.session_state['data']['inventory']
            inv['lookup'] = inv['SKU'].astype(str) + " | " + inv['Name']
            selected_item_str = st.selectbox("Search Item", inv['lookup'], index=None)
            is_wholesale = st.checkbox("Apply Wholesale Pricing?", value=False)
            if selected_item_str:
                sku_str = selected_item_str.split(" | ")[0].strip()
                item_row = inv[inv['SKU'].astype(str) == sku_str].iloc[0]
                with st.container(border=True):
                    base_price = item_row['WholesalePrice'] if is_wholesale and item_row['WholesalePrice'] else item_row['Price']
                    c_qty, c_price = st.columns(2)
                    qty = c_qty.number_input("Quantity", 1, 1000, 1)
                    final_price = c_price.number_input("Unit Price ($)", 0.0, 10000.0, float(base_price))
                    if st.button("Add to Cart", type="primary", use_container_width=True):
                        st.session_state['cart'].append({"sku": sku_str, "name": item_row['Name'], "qty": qty, "price": final_price, "total": qty * final_price}); st.rerun()

        with c2:
            st.subheader("Summary")
            if not st.session_state['cart']: st.info("Cart is empty.")
            else:
                sub = sum(item['total'] for item in st.session_state['cart'])
                for i, item in enumerate(st.session_state['cart']):
                    c_a, c_b = st.columns([3, 1]); c_a.write(f"**{item['name']}** ({item['qty']}x)"); c_b.write(f"${item['total']:.2f}")
                st.divider()
                if 'settings' in st.session_state['data']:
                    s_dict = dict(zip(st.session_state['data']['settings']['Key'], st.session_state['data']['settings']['Value']))
                    raw_rate = s_dict.get("TaxRate", "0.08"); addr = s_dict.get("Address", "Modesto, CA")
                else: raw_rate = "0.08"; addr="Modesto, CA"
                try: tax_rate = float(str(raw_rate).replace("%", "").strip())
                except: tax_rate = 0.08
                
                apply_tax = st.checkbox(f"Apply Tax", value=not is_wholesale)
                tax_amt = sub * tax_rate if apply_tax else 0.0
                total = sub + tax_amt
                
                cust = st.session_state['data']['customers']
                sel_cust = st.selectbox("Customer", cust['Name'], index=None)
                pay = st.selectbox("Payment", ["Cash", "Card", "Venmo", "Invoice"])
                st.metric("Total Due", f"${total:.2f}")
                
                if st.button("✅ Complete Order", type="primary", use_container_width=True):
                    if sel_cust:
                        cid = cust[cust['Name']==sel_cust].iloc[0]['CustomerID']
                        stat = "Pending" if pay == "Invoice" else "Paid"
                        with st.spinner("Processing..."):
                            new_id = db.commit_sale(st.session_state['cart'], total, tax_amt, cid, pay, is_wholesale, stat)
                            pdf_bytes = db.create_invoice_pdf(new_id, sel_cust, addr, st.session_state['cart'], sub, tax_amt, total, "Upon Receipt")
                            st.session_state['last_invoice_pdf'] = pdf_bytes
                            st.session_state['last_order_id'] = new_id
                            st.session_state['cart'] = []
                            st.rerun()
                    else: st.error("Select Customer")

        if st.session_state.get('last_order_id'):
            st.success(f"Order #{st.session_state['last_order_id']} Completed!")
            if 'last_invoice_pdf' in st.session_state: show_pdf_viewer(st.session_state['last_invoice_pdf'])

    # ==========================================
    # 4. CUSTOMERS (CRM & GIFT CARDS)
    # ==========================================
    elif menu == "👥 Customers":
        st.title("Customer Management")
        
        df_cust = st.session_state['data']['customers']
        df_trans = st.session_state['data']['transactions']
        df_items = st.session_state['data']['items']
        
        # --- 1. ADD NEW CUSTOMER ---
        with st.expander("➕ Register New Customer"):
            with st.form("add_cust_admin"):
                c_new1, c_new2 = st.columns(2)
                new_n = c_new1.text_input("Full Name")
                new_e = c_new2.text_input("Email")
                if st.form_submit_button("Create Profile"):
                    if new_n:
                        db.add_customer(new_n, new_e)
                        st.success(f"Created profile for {new_n}!")
                        st.rerun()
                    else:
                        st.error("Name is required.")
    
        st.divider()
    
        # --- 2. SEARCH & SELECT ---
        # Helper: Smart Phone Formatting
        def format_us_phone(phone_raw):
            digits = ''.join(filter(str.isdigit, str(phone_raw)))
            if len(digits) == 10: return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
            return str(phone_raw)
    
        def format_lookup(row):
            phone = format_us_phone(row['Phone'])
            if phone: return f"{row['Name']} | {phone}"
            return row['Name']
            
        df_cust['lookup'] = df_cust.apply(format_lookup, axis=1)
        
        selected_lookup = st.selectbox(
            "🔍 Find Customer Profile", 
            df_cust['lookup'], 
            index=None, 
            placeholder="Type name or phone..."
        )
        
        # --- ROSTER VIEW (Default) ---
        if not selected_lookup:
            st.info("👆 Search above to manage a specific profile, or view the roster below.")
            
            df_display = df_cust.copy()
            df_display['Credit'] = pd.to_numeric(df_display['Credit'], errors='coerce').fillna(0)
            df_display['Phone'] = df_display['Phone'].apply(format_us_phone)
            
            st.dataframe(
                df_display[['Name', 'Phone', 'Email', 'Credit', 'Joined']],
                use_container_width=True,
                column_config={
                    "Credit": st.column_config.NumberColumn(format="$%.2f"),
                },
                hide_index=True
            )
    
        # --- PROFILE VIEW ---
        else:
            name_only = selected_lookup.split(" | ")[0].strip()
            mask = df_cust['Name'] == name_only
            
            if not df_cust[mask].empty:
                row = df_cust[mask].iloc[0]
                cid = row['CustomerID']
                
                col1, col2 = st.columns([1, 1.5])
                
                # LEFT: Edit Profile
                with col1:
                    with st.container(border=True):
                        st.subheader("Edit Profile")
                        
                        with st.form(f"edit_{cid}"):
                            u_name = st.text_input("Name", value=row['Name'])
                            u_phone = st.text_input("Phone", value=str(row.get('Phone', "")))
                            u_addr = st.text_area("Address", value=str(row.get('Address', "")))
                            u_notes = st.text_area("Notes", value=str(row.get('Notes', "")))
                            
                            if st.form_submit_button("💾 Save Profile Changes"):
                                db.update_customer_details(cid, u_name, u_addr, u_phone, u_notes)
                                st.success("Saved!")
                                st.rerun()
    
                        # DELETE CUSTOMER LOGIC
                        st.write("")
                        with st.expander("🗑️ Danger Zone"):
                            st.warning("Deleting this customer cannot be undone.")
                            confirm_del = st.checkbox(f"I understand, delete {row['Name']}", key=f"del_confirm_{cid}")
                            if confirm_del:
                                if st.button("Delete Profile Permanently", type="primary"):
                                    db.delete_customer(cid)
                                    st.success("Profile Deleted.")
                                    st.rerun()
    
                    st.divider()
                    
                    # Credit Logic
                    try: raw_cred = float(row.get('Credit', 0) if row.get('Credit') != "" else 0)
                    except: raw_cred = 0.0
                    st.metric("Store Credit Balance", f"${raw_cred:,.2f}")
                    
                    with st.expander("🎁 Sell Gift Certificate"):
                        giver_lookup = st.selectbox("Who is paying?", ["Self (Same Person)"] + list(df_cust['Name']), index=0)
                        gc_amount = st.number_input("Amount ($)", 0.0, 5000.0, 50.0, step=10.0)
                        gc_pay_method = st.selectbox("Payment Method", ["Cash", "Card", "Venmo", "Check"])
                        
                        if st.button("💸 Add Credit", type="primary"):
                            if giver_lookup == "Self (Same Person)":
                                giver_id = cid
                            else:
                                giver_row = df_cust[df_cust['Name'] == giver_lookup].iloc[0]
                                giver_id = giver_row['CustomerID']
                            
                            with st.spinner("Processing..."):
                                db.sell_gift_certificate(giver_id, cid, gc_amount, gc_pay_method)
                                st.success(f"Added ${gc_amount}!")
                                st.rerun()
    
                # RIGHT: History
                with col2:
                    st.subheader("Purchase History")
                    my_trans = df_trans[df_trans['CustomerID'] == cid]
                    
                    if my_trans.empty:
                        st.info("No purchase history found.")
                    else:
                        my_trans = my_trans.sort_values(by="Timestamp", ascending=False)
                        for i, t_row in my_trans.iterrows():
                            with st.container(border=True):
                                c_date, c_amt, c_stat, c_act = st.columns([1.5, 1, 1, 1.5])
                                
                                c_date.write(f"**{str(t_row['Timestamp'])[:10]}**")
                                c_date.caption(f"#{t_row['TransactionID']}")
                                
                                try: amt_val = float(t_row['TotalAmount'] if t_row['TotalAmount'] != '' else 0)
                                except: amt_val = 0.0
                                c_amt.write(f"**${amt_val:.2f}**")
                                
                                status_clean = str(t_row['Status']).strip().title()
                                is_paid = (status_clean == "Paid")
                                
                                if is_paid: c_stat.success("Paid", icon="✅")
                                else: c_stat.warning("Unpaid", icon="⏳")
                                
                                # ACTION BUTTONS
                                c_v, c_p, c_d = c_act.columns(3)
                                
                                # View
                                if c_v.button("👁️", key=f"v_{t_row['TransactionID']}"):
                                    st.session_state[f"view_inv_{t_row['TransactionID']}"] = True
                                    st.rerun()
                                    
                                # Pay
                                if not is_paid:
                                    if c_p.button("💲", key=f"mp_{t_row['TransactionID']}"):
                                        db.mark_invoice_paid(t_row['TransactionID'])
                                        st.toast("Paid!")
                                        st.rerun()
                                        
                                # Delete Invoice
                                if c_d.button("🗑️", key=f"del_{t_row['TransactionID']}", type="primary"):
                                    db.delete_invoice(t_row['TransactionID'])
                                    st.warning("Invoice Deleted.")
                                    st.rerun()
    
                            # PREVIEWER
                            if st.session_state.get(f"view_inv_{t_row['TransactionID']}", False):
                                with st.container(border=True):
                                    if st.button("❌ Close Preview", key=f"close_{t_row['TransactionID']}"):
                                        st.session_state[f"view_inv_{t_row['TransactionID']}"] = False
                                        st.rerun()
    
                                    t_id = str(t_row['TransactionID'])
                                    df_items['TransactionID'] = df_items['TransactionID'].astype(str)
                                    inv_items = df_items[df_items['TransactionID'] == t_id]
                                    
                                    cart_rebuild = []
                                    for _, item in inv_items.iterrows():
                                        try: q = int(item['QtySold']); p = float(item['Price'])
                                        except: q=1; p=0.0
                                        cart_rebuild.append({"sku": str(item.get('SKU','')), "name": item['Name'], "qty": q, "price": p})
                                    
                                    try: tax_val = float(t_row['TaxAmount'] if t_row['TaxAmount'] != '' else 0)
                                    except: tax_val = 0.0
                                    
                                    if 'settings' in st.session_state['data']:
                                        s_dict = dict(zip(st.session_state['data']['settings']['Key'], st.session_state['data']['settings']['Value']))
                                        addr = s_dict.get("Address", "Modesto, CA")
                                    else: addr = "Modesto, CA"
                                    
                                    pdf_bytes = db.create_pdf(t_id, row['Name'], addr, cart_rebuild, 0, tax_val, amt_val, str(t_row.get('DueDate', '')))
                                    b64_pdf = base64.b64encode(pdf_bytes).decode('utf-8')
                                    st.markdown(f'<iframe src="data:application/pdf;base64,{b64_pdf}" width="100%" height="600"></iframe>', unsafe_allow_html=True)

    elif menu == "📝 Reports":
        st.title("Reports")
        # --- RESTORED: UNPAID & TOP SELLERS ---
        tab1, tab2, tab3, tab4, tab5 = st.tabs(["📄 Income Statement", "🏛️ Tax Report", "📉 Expenses", "⏳ Unpaid Invoices", "🏆 Top Sellers"])
        
        with tab1:
            st.header("Income Statement")
            c1, c2 = st.columns(2)
            d_start = c1.date_input("Start", date(date.today().year, 1, 1))
            d_end = c2.date_input("End", date.today())
            if st.button("Generate"):
                df_t = st.session_state['data']['transactions'].copy(); df_t['DateObj'] = pd.to_datetime(df_t['Timestamp']).dt.date
                df_t = df_t[(df_t['DateObj'] >= d_start) & (df_t['DateObj'] <= d_end)]
                rev = pd.to_numeric(df_t['TotalAmount'], errors='coerce').sum()
                df_i = st.session_state['data']['items'].copy(); df_i['TransactionID'] = df_i['TransactionID'].astype(str); df_t['TransactionID'] = df_t['TransactionID'].astype(str)
                merged = df_i.merge(df_t[['TransactionID']], on='TransactionID', how='inner')
                cogs = (pd.to_numeric(merged['Cost'], errors='coerce') * pd.to_numeric(merged['QtySold'], errors='coerce')).sum() if 'Cost' in merged.columns else 0.0
                df_e = st.session_state['data']['expenses'].copy()
                if not df_e.empty:
                    df_e['DateObj'] = pd.to_datetime(df_e['Date']).dt.date; df_e = df_e[(df_e['DateObj'] >= d_start) & (df_e['DateObj'] <= d_end)]
                pdf_data = db.create_income_statement_pdf(str(d_start), str(d_end), rev, cogs, df_e)
                show_pdf_viewer(pdf_data)

        with tab2:
            st.header("Tax Report")
            c1, c2 = st.columns(2)
            t_start = c1.date_input("Start", date(date.today().year, 1, 1), key="t_s")
            t_end = c2.date_input("End", date.today(), key="t_e")
            df_t = st.session_state['data']['transactions'].copy(); df_t['DateObj'] = pd.to_datetime(df_t['Timestamp']).dt.date
            df_t = df_t[(df_t['DateObj'] >= t_start) & (df_t['DateObj'] <= t_end)]
            if 'Wholesale' not in df_t.columns: df_t['Wholesale'] = "FALSE"
            ret = df_t[df_t['Wholesale'] == "FALSE"]; whl = df_t[df_t['Wholesale'] == "TRUE"]
            c1, c2, c3 = st.columns(3)
            c1.metric("Retail", f"${pd.to_numeric(ret['TotalAmount'], errors='coerce').sum():.2f}")
            c2.metric("Wholesale", f"${pd.to_numeric(whl['TotalAmount'], errors='coerce').sum():.2f}")
            c3.metric("Tax Coll", f"${pd.to_numeric(df_t['TaxAmount'], errors='coerce').sum():.2f}")

        with tab3:
            st.subheader("Log Expense")
            with st.form("ex"):
                d = st.date_input("Date"); c = st.selectbox("Category", ["Fabric", "Notions", "Advertising", "Rent", "Other"])
                a = st.number_input("Amount", 0.0); desc = st.text_input("Desc")
                if st.form_submit_button("Log"): db.add_expense(d, c, a, desc); st.success("Logged"); auto_refresh()
        
        # --- TAB 4: UNPAID ---
        with tab4:
            st.header("Accounts Receivable")
            df_trans = st.session_state['data']['transactions']
            df_cust = st.session_state['data']['customers']
            df_items = st.session_state['data']['items']
            
            pending = df_trans[df_trans['Status'] == 'Pending'].copy()
            
            if pending.empty:
                st.success("🎉 All invoices are paid!")
            else:
                if not df_cust.empty:
                    pending['CustomerID'] = pending['CustomerID'].astype(str)
                    df_cust['CustomerID'] = df_cust['CustomerID'].astype(str)
                    merged = pending.merge(df_cust[['CustomerID', 'Name']], on='CustomerID', how='left')
                else:
                    merged = pending
                    merged['Name'] = "Unknown"
                
                for i, row in merged.iterrows():
                    with st.container(border=True):
                        c1, c2, c3, c4 = st.columns([2, 2, 1, 1.5])
                        cust_name = row['Name'] if pd.notna(row['Name']) else "Unknown"
                        c1.write(f"**{cust_name}**")
                        c1.caption(f"Invoice #{row['TransactionID']}")
                        c2.write(f"Due: {row['DueDate']}")
                        c3.write(f"**${float(row['TotalAmount']):,.2f}**")
                        
                        if c4.button("👁️ View", key=f"v_{row['TransactionID']}"):
                             # Rebuild Cart
                            inv_items = df_items[df_items['TransactionID'] == row['TransactionID']]
                            cart_rebuild = []
                            for _, item in inv_items.iterrows():
                                cart_rebuild.append({
                                    "sku": item['SKU'], "name": item['Name'], 
                                    "qty": int(item['QtySold']), "price": float(item['Price'])
                                })
                            
                            s_df = st.session_state['data']['settings']
                            s_dict = dict(zip(s_df['Key'], s_df['Value']))
                            address = s_dict.get("Address", "Modesto, CA")
                            
                            pdf_bytes = db.create_pdf(
                                row['TransactionID'], cust_name, address, cart_rebuild, 
                                0, float(row['TaxAmount']), float(row['TotalAmount']), row['DueDate']
                            )
                            
                            # Embed
                            base64_pdf = base64.b64encode(pdf_bytes).decode('utf-8')
                            pdf_display = f'<iframe src="data:application/pdf;base64,{base64_pdf}" width="100%" height="600" type="application/pdf"></iframe>'
                            st.markdown(f"### Invoice #{row['TransactionID']}")
                            st.markdown(pdf_display, unsafe_allow_html=True)
                            if st.button("❌ Close Preview", key=f"close_{row['TransactionID']}"): st.rerun()
                        
                        if c4.button("Mark Paid", key=f"pay_{row['TransactionID']}"):
                            if db.mark_invoice_paid(row['TransactionID']):
                                st.balloons()
                                db.get_data.clear()
                                st.rerun()
        
        with tab5:
            st.subheader("Top Selling Items")
            df_i = st.session_state['data']['items']
            df_i['QtySold'] = pd.to_numeric(df_i['QtySold'], errors='coerce')
            top = df_i.groupby('Name')['QtySold'].sum().sort_values(ascending=False).head(10)
            st.bar_chart(top)

    # --- RESTORED: SETTINGS FORM ---
    elif menu == "⚙️ Settings":
        st.title("Settings")
        if 'settings' in st.session_state['data']:
            raw_s = st.session_state['data']['settings']
            s_dict = dict(zip(raw_s['Key'], raw_s['Value']))
        else: s_dict = {}

        with st.form("set_f"):
            c1, c2 = st.columns(2)
            c_name = c1.text_input("Company Name", s_dict.get("CompanyName", "Notion to Sew"))
            c_addr = c1.text_area("Address", s_dict.get("Address", "Modesto, CA"))
            raw_rate = s_dict.get("TaxRate", "0.08")
            try: rate_val = float(str(raw_rate).replace("%","").strip())*100 if float(str(raw_rate).replace("%","").strip()) < 1 else float(str(raw_rate).replace("%","").strip())
            except: rate_val = 8.0
            tax_r = c2.number_input("Tax Rate %", 0.0, 100.0, rate_val)
            venmo = c2.text_input("Venmo User", s_dict.get("VenmoUser", ""))
            next_id = c2.text_input("Next Invoice ID", s_dict.get("NextInvoiceID", "1000"))
            
            if st.form_submit_button("Save Settings"):
                db.update_settings({"CompanyName": c_name, "Address": c_addr, "TaxRate": tax_r/100, "VenmoUser": venmo, "NextInvoiceID": next_id})
                st.success("Saved!"); auto_refresh()

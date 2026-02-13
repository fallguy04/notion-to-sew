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

if app_mode == "🛍️ Kiosk (iPad)":
    # [KIOSK CODE UNCHANGED - Same as before]
    if 'kiosk_page' not in st.session_state: st.session_state['kiosk_page'] = 'shop'
    def go_shop(): st.session_state['kiosk_page'] = 'shop'
    def go_checkout(): st.session_state['kiosk_page'] = 'checkout'
    
    if st.session_state['kiosk_page'] == 'success':
        st.balloons(); st.title("✅ Order Complete!")
        st.success(f"Transaction recorded: #{st.session_state.get('last_order_id', '???')}")
        if 'last_invoice_pdf' in st.session_state: show_pdf_viewer(st.session_state['last_invoice_pdf'])
        if st.button("🏠 Start New Order", type="primary"): st.session_state['last_order_id']=None; go_shop(); st.rerun()

    elif st.session_state['kiosk_page'] == 'shop':
        c1, c2 = st.columns([4, 1])
        c1.title("Shop Kiosk")
        if c2.button(f"🛒 Cart ({sum(i['qty'] for i in st.session_state['kiosk_cart'])})", type="primary"): go_checkout(); st.rerun()
        df = st.session_state['data']['inventory'].copy()
        df['lookup'] = df['SKU'].astype(str) + " | " + df['Name']
        search = st.selectbox("Search", df['lookup'], index=None, placeholder="Tap to search...", label_visibility="collapsed")
        if search:
            sku = search.split(" | ")[0]
            row = df[df['SKU'].astype(str).str.strip() == sku.strip()].iloc[0]
            st.divider()
            with st.container(border=True):
                c_det, c_add = st.columns([2, 1])
                c_det.subheader(row['Name']); c_det.markdown(f"## ${row['Price']:.2f}")
                with c_add:
                    q = st.number_input("Qty", 1, 100, 1, key="kq_main")
                    if st.button("➕ ADD", type="primary"):
                        st.session_state['kiosk_cart'].append({"sku": row['SKU'], "name": row['Name'], "price": row['Price'], "qty": q})
                        st.toast(f"Added {q} {row['Name']}"); time.sleep(0.5); st.rerun()

    elif st.session_state['kiosk_page'] == 'checkout':
        st.title("Checkout"); 
        if st.button("⬅️ Back"): go_shop(); st.rerun()
        c_list, c_pay = st.columns([1.5, 1])
        with c_list:
            for i, item in enumerate(st.session_state['kiosk_cart']):
                with st.container(border=True):
                    c1, c2 = st.columns([3, 1])
                    c1.write(f"**{item['name']}** ({item['qty']}x)"); c2.button("🗑️", key=f"kd_{i}", on_click=lambda: st.session_state['kiosk_cart'].pop(i) and st.rerun())
        with c_pay:
            sub = sum(i['qty']*i['price'] for i in st.session_state['kiosk_cart'])
            if 'settings' in st.session_state['data']:
                s_dict = dict(zip(st.session_state['data']['settings']['Key'], st.session_state['data']['settings']['Value']))
                raw_rate = s_dict.get("TaxRate", "0.08"); addr = s_dict.get("Address", "Modesto, CA")
            else: raw_rate="0.08"; addr="Modesto, CA"
            try: tax_r = float(str(raw_rate).replace("%",""))
            except: tax_r=0.08
            tax = sub * tax_r; total = sub + tax
            st.write(f"Sub: ${sub:.2f}"); st.write(f"Tax: ${tax:.2f}"); st.metric("Total", f"${total:.2f}")
            sel_cust = st.selectbox("Customer", st.session_state['data']['customers']['Name'], index=None)
            pay = st.radio("Method", ["Cash", "Venmo", "Invoice"], horizontal=True)
            if st.button("✅ Finish", type="primary"):
                if sel_cust:
                    cid = st.session_state['data']['customers'][st.session_state['data']['customers']['Name']==sel_cust].iloc[0]['CustomerID']
                    stat = "Pending" if pay == "Invoice" else "Paid"
                    with st.spinner("Processing..."):
                        new_id = db.commit_sale(st.session_state['kiosk_cart'], total, tax, cid, pay, False, stat)
                        pdf_bytes = db.create_invoice_pdf(new_id, sel_cust, addr, st.session_state['kiosk_cart'], sub, tax, total, "Paid")
                        st.session_state['last_invoice_pdf'] = pdf_bytes
                        st.session_state['last_order_id'] = new_id
                        st.session_state['kiosk_cart'] = []; st.session_state['kiosk_page'] = 'success'; st.rerun()
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

    elif menu == "👥 Customers":
        st.title("Customers")
        if 'active_cust_id' not in st.session_state: st.session_state['active_cust_id'] = None
        df_cust = st.session_state['data']['customers']; df_trans = st.session_state['data']['transactions']
        
        if st.session_state['active_cust_id'] is None:
            c_search, c_add = st.columns([3, 1], vertical_alignment="bottom")
            search = c_search.text_input("🔍 Search", placeholder="Name/Phone...")
            with c_add:
                with st.popover("➕ New Customer", use_container_width=True):
                    with st.form("quick_c"):
                        n=st.text_input("Name"); e=st.text_input("Email")
                        if st.form_submit_button("Create"): db.add_customer(n, e); st.success("Done"); auto_refresh()

            filtered = df_cust[df_cust['Name'].astype(str).str.contains(search, case=False)] if search else df_cust
            if filtered.empty: st.info("No customers found.")
            else:
                for i, row in filtered.head(50).iterrows():
                    with st.container(border=True):
                        c1, c2, c3 = st.columns([3, 1, 1])
                        c1.subheader(row['Name']); c1.caption(f"📞 {row['Phone']}")
                        try: cred = float(row.get('Credit', 0) or 0)
                        except: cred = 0.0
                        c2.metric("Credit", f"${cred:.2f}")
                        if c3.button("Manage", key=f"m_{row['CustomerID']}"): st.session_state['active_cust_id'] = row['CustomerID']; st.rerun()
        else:
            cid = st.session_state['active_cust_id']
            row = df_cust[df_cust['CustomerID'] == cid].iloc[0]
            if st.button("⬅️ Back"): st.session_state['active_cust_id'] = None; st.rerun()
            st.title(row['Name'])
            c1, c2 = st.columns([1, 2])
            with c1:
                with st.form(f"e_{cid}"):
                    nn=st.text_input("Name", row['Name']); pp=st.text_input("Phone", str(row.get('Phone','')))
                    aa=st.text_area("Address", str(row.get('Address',''))); nt=st.text_area("Notes", str(row.get('Notes','')))
                    if st.form_submit_button("Save"): db.update_customer_details(cid, nn, aa, pp, nt); st.success("Saved!"); auto_refresh()
                
                # --- RESTORED: GIFT CARDS ---
                with st.expander("🎁 Sell Gift Certificate"):
                    giver = st.selectbox("Payer", ["Self"] + list(df_cust['Name']), index=0)
                    gc_amt = st.number_input("Amount", 0.0, 5000.0, 50.0)
                    gc_pay = st.selectbox("Method", ["Cash", "Card", "Venmo", "Check"])
                    if st.button("💸 Process"):
                        giver_id = cid if giver == "Self" else df_cust[df_cust['Name']==giver].iloc[0]['CustomerID']
                        db.sell_gift_certificate(giver_id, cid, gc_amt, gc_pay); st.success("Added!"); auto_refresh()

            with c2:
                st.subheader("History")
                my_t = df_trans[df_trans['CustomerID'] == cid]
                if my_t.empty: st.info("No history.")
                else:
                    for i, t in my_t.sort_values("Timestamp", ascending=False).iterrows():
                        with st.container(border=True):
                            c_a, c_b, c_c = st.columns([2,1,1])
                            c_a.write(f"**{t['Timestamp']}**"); c_a.caption(f"#{t['TransactionID']}")
                            c_b.write(f"${t['TotalAmount']}")
                            # --- RESTORED: VIEW INVOICE BUTTON ---
                            if c_c.button("👁️ View", key=f"v_{t['TransactionID']}"):
                                df_i = st.session_state['data']['items']
                                df_i['TransactionID'] = df_i['TransactionID'].astype(str)
                                items = df_i[df_i['TransactionID'] == str(t['TransactionID'])]
                                cart_r = [{"sku": str(r.get('SKU','')), "name": r['Name'], "qty": int(r['QtySold']), "price": float(r['Price'])} for _, r in items.iterrows()]
                                if 'settings' in st.session_state['data']:
                                    s_d = dict(zip(st.session_state['data']['settings']['Key'], st.session_state['data']['settings']['Value']))
                                    addr = s_d.get("Address", "Modesto, CA")
                                else: addr = "Modesto, CA"
                                try: tax = float(t['TaxAmount'])
                                except: tax = 0.0
                                pdf = db.create_invoice_pdf(t['TransactionID'], row['Name'], addr, cart_r, 0, tax, float(t['TotalAmount']), "Paid")
                                show_pdf_viewer(pdf)

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
        
        with tab4:
            st.subheader("Unpaid Invoices")
            df_t = st.session_state['data']['transactions']
            unpaid = df_t[df_t['Status'] == 'Pending']
            if unpaid.empty: st.success("All paid!")
            else:
                for i, row in unpaid.iterrows():
                    c1, c2, c3 = st.columns([2, 1, 1])
                    c1.write(f"#{row['TransactionID']} - ${row['TotalAmount']}")
                    if c2.button("💲 Pay", key=f"up_{row['TransactionID']}"): db.mark_invoice_paid(row['TransactionID']); auto_refresh()
                    if c3.button("👁️ View", key=f"uv_{row['TransactionID']}"): st.info("Go to Customer tab to print.")
        
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

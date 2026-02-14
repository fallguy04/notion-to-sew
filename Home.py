import streamlit as st
import pandas as pd
import backend as db
from datetime import datetime, date
import base64

# --- CONFIG ---
st.set_page_config(page_title="Admin | Notion to Sew", layout="wide", page_icon="🧵")

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
</style>
""", unsafe_allow_html=True)

# --- HELPER: AUTO REFRESH ---
def auto_refresh():
    """Clears session state to force a data reload."""
    if 'data' in st.session_state:
        del st.session_state['data']
    st.rerun()

# --- INIT STATE ---
if 'data' not in st.session_state:
    with st.spinner("Connecting to Headquarters..."):
        st.session_state['data'] = db.get_data()
if 'cart' not in st.session_state: st.session_state['cart'] = []

# --- SIDEBAR ---
with st.sidebar:
    st.title("🧵 Admin Portal")
    menu = st.radio("Navigate", ["📊 Dashboard", "📦 Inventory", "🛒 Checkout", "👥 Customers", "📝 Reports", "⚙️ Settings"])
    
    st.divider()
    if st.button("🔄 Refresh Database"):
        auto_refresh()

# ==========================================
# 1. DASHBOARD
# ==========================================
if menu == "📊 Dashboard":
    st.title("Dashboard")
    col_d1, col_d2 = st.columns(2)
    today = date.today()
    start_of_month = date(today.year, today.month, 1)
    d_start = col_d1.date_input("Start Date", value=start_of_month)
    d_end = col_d2.date_input("End Date", value=today)
    
    if 'transactions' in st.session_state['data']:
        df = st.session_state['data']['transactions'].copy()
        df['DateObj'] = pd.to_datetime(df['Timestamp']).dt.date
        mask = (df['DateObj'] >= d_start) & (df['DateObj'] <= d_end)
        df_filtered = df[mask]
        
        df_filtered['TotalAmount'] = pd.to_numeric(df_filtered['TotalAmount'], errors='coerce').fillna(0)
        total_sales = df_filtered['TotalAmount'].sum()
        
        unpaid_df = df[df['Status'] == 'Pending']
        unpaid_total = pd.to_numeric(unpaid_df['TotalAmount'], errors='coerce').sum()
        
        c1, c2, c3 = st.columns(3)
        c1.metric("Revenue (Period)", f"${total_sales:,.2f}")
        c2.metric("Unpaid (All Time)", f"${unpaid_total:,.2f}", delta_color="inverse")
        c3.metric("Orders (Period)", len(df_filtered))
        
        st.subheader("Recent Activity")
        st.dataframe(df_filtered.tail(10).sort_values(by="Timestamp", ascending=False), use_container_width=True)

# ==========================================
# 2. INVENTORY
# ==========================================
elif menu == "📦 Inventory":
    st.title("Inventory Manager")
    
    # Refresh data ensuring 'Cost' column exists in DataFrame
    if 'Cost' not in st.session_state['data']['inventory'].columns:
        st.session_state['data']['inventory']['Cost'] = 0.0
    
    tab1, tab2, tab3 = st.tabs(["🔄 Add / Restock", "📋 Edit Database", "📥 Bulk Import"])
    
    # --- TAB 1: SMART ADD/RESTOCK ---
    with tab1:
        st.info("💡 Type a SKU below. If it exists, you can add stock. If it's new, you can create it.")
        
        # We use a distinct key for the lookup to avoid session state collisions
        lookup_sku = st.text_input("Scan or Type SKU", key="inv_sku_lookup").strip()
        
        df_inv = st.session_state['data']['inventory']
        
        # Check if SKU exists
        existing_item = df_inv[df_inv['SKU'].astype(str) == lookup_sku]
        
        if lookup_sku and not existing_item.empty:
            # --- RESTOCK MODE ---
            row = existing_item.iloc[0]
            st.success(f"**Found:** {row['Name']}")
            st.caption(f"Current Stock: {row['StockQty']} | Current Cost: ${row.get('Cost', 0):.2f}")
            
            with st.form("restock_form"):
                c1, c2 = st.columns(2)
                qty_add = c1.number_input("Quantity to ADD (+)", 1, 10000, 50)
                new_cost_val = c2.number_input("Unit Cost ($)", 0.0, 1000.0, float(row.get('Cost', 0.0)))
                
                st.caption(f"New Total Stock will be: {row['StockQty'] + qty_add}")
                
                if st.form_submit_button("➕ Update Stock & Cost", type="primary"):
                    db.restock_item(lookup_sku, qty_add, new_cost_val)
                    st.success(f"Added {qty_add} to {row['Name']}!")
                    auto_refresh()
                    
        elif lookup_sku:
            # --- CREATE NEW MODE ---
            st.warning("New Item Detected")
            with st.form("add_item_form"):
                c1, c2 = st.columns(2)
                # SKU is pre-filled from the lookup
                st.text_input("SKU", value=lookup_sku, disabled=True)
                new_name = st.text_input("Product Name")
                
                c3, c4 = st.columns(2)
                new_price = c3.number_input("Retail Price ($)", 0.0, 1000.0, 0.0)
                new_whol = c4.number_input("Wholesale Price ($)", 0.0, 1000.0, 0.0)
                
                c5, c6 = st.columns(2)
                new_stock = c5.number_input("Opening Stock", 0, 10000, 0)
                new_cost = c6.number_input("Unit Cost ($)", 0.0, 1000.0, 0.0)
                
                if st.form_submit_button("✅ Create Item", type="primary"):
                    if new_name:
                        db.add_inventory_item(lookup_sku, new_name, new_price, new_stock, new_whol, new_cost)
                        st.success("Item Created!")
                        auto_refresh()
                    else: st.error("Name required.")

    # --- TAB 2: EDIT DATABASE ---
    with tab2:
        df_inv = st.session_state['data']['inventory']
        search = st.text_input("🔍 Search Inventory", placeholder="Type to filter...")
        
        if search:
            mask = df_inv.astype(str).apply(lambda x: x.str.contains(search, case=False)).any(axis=1)
            df_inv = df_inv[mask]
            
        with st.form("inv_editor"):
            # Added Cost to column config for better formatting
            edited_df = st.data_editor(
                df_inv, 
                use_container_width=True, 
                num_rows="dynamic",
                column_config={
                    "Price": st.column_config.NumberColumn(format="$%.2f"),
                    "WholesalePrice": st.column_config.NumberColumn(format="$%.2f"),
                    "Cost": st.column_config.NumberColumn(format="$%.2f"),
                }
            )
            if st.form_submit_button("💾 Save Changes"):
                # Safety check inside backend is now active
                db.update_inventory_batch(edited_df)
                st.success("Database Updated Successfully!")
                auto_refresh()

    with tab3:
        st.subheader("Bulk Import from CSV")
        # Added Cost to template
        sample_data = pd.DataFrame([{"SKU": "TEST-01", "Name": "Example Item", "Price": 5.00, "WholesalePrice": 2.50, "StockQty": 100, "Cost": 1.25}])
        csv_template = sample_data.to_csv(index=False).encode('utf-8')
        st.download_button("⬇️ Download Template", data=csv_template, file_name="inventory_template.csv", mime="text/csv")
        
        uploaded_file = st.file_uploader("Upload filled CSV", type="csv")
        if uploaded_file:
            if st.button("🚀 Upload to Database"):
                import_df = pd.read_csv(uploaded_file)
                current_df = st.session_state['data']['inventory']
                
                # Check for Cost column in upload, fill 0 if missing
                if 'Cost' not in import_df.columns:
                    import_df['Cost'] = 0.0
                    
                final_df = pd.concat([current_df, import_df], ignore_index=True)
                db.update_inventory_batch(final_df)
                st.success("Import Complete!")
                auto_refresh()


# ==========================================
# 3. CHECKOUT
# ==========================================
elif menu == "🛒 Checkout":
    st.title("Point of Sale")

    # --- SUCCESS STATE (New!) ---
    if st.session_state.get('checkout_complete'):
        st.balloons()
        st.success(f"✅ Order #{st.session_state['last_order']['id']} Recorded Successfully!")
        
        c1, c2, c3 = st.columns(3)
        
        # 1. View Invoice (Modal)
        if c1.button("👁️ View Invoice", use_container_width=True):
            st.session_state['view_last_invoice'] = True
        
        # 2. Download Invoice
        pdf_data = st.session_state['last_order']['pdf']
        c2.download_button(
            "📄 Download PDF", 
            data=pdf_data, 
            file_name=f"Invoice_{st.session_state['last_order']['id']}.pdf", 
            mime="application/pdf",
            use_container_width=True
        )
        
        # 3. New Sale
        if c3.button("✨ New Sale", type="primary", use_container_width=True):
            st.session_state['checkout_complete'] = False
            st.session_state['view_last_invoice'] = False
            st.session_state['last_order'] = None
            st.rerun()

        # Preview Modal
        if st.session_state.get('view_last_invoice'):
            st.divider()
            b64_pdf = base64.b64encode(pdf_data).decode('utf-8')
            pdf_display = f'''
                <object data="data:application/pdf;base64,{b64_pdf}" type="application/pdf" width="100%" height="600px">
                    <p>Your browser can't display this PDF directly. <a href="data:application/pdf;base64,{b64_pdf}" download="Invoice.pdf">Click here to download it.</a></p>
                </object>
            '''
            st.markdown(pdf_display, unsafe_allow_html=True)
            
            if st.button("❌ Close Preview"):
                st.session_state['view_last_invoice'] = False
                st.rerun()

    # --- NORMAL CHECKOUT ---
    else:
        c1, c2 = st.columns([1.5, 1])
        
        with c1:
            st.subheader("Add Item")
            is_wholesale = st.checkbox("Apply Wholesale Pricing?", value=False)
            inv = st.session_state['data']['inventory']
            cust = st.session_state['data']['customers']
            inv['lookup'] = inv['SKU'].astype(str) + " | " + inv['Name']
            selected_item_str = st.selectbox("Search Item", inv['lookup'], index=None)
            
            if selected_item_str:
                sku_str = selected_item_str.split(" | ")[0].strip()
                mask = inv['SKU'].astype(str).str.strip() == sku_str
                item_row = inv[mask].iloc[0]
                with st.container(border=True):
                    # Price Selection Logic
                    base_price = item_row['WholesalePrice'] if is_wholesale and float(item_row.get('WholesalePrice', 0) or 0) > 0 else item_row['Price']
                    
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
                st.subheader("Current Order")
                if not st.session_state['cart']: st.info("Cart is empty.")
                else:
                    subtotal = sum(item['total'] for item in st.session_state['cart'])
                    # List Items
                    for i, item in enumerate(st.session_state['cart']):
                        c_a, c_b, c_c = st.columns([3, 1, 0.5])
                        c_a.write(f"**{item['name']}**\n{item['qty']} @ ${item['price']:.2f}")
                        c_b.write(f"${item['total']:.2f}")
                        if c_c.button("x", key=f"del_{i}"):
                            st.session_state['cart'].pop(i)
                            st.rerun()
                    st.divider()
                    
                    # Tax Logic
                    if 'settings' in st.session_state['data']:
                        s_df = st.session_state['data']['settings']
                        settings_cache = dict(zip(s_df['Key'], s_df['Value']))
                        raw_rate = settings_cache.get("TaxRate", "0.08")
                        venmo_user = settings_cache.get("VenmoUser", "")
                    else: raw_rate = "0.08"; venmo_user = ""
                    
                    try: tax_rate = float(str(raw_rate).replace("%", "").strip())
                    except: tax_rate = 0.0
                    
                    apply_tax = st.checkbox(f"Apply Tax ({(tax_rate*100):.3f}%)", value=not is_wholesale)
                    tax_amt = subtotal * tax_rate if apply_tax else 0.0
                    cart_total = subtotal + tax_amt
                    
                    # CUSTOMER & CREDIT LOGIC
                    cust_tab1, cust_tab2 = st.tabs(["Existing", "New"])
                    selected_cust = None; cust_credit = 0.0
                    with cust_tab1:
                        selected_cust_name = st.selectbox("Customer", cust['Name'], index=None)
                        if selected_cust_name:
                            selected_cust = selected_cust_name
                            cust_row = cust[cust['Name'] == selected_cust].iloc[0]
                            cust_id = cust_row['CustomerID']
                            try: cust_credit = float(cust_row.get('Credit', 0) if cust_row.get('Credit') != "" else 0)
                            except: cust_credit = 0.0
                    with cust_tab2:
                        with st.form("q_add"):
                            nn = st.text_input("Name"); ne = st.text_input("Email")
                            if st.form_submit_button("Save"): db.add_customer(nn, ne); auto_refresh()

                    credit_applied = 0.0
                    if selected_cust and cust_credit > 0:
                        st.info(f"💎 **Credit Available: ${cust_credit:.2f}**")
                        if st.checkbox("Apply Store Credit?"):
                            max_apply = min(cust_credit, cart_total)
                            credit_applied = st.number_input("Amount to apply", 0.0, max_apply, max_apply)
                    
                    final_due = max(0.0, cart_total - credit_applied)
                    st.write(f"Subtotal: ${subtotal:.2f}"); st.write(f"Tax: ${tax_amt:.2f}")
                    if credit_applied > 0: st.write(f"Store Credit: -${credit_applied:.2f}")
                    st.markdown(f"### Total: ${final_due:.2f}")
                    st.divider()
                    
                    pay_method = st.selectbox("Payment", ["Cash", "Card", "Venmo", "Invoice (Pay Later)"])
                    if pay_method == "Venmo" and venmo_user:
                        st.image(f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://venmo.com/u/{venmo_user}", width=150, caption=f"@{venmo_user}")

                    if st.button("✅ Complete Order", type="primary", use_container_width=True):
                        if selected_cust or pay_method == "Cash": # Allow Cash Guest checkout
                            # Handle Guest
                            if not selected_cust: cust_id = "Guest"; selected_cust = "Guest"
                            
                            status = "Pending" if pay_method == "Invoice (Pay Later)" else "Paid"
                            with st.spinner("Processing..."):
                                new_id = db.commit_sale(
                                    st.session_state['cart'], cart_total, tax_amt, cust_id, 
                                    pay_method, is_wholesale, status, credit_used=credit_applied
                                )
                                # Generate PDF immediately for the success screen
                                if 'settings' in st.session_state['data']:
                                    s_dict = dict(zip(st.session_state['data']['settings']['Key'], st.session_state['data']['settings']['Value']))
                                    address = s_dict.get("Address", "Modesto, CA")
                                else: address = "Modesto, CA"
                                
                                pdf_bytes = db.create_pdf(new_id, selected_cust, address, st.session_state['cart'], subtotal, tax_amt, cart_total, "Upon Receipt", credit_applied=credit_applied)
                                
                                # STORE STATE INSTEAD OF DOWNLOADING IMMEDIATELY
                                st.session_state['last_order'] = {
                                    'id': new_id,
                                    'pdf': pdf_bytes
                                }
                                st.session_state['checkout_complete'] = True
                                st.session_state['cart'] = [] # Clear cart
                                st.rerun()
                        else: st.error("Select customer (required for non-cash orders).")

# ==========================================
# 4. CUSTOMERS (Card View & CRM)
# ==========================================
elif menu == "👥 Customers":
    st.title("Customer Management")
    
    # Initialize Session State for Navigation
    if 'active_cust_id' not in st.session_state:
        st.session_state['active_cust_id'] = None

    df_cust = st.session_state['data']['customers']
    df_trans = st.session_state['data']['transactions']
    df_items = st.session_state['data']['items']

    # --- HELPER: PHONE FORMAT ---
    def format_us_phone(phone_raw):
        digits = ''.join(filter(str.isdigit, str(phone_raw)))
        if len(digits) == 10: return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
        return str(phone_raw)

# ==========================================
    # VIEW A: THE CUSTOMER LIST (Cards)
    # ==========================================
    if st.session_state['active_cust_id'] is None:
        
        # 1. Top Actions
        # FIX: vertical_alignment="bottom" makes the button sit flush with the search bar
        c_search, c_add = st.columns([3, 1], vertical_alignment="bottom")
        
        # Search Bar
        search_q = c_search.text_input("🔍 Search Customers", placeholder="Name or Phone...")
        
        # Add Button (Now aligned)
        with c_add:
            with st.popover("➕ New Customer", use_container_width=True):
                with st.form("quick_create_cust"):
                    n_n = st.text_input("Name")
                    n_e = st.text_input("Email")
                    if st.form_submit_button("Create"):
                        if n_n:
                            db.add_customer(n_n, n_e)
                            st.success("Created!")
                            auto_refresh()
                        else: st.error("Name required")

        st.divider()

        # 2. Filter Logic
        if search_q:
            # Flexible search
            mask = (
                df_cust['Name'].astype(str).str.contains(search_q, case=False) | 
                df_cust['Phone'].astype(str).str.contains(search_q)
            )
            filtered_df = df_cust[mask]
        else:
            filtered_df = df_cust
            
        # 3. Render Cards (Grid Layout)
        # We use a loop to create rows of 3 columns
        if filtered_df.empty:
            st.info("No customers found.")
        else:
            # Pagination / Limit for speed
            MAX_ITEMS = 50
            if len(filtered_df) > MAX_ITEMS:
                st.caption(f"Showing first {MAX_ITEMS} of {len(filtered_df)} customers. Refine search to see more.")
                filtered_df = filtered_df.head(MAX_ITEMS)
            
            for i, row in filtered_df.iterrows():
                # Create a card-like container
                with st.container(border=True):
                    c_info, c_cred, c_btn = st.columns([3, 1, 1])
                    
                    # Info
                    with c_info:
                        st.subheader(row['Name'])
                        ph = format_us_phone(row['Phone'])
                        st.caption(f"📞 {ph if ph else 'No Phone'} | 📧 {row['Email']}")
                    
                    # Credit Badge
                    with c_cred:
                        try: cred = float(row.get('Credit', 0) if row.get('Credit') != "" else 0)
                        except: cred = 0.0
                        if cred > 0:
                            st.metric("Credit", f"${cred:.2f}")
                        else:
                            st.write("") # Spacer
                    
                    # Manage Button
                    with c_btn:
                        st.write("") # Vertical alignment spacer
                        if st.button("Manage ➝", key=f"btn_m_{row['CustomerID']}"):
                            st.session_state['active_cust_id'] = row['CustomerID']
                            st.rerun()

    # ==========================================
    # VIEW B: THE PROFILE (Detailed)
    # ==========================================
    else:
        # Get Active Customer Data
        cid = st.session_state['active_cust_id']
        mask = df_cust['CustomerID'] == cid
        
        if df_cust[mask].empty:
            st.error("Customer not found. They may have been deleted.")
            if st.button("Back to List"):
                st.session_state['active_cust_id'] = None
                st.rerun()
        else:
            row = df_cust[mask].iloc[0]
            
            # --- HEADER ---
            c_back, c_title = st.columns([1, 5])
            if c_back.button("⬅️ Back"):
                st.session_state['active_cust_id'] = None
                st.rerun()
            c_title.title(row['Name'])
            
            # --- MAIN CONTENT ---
            col1, col2 = st.columns([1, 1.5])
            
            # LEFT: Edit Profile & Credit
            with col1:
                with st.container(border=True):
                    st.subheader("Edit Details")
                    with st.form(f"edit_{cid}"):
                        u_name = st.text_input("Name", value=row['Name'])
                        u_phone = st.text_input("Phone", value=str(row.get('Phone', "")))
                        u_addr = st.text_area("Address", value=str(row.get('Address', "")))
                        u_notes = st.text_area("Notes", value=str(row.get('Notes', "")))
                        if st.form_submit_button("💾 Save Changes"):
                            db.update_customer_details(cid, u_name, u_addr, u_phone, u_notes)
                            st.success("Saved!")
                            auto_refresh()
                    
                    st.write("")
                    with st.expander("🗑️ Delete Profile"):
                        if st.checkbox(f"I confirm deletion of {row['Name']}", key="del_chk"):
                            if st.button("Delete Permanently", type="primary"):
                                db.delete_customer(cid)
                                st.session_state['active_cust_id'] = None
                                st.success("Deleted.")
                                auto_refresh()

                st.divider()
                
                # Credit Logic
                try: raw_cred = float(row.get('Credit', 0) if row.get('Credit') != "" else 0)
                except: raw_cred = 0.0
                st.metric("Store Credit Balance", f"${raw_cred:,.2f}")
                
                with st.expander("🎁 Sell Gift Certificate / Add Credit"):
                    giver_lookup = st.selectbox("Who is paying?", ["Self (Same Person)"] + list(df_cust['Name']), index=0)
                    gc_amount = st.number_input("Amount ($)", 0.0, 5000.0, 50.0, step=10.0)
                    gc_pay_method = st.selectbox("Payment Method", ["Cash", "Card", "Venmo", "Check"])
                    
                    if st.button("💸 Add Credit", type="primary"):
                        if giver_lookup == "Self (Same Person)": giver_id = cid
                        else: giver_id = df_cust[df_cust['Name'] == giver_lookup].iloc[0]['CustomerID']
                        with st.spinner("Processing..."):
                            db.sell_gift_certificate(giver_id, cid, gc_amount, gc_pay_method)
                            st.success(f"Added ${gc_amount}!")
                            auto_refresh()

            # RIGHT: Purchase History
            with col2:
                st.subheader("History")
                my_trans = df_trans[df_trans['CustomerID'] == cid]
                
                if my_trans.empty:
                    st.info("No purchase history.")
                else:
                    my_trans = my_trans.sort_values(by="Timestamp", ascending=False)
                    
                    # Iterate with Index (i) to fix duplicate key error
                    for i, t_row in my_trans.iterrows():
                        with st.container(border=True):
                            c_d, c_a, c_s, c_act = st.columns([1.5, 1, 1, 1.5])
                            
                            c_d.write(f"**{str(t_row['Timestamp'])[:10]}**")
                            c_d.caption(f"#{t_row['TransactionID']}")
                            
                            try: amt = float(t_row['TotalAmount'] if t_row['TotalAmount'] != '' else 0)
                            except: amt = 0.0
                            c_a.write(f"**${amt:.2f}**")
                            
                            status = str(t_row['Status']).strip().title()
                            is_paid = (status == "Paid")
                            if is_paid: c_s.success("Paid", icon="✅")
                            else: c_s.warning("Unpaid", icon="⏳")
                            
                            # ACTION BUTTONS (Unique Keys Added)
                            b1, b2, b3 = c_act.columns(3)
                            
                            # KEY FIX: Append _{i} to ensure uniqueness
                            if b1.button("👁️", key=f"v_{t_row['TransactionID']}_{i}"):
                                st.session_state[f"view_inv_{t_row['TransactionID']}"] = True
                                st.rerun()
                                
                            if not is_paid:
                                if b2.button("💲", key=f"p_{t_row['TransactionID']}_{i}", help="Mark Paid"):
                                    db.mark_invoice_paid(t_row['TransactionID'])
                                    st.toast("Paid!")
                                    auto_refresh()
                                    
                            if b3.button("🗑️", key=f"d_{t_row['TransactionID']}_{i}", type="primary"):
                                db.delete_invoice(t_row['TransactionID'])
                                st.warning("Deleted.")
                                auto_refresh()

                        # Previewer (Same Key Fix not needed for container, but good practice)
                        if st.session_state.get(f"view_inv_{t_row['TransactionID']}", False):
                            with st.container(border=True):
                                if st.button("❌ Close", key=f"cls_{t_row['TransactionID']}_{i}"):
                                    st.session_state[f"view_inv_{t_row['TransactionID']}"] = False
                                    st.rerun()
                                    
                                # PDF Generation (Standard Logic)
                                t_id = str(t_row['TransactionID'])
                                df_items['TransactionID'] = df_items['TransactionID'].astype(str)
                                inv_items = df_items[df_items['TransactionID'] == t_id]
                                cart = []
                                for _, item in inv_items.iterrows():
                                    try: q=int(item['QtySold']); p=float(item['Price'])
                                    except: q=1; p=0.0
                                    cart.append({"sku": str(item.get('SKU','')), "name": item['Name'], "qty": q, "price": p})
                                
                                try: tax = float(t_row['TaxAmount'] if t_row['TaxAmount'] != '' else 0)
                                except: tax = 0.0
                                
                                if 'settings' in st.session_state['data']:
                                    s_dict = dict(zip(st.session_state['data']['settings']['Key'], st.session_state['data']['settings']['Value']))
                                    addr = s_dict.get("Address", "Modesto, CA")
                                else: addr = "Modesto, CA"
                                
                                pdf = db.create_pdf(t_id, row['Name'], addr, cart, 0, tax, amt, str(t_row.get('DueDate','')))
                                b64 = base64.b64encode(pdf).decode('utf-8')
                                
                                # 3. Object Tag (Robust Method)
                                pdf_display = f'''
                                    <object data="data:application/pdf;base64,{b64}" type="application/pdf" width="100%" height="600px">
                                        <p>Your browser can't display this PDF directly. <a href="data:application/pdf;base64,{b64}" download="Invoice.pdf">Click here to download it.</a></p>
                                    </object>
                                '''
                                st.markdown(pdf_display, unsafe_allow_html=True)

# ==========================================
# 5. REPORTS
# ==========================================
elif menu == "📝 Reports":
    st.title("Financial Reports")
    tab1, tab2, tab3, tab4 = st.tabs(["💰 Income Statement", "🏛️ Sales Tax", "📈 Top Sellers", "⏳ Unpaid"])
    
# --- TAB 1: INCOME STATEMENT (New!) ---
    with tab1:
        st.header("Income Statement")
        
        # 1. Date Selection
        c1, c2 = st.columns(2)
        r_start = c1.date_input("Start Date", value=date(date.today().year, 1, 1), key="r_start")
        r_end = c2.date_input("End Date", value=date.today(), key="r_end")
        
        if st.button("📊 Generate Report"):
            # A. Prepare Data
            df_trans = st.session_state['data']['transactions'].copy()
            df_items = st.session_state['data']['items'].copy()
            df_exp = st.session_state.get('data', {}).get('expenses', pd.DataFrame())
            
            # Filter by Date
            df_trans['DateObj'] = pd.to_datetime(df_trans['Timestamp']).dt.date
            mask_t = (df_trans['DateObj'] >= r_start) & (df_trans['DateObj'] <= r_end)
            f_trans = df_trans[mask_t]
            
            # B. Calculate Revenue (Split Retail vs Wholesale)
            f_trans['TotalAmount'] = pd.to_numeric(f_trans['TotalAmount'], errors='coerce').fillna(0)
            f_trans['TaxAmount'] = pd.to_numeric(f_trans['TaxAmount'], errors='coerce').fillna(0)
            
            # Identify Wholesale (Check column existence safely)
            if 'IsWholesale' in f_trans.columns:
                ws_mask = f_trans['IsWholesale'].astype(str).str.lower() == 'true'
            else: ws_mask = pd.Series([False] * len(f_trans))
            
            # Net Sales = Total - Tax
            f_trans['NetSale'] = f_trans['TotalAmount'] - f_trans['TaxAmount']
            
            wholesale_sales = f_trans[ws_mask]['NetSale'].sum()
            retail_sales = f_trans[~ws_mask]['NetSale'].sum()
            total_income = wholesale_sales + retail_sales
            
            # C. Calculate COGS
            # Filter Items by the valid Transaction IDs
            valid_ids = f_trans['TransactionID'].astype(str).tolist()
            df_items['TransactionID'] = df_items['TransactionID'].astype(str)
            f_items = df_items[df_items['TransactionID'].isin(valid_ids)].copy()
            
            # Merge with Inventory to get 'Cost'
            if 'inventory' in st.session_state['data']:
                inv_ref = st.session_state['data']['inventory'][['SKU', 'Cost']].copy()
                inv_ref['SKU'] = inv_ref['SKU'].astype(str)
                f_items['SKU'] = f_items['SKU'].astype(str)
                merged_items = f_items.merge(inv_ref, on='SKU', how='left')
                merged_items['QtySold'] = pd.to_numeric(merged_items['QtySold'], errors='coerce').fillna(0)
                merged_items['LineCost'] = merged_items['QtySold'] * pd.to_numeric(merged_items['Cost'], errors='coerce').fillna(0)
                total_cogs = merged_items['LineCost'].sum()
            else: total_cogs = 0.0
            
            gross_profit = total_income - total_cogs
            
            # D. Expenses
            expenses_breakdown = {}
            total_expenses = 0.0
            if not df_exp.empty:
                df_exp['DateObj'] = pd.to_datetime(df_exp['Date']).dt.date
                mask_e = (df_exp['DateObj'] >= r_start) & (df_exp['DateObj'] <= r_end)
                f_exp = df_exp[mask_e].copy()
                f_exp['Amount'] = pd.to_numeric(f_exp['Amount'], errors='coerce').fillna(0)
                expenses_breakdown = f_exp.groupby('Category')['Amount'].sum().to_dict()
                total_expenses = sum(expenses_breakdown.values())
            
            net_profit = gross_profit - total_expenses
            
            # E. Generate PDF
            financials = {
                'retail_sales': retail_sales, 'wholesale_sales': wholesale_sales,
                'total_income': total_income, 'cogs': total_cogs,
                'gross_profit': gross_profit, 'expenses_breakdown': expenses_breakdown,
                'total_expenses': total_expenses, 'net_profit': net_profit
            }
            
            pdf_data = db.generate_income_statement_pdf(r_start, r_end, financials)
            
            # F. Preview & Download
            st.divider()
            c_a, c_b, c_c = st.columns(3)
            c_a.metric("Total Revenue", f"${total_income:,.2f}")
            c_b.metric("COGS", f"${total_cogs:,.2f}")
            c_c.metric("Net Profit", f"${net_profit:,.2f}", delta_color="normal")
            
            # Viewer (Fixed for Chrome)
            b64_pdf = base64.b64encode(pdf_data).decode('utf-8')
            pdf_display = f'''
                <object data="data:application/pdf;base64,{b64_pdf}" type="application/pdf" width="100%" height="600px">
                    <p>Your browser can't display this PDF directly. <a href="data:application/pdf;base64,{b64_pdf}" download="Report.pdf">Click here to download it.</a></p>
                </object>
            '''
            st.markdown(pdf_display, unsafe_allow_html=True)
            
            st.download_button(
                "⬇️ Download PDF", data=pdf_data,
                file_name=f"IncomeStatement_{r_start}_{r_end}.pdf",
                mime="application/pdf", type="primary", use_container_width=True
            )
            
            # G. Expense Logger
            with st.expander("➕ Log Expense"):
                with st.form("expense_form_rep"):
                    c1, c2 = st.columns(2)
                    ex_date = c1.date_input("Date")
                    ex_cat = c2.selectbox("Category", ["Fabric", "Notions", "Rent", "Marketing", "Shipping", "Wages", "Other"])
                    ex_amt = c1.number_input("Amount ($)", 0.0, 10000.0, 0.0, step=0.01)
                    ex_desc = c2.text_input("Description")
                    if st.form_submit_button("Save Expense"):
                        db.add_expense(ex_date, ex_cat, ex_amt, ex_desc)
                        auto_refresh()

    with tab2:
        st.header("Sales Tax Liability")
        c1, c2 = st.columns(2)
        st_start = c1.date_input("Start Date", value=date(date.today().year, 1, 1), key="st_start")
        st_end = c2.date_input("End Date", value=date.today(), key="st_end")
        df = st.session_state['data']['transactions'].copy()
        df['DateObj'] = pd.to_datetime(df['Timestamp']).dt.date
        mask = (df['DateObj'] >= st_start) & (df['DateObj'] <= st_end)
        filtered_df = df[mask]
        total_tax = pd.to_numeric(filtered_df['TaxAmount'], errors='coerce').sum()
        taxable_sales = pd.to_numeric(filtered_df['TotalAmount'], errors='coerce').sum() - total_tax
        m1, m2 = st.columns(2)
        m1.metric("Tax Collected", f"${total_tax:,.2f}"); m2.metric("Taxable Sales", f"${taxable_sales:,.2f}")

    with tab3:
        st.header("Best Selling Products")
        c1, c2 = st.columns(2)
        ts_start = c1.date_input("Start Date", value=date(date.today().year, 1, 1), key="ts_start")
        ts_end = c2.date_input("End Date", value=date.today(), key="ts_end")
        df_items = st.session_state['data']['items'].copy()
        df_trans = st.session_state['data']['transactions'][['TransactionID', 'Timestamp']].copy()
        df_items['TransactionID'] = df_items['TransactionID'].astype(str)
        df_trans['TransactionID'] = df_trans['TransactionID'].astype(str)
        merged = df_items.merge(df_trans, on='TransactionID', how='left')
        merged['DateObj'] = pd.to_datetime(merged['Timestamp']).dt.date
        mask = (merged['DateObj'] >= ts_start) & (merged['DateObj'] <= ts_end)
        filtered_items = merged[mask]
        if not filtered_items.empty:
            filtered_items['QtySold'] = pd.to_numeric(filtered_items['QtySold'], errors='coerce')
            top_sellers = filtered_items.groupby('Name')['QtySold'].sum().sort_values(ascending=False).head(10)
            st.bar_chart(top_sellers)
        else: st.info("No sales in this period.")

    with tab4:
        st.header("Accounts Receivable")
        df_trans = st.session_state['data']['transactions']
        df_cust = st.session_state['data']['customers']
        df_items = st.session_state['data']['items']
        pending = df_trans[df_trans['Status'] == 'Pending'].copy()
        if pending.empty: st.success("🎉 All invoices are paid!")
        else:
            if not df_cust.empty:
                pending['CustomerID'] = pending['CustomerID'].astype(str)
                df_cust['CustomerID'] = df_cust['CustomerID'].astype(str)
                merged = pending.merge(df_cust[['CustomerID', 'Name']], on='CustomerID', how='left')
            else: merged = pending; merged['Name'] = "Unknown"
            
            for i, row in merged.iterrows():
                with st.container(border=True):
                    c1, c2, c3, c4 = st.columns([2, 2, 1, 1.5])
                    cust_name = row['Name'] if pd.notna(row['Name']) else "Unknown"
                    c1.write(f"**{cust_name}**"); c1.caption(f"#{row['TransactionID']}")
                    c2.write(f"Due: {row['DueDate']}")
                    c3.write(f"**${float(row['TotalAmount']):,.2f}**")
                    c_v, c_p = c4.columns(2)
                    if c_v.button("👁️", key=f"uv_{row['TransactionID']}"):
                        st.session_state[f"view_inv_{row['TransactionID']}"] = True
                        st.rerun()
                    if c_p.button("💲", key=f"up_{row['TransactionID']}"):
                        db.mark_invoice_paid(row['TransactionID']); st.balloons(); auto_refresh()

                if st.session_state.get(f"view_inv_{row['TransactionID']}", False):
                    with st.container(border=True):
                        if st.button("❌ Close", key=f"uclose_{row['TransactionID']}"):
                            st.session_state[f"view_inv_{row['TransactionID']}"] = False
                            st.rerun()
                        t_id = str(row['TransactionID'])
                        df_items['TransactionID'] = df_items['TransactionID'].astype(str)
                        inv_items = df_items[df_items['TransactionID'] == t_id]
                        cart_rebuild = []
                        for _, item in inv_items.iterrows():
                            try: q = int(item['QtySold']); p = float(item['Price'])
                            except: q=1; p=0.0
                            cart_rebuild.append({"sku": str(item.get('SKU','')), "name": item['Name'], "qty": q, "price": p})
                        try: tax_val = float(row['TaxAmount'] if row['TaxAmount'] != '' else 0)
                        except: tax_val = 0.0
                        if 'settings' in st.session_state['data']:
                            s_dict = dict(zip(st.session_state['data']['settings']['Key'], st.session_state['data']['settings']['Value']))
                            addr = s_dict.get("Address", "Modesto, CA")
                        else: addr = "Modesto, CA"
                        pdf_bytes = db.create_pdf(t_id, cust_name, addr, cart_rebuild, 0, tax_val, float(row['TotalAmount']), str(row.get('DueDate', '')))
                        b64_pdf = base64.b64encode(pdf_bytes).decode('utf-8')
                        st.markdown(f'<embed src="data:application/pdf;base64,{b64_pdf}" width="100%" height="600" type="application/pdf">', unsafe_allow_html=True)

# ==========================================
# 6. SETTINGS
# ==========================================
elif menu == "⚙️ Settings":
    st.title("Settings")
    if 'settings' in st.session_state['data']:
        raw_settings = st.session_state['data']['settings']
        settings_dict = dict(zip(raw_settings['Key'], raw_settings['Value']))
    else: settings_dict = {}

    with st.form("settings_form"):
        col1, col2 = st.columns(2)
        with col1:
            st.subheader("🏢 Company Info")
            c_name = st.text_input("Company Name", value=settings_dict.get("CompanyName", "Notion to Sew"))
            c_addr = st.text_area("Address", value=settings_dict.get("Address", "Modesto, CA"))
        with col2:
            st.subheader("💰 Financials")
            raw_val = settings_dict.get("TaxRate", "0.08")
            try:
                clean_val = float(str(raw_val).replace("%", "").strip())
                display_rate = clean_val * 100 if clean_val < 1.0 else clean_val
            except ValueError: display_rate = 8.0
            new_rate_percent = st.number_input("Sales Tax Rate (%)", 0.0, 100.0, float(display_rate), step=0.001, format="%.3f")
            next_inv = st.text_input("Next Invoice ID", value=settings_dict.get("NextInvoiceID", "1000"))
            venmo_user = st.text_input("Venmo Username (for QR)", value=settings_dict.get("VenmoUser", ""))
        st.divider()
        if st.form_submit_button("Save All Settings", type="primary"):
            decimal_rate = new_rate_percent / 100
            updates = {"CompanyName": c_name, "Address": c_addr, "TaxRate": decimal_rate, "NextInvoiceID": next_inv, "VenmoUser": venmo_user}
            db.update_settings(updates)
            st.success("✅ Saved!"); auto_refresh()

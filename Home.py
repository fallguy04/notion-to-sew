import streamlit as st
import pandas as pd
import backend as db
from datetime import datetime, date
from streamlit_pdf_viewer import pdf_viewer
from streamlit_extras.colored_header import colored_header

# --- CONFIG ---
st.set_page_config(page_title="Admin | Notion to Sew", layout="wide", page_icon="🧵", initial_sidebar_state="expanded")

# --- GOOGLE SHEETS FAB (Admin mode only) ---
st.markdown("""
<style>
#sheets-fab {
    position: fixed !important;
    top: 60px !important;
    right: 20px !important;
    z-index: 1000000 !important;
    display: flex !important;
    align-items: center !important;
    gap: 7px !important;
    background: #ffffff !important;
    border: 1px solid #dadce0 !important;
    border-radius: 24px !important;
    padding: 6px 14px 6px 10px !important;
    box-shadow: 0 1px 3px rgba(60,64,67,0.2), 0 2px 6px rgba(60,64,67,0.1) !important;
    text-decoration: none !important;
    transition: box-shadow 0.15s, background 0.15s !important;
    cursor: pointer !important;
}
#sheets-fab:hover {
    background: #f1f3f4 !important;
    box-shadow: 0 2px 6px rgba(60,64,67,0.25), 0 4px 12px rgba(60,64,67,0.12) !important;
    text-decoration: none !important;
}
#sheets-fab span {
    font-family: 'Roboto', sans-serif !important;
    font-size: 0.8rem !important;
    font-weight: 500 !important;
    color: #3c4043 !important;
    white-space: nowrap !important;
}
</style>
<a href="https://docs.google.com/spreadsheets/d/13hdnnzU3pZpypqHlZasi9KR22-uDF7erpKKdykhJZtI/edit?gid=0#gid=0"
   target="_blank" title="Open Google Sheet" id="sheets-fab">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="26" height="26">
    <path d="M38 4H16a4 4 0 0 0-4 4v48a4 4 0 0 0 4 4h32a4 4 0 0 0 4-4V18L38 4z" fill="#23A566"/>
    <path d="M38 4v14h14L38 4z" fill="#16834F"/>
    <rect x="20" y="30" width="24" height="3" rx="1" fill="#ffffff" opacity="0.9"/>
    <rect x="20" y="37" width="24" height="3" rx="1" fill="#ffffff" opacity="0.9"/>
    <rect x="20" y="44" width="16" height="3" rx="1" fill="#ffffff" opacity="0.9"/>
  </svg>
  <span>Open Inventory Database</span>
</a>

""", unsafe_allow_html=True)

# --- HELPER: AUTO REFRESH ---
def auto_refresh():
    """Clears session state to force a data reload."""
    if 'data' in st.session_state:
        del st.session_state['data']
    st.rerun()

# --- HELPER: Branded page header ---
def page_header(icon: str, title: str, subtitle: str = ""):
    colored_header(label=f"{icon} {title}", description=subtitle, color_name="blue-70")

# --- HELPER: Normalize transaction IDs (handles "1001.0" → "1001" from old imports) ---
def _normalize_tid(tid) -> str:
    s = str(tid).strip()
    try:
        return str(int(float(s)))
    except (ValueError, TypeError):
        return s

# --- HELPER: Build PDF from stored transaction ---
def _build_invoice_pdf(transaction_id: str, customer_name: str) -> bytes:
    """Reconstruct a PDF for any historical transaction from session data."""
    data = st.session_state['data']
    norm_id = _normalize_tid(transaction_id)
    items_df = data['items'].copy()
    items_df['TransactionID'] = items_df['TransactionID'].apply(_normalize_tid)
    inv_items = items_df[items_df['TransactionID'] == norm_id]
    
    # --- RACE CONDITION FIX: Refresh if items not yet in cache ---
    if inv_items.empty:
        db.force_refresh()
        st.session_state['data'] = db.get_data()
        data = st.session_state['data']
        items_df = data['items'].copy()
        items_df['TransactionID'] = items_df['TransactionID'].apply(_normalize_tid)
        inv_items = items_df[items_df['TransactionID'] == norm_id]

    cart = []
    for _, item in inv_items.iterrows():
        try: q, p = int(item['QtySold']), float(item['Price'])
        except: q, p = 1, 0.0
        cart.append({"sku": str(item.get('SKU', '')), "name": item['Name'], "qty": q, "price": p})
    addr = "Modesto, CA"
    if 'settings' in data:
        s = dict(zip(data['settings']['Key'], data['settings']['Value']))
        addr = s.get("Address", addr)
    trans_df = data['transactions'].copy()
    trans_df['TransactionID'] = trans_df['TransactionID'].apply(_normalize_tid)
    t = trans_df[trans_df['TransactionID'] == norm_id]
    tax, total, due = 0.0, 0.0, ""
    if not t.empty:
        r = t.iloc[0]
        try: tax = float(r['TaxAmount'] or 0)
        except: pass
        try: total = float(r['TotalAmount'] or 0)
        except: pass
        due = str(r.get('DueDate', ''))
    subtotal = sum(i['qty'] * i['price'] for i in cart)
    return db.create_pdf(transaction_id, customer_name, addr, cart, subtotal, tax, total, due)

# --- HELPER: Edit Inventory Editor (shared by tab view + fullscreen) ---
def _render_inv_editor(height=600):
    full_inv = st.session_state['data']['inventory'].copy()

    if 'Active' not in full_inv.columns:
        full_inv['Active'] = True
    full_inv['Active'] = full_inv['Active'].apply(
        lambda x: str(x).strip().lower() not in ['false', '0', 'no', '']
    )

    c_s, c_sort, c_ord, c_show = st.columns([2, 2, 1, 1.5])
    search     = c_s.text_input("🔍 Search", placeholder="Filter items...", key="inv_search")
    sort_col   = c_sort.selectbox("Sort By", ["Name", "SKU", "Price", "WholesalePrice", "StockQty", "Cost"], key="inv_sort_col")
    sort_asc   = c_ord.radio("Dir", ["↑", "↓"], horizontal=True, key="inv_sort_dir") == "↑"
    show_inact = c_show.checkbox("Show Inactive Items", value=False, key="inv_show_inactive")

    view_df = full_inv.copy()
    if not show_inact:
        view_df = view_df[view_df['Active'] == True]
    if search:
        mask = view_df.astype(str).apply(lambda x: x.str.contains(search, case=False)).any(axis=1)
        view_df = view_df[mask]

    if sort_col in view_df.columns:
        try:
            view_df = view_df.copy()
            if sort_col in ['Price', 'WholesalePrice', 'StockQty', 'Cost']:
                view_df[sort_col] = pd.to_numeric(view_df[sort_col], errors='coerce')
            else:
                # SKU / Name: cast to str so mixed-type columns don't crash sort
                view_df[sort_col] = view_df[sort_col].astype(str)
            view_df = view_df.sort_values(by=sort_col, ascending=sort_asc)
        except Exception:
            pass

    csv_export = view_df.to_csv(index=False).encode('utf-8')
    st.download_button("🖨️ Export / Print This List (CSV)", data=csv_export,
                       file_name="inventory_export.csv", mime="text/csv", key="inv_export")

    with st.form("inv_editor"):
        edited_df = st.data_editor(
            view_df,
            use_container_width=True,
            height=height,
            num_rows="dynamic",
            column_config={
                "SKU":            st.column_config.TextColumn("SKU"),
                "Active":         st.column_config.CheckboxColumn("Active", help="Uncheck to hide from kiosk and searches"),
                "Price":          st.column_config.NumberColumn(format="$%.2f"),
                "WholesalePrice": st.column_config.NumberColumn(format="$%.2f"),
                "Cost":           st.column_config.NumberColumn(format="$%.2f"),
            }
        )
        if st.form_submit_button("💾 Save Changes"):
            full_inv.update(edited_df)
            deleted_idx = view_df.index.difference(edited_df.index)
            full_inv = full_inv.drop(index=deleted_idx, errors='ignore')
            new_idx = edited_df.index.difference(view_df.index)
            if not new_idx.empty:
                full_inv = pd.concat([full_inv, edited_df.loc[new_idx]], ignore_index=True)
            db.update_inventory_batch(full_inv.reset_index(drop=True))
            st.success("Database Updated Successfully!")
            auto_refresh()

# --- INIT STATE ---
if 'cart' not in st.session_state:
    st.session_state['cart'] = []
if 'inv_fullscreen' not in st.session_state:
    st.session_state['inv_fullscreen'] = False
if 'data' not in st.session_state or not st.session_state['data']:
    with st.spinner("Connecting to Headquarters..."):
        st.session_state['data'] = db.get_data()
        if not st.session_state['data']:
            st.warning("⚠️ Could not load data from Google Sheets. Check your connection or API limits.")
            st.stop() # This halts the app so it doesn't crash on line 420!

# --- AUTH GUARD: Unauthenticated users go to Kiosk ---
if not st.session_state.get('admin_authenticated'):
    st.switch_page("pages/Kiosk.py")

# --- SIDEBAR ---
with st.sidebar:
    st.markdown("## 🧵 Notion to Sew")
    st.caption("Admin Portal")
    st.divider()
    menu = st.radio("Navigate", ["📊 Dashboard", "📦 Inventory", "🛒 Checkout", "👥 Customers", "📝 Reports", "⚙️ Settings"])
    st.divider()
    if st.button("🔄 Refresh Database"):
        auto_refresh()

# ==========================================
# FULLSCREEN: EDIT DATABASE
# ==========================================
if st.session_state.get('inv_fullscreen'):
    st.markdown("""<style>
    section[data-testid="stSidebar"] { display: none !important; }
    .block-container { max-width: 100% !important; padding: 0.5rem 1.5rem !important; }
    #sheets-fab { display: none !important; }
    </style>""", unsafe_allow_html=True)
    _hdr, _exit = st.columns([4, 1])
    _hdr.subheader("📋 Edit Inventory Database — Full Screen")
    if _exit.button("✕ Exit Full Screen", use_container_width=True, type="primary"):
        st.session_state['inv_fullscreen'] = False
        st.rerun()
    _render_inv_editor(height=900)
    st.stop()

# ==========================================
# 1. DASHBOARD
# ==========================================
if menu == "📊 Dashboard":
    page_header("📊", "Dashboard", "Sales overview and recent activity")
    col_d1, col_d2 = st.columns(2)
    today = date.today()
    start_of_month = date(today.year, today.month, 1)
    d_start = col_d1.date_input("Start Date", value=start_of_month)
    d_end = col_d2.date_input("End Date", value=today)
    
    if 'transactions' in st.session_state['data']:
        df = st.session_state['data']['transactions'].copy()
        df_cust = st.session_state['data']['customers'].copy()
        
        # Date Filter
        df['DateObj'] = pd.to_datetime(df['Timestamp']).dt.date
        mask = (df['DateObj'] >= d_start) & (df['DateObj'] <= d_end)
        df_filtered = df[mask].copy()
        
        # Metrics
        df_filtered['TotalAmount'] = pd.to_numeric(df_filtered['TotalAmount'], errors='coerce').fillna(0)
        total_sales = df_filtered['TotalAmount'].sum()
        
        unpaid_df = df[df['Status'].astype(str).str.strip().str.lower().isin(['pending', 'unpaid', 'open'])]
        unpaid_total = pd.to_numeric(unpaid_df['TotalAmount'], errors='coerce').sum()
        
        c1, c2, c3 = st.columns(3)
        c1.metric("Revenue (Period)", f"${total_sales:,.2f}")
        c2.metric("Unpaid (All Time)", f"${unpaid_total:,.2f}", delta_color="inverse")
        c3.metric("Orders (Period)", len(df_filtered))
        
        st.subheader("Recent Activity")
        
        # PREPARE GRANDMA-FRIENDLY TABLE
        # 1. Merge to get Customer Name
        df_display = df_filtered.merge(df_cust[['CustomerID', 'Name']], on='CustomerID', how='left')
        df_display['Name'] = df_display['Name'].fillna('Guest / Unknown')
        
        # 2. Select & Rename Columns
        df_display = df_display[['Timestamp', 'Name', 'TotalAmount', 'Status', 'PaymentMethod']]
        df_display.columns = ["Date & Time", "Customer", "Total", "Status", "Payment"]
        
        # 3. Sort Newest First
        df_display = df_display.sort_values(by="Date & Time", ascending=False).head(20)
        
        # 4. Display with Formatting
        st.dataframe(
            df_display,
            use_container_width=True,
            hide_index=True,
            column_config={
                "Total": st.column_config.NumberColumn(format="$%.2f"),
                "Date & Time": st.column_config.DatetimeColumn(format="MMM DD, h:mm a"),
                "Status": st.column_config.TextColumn(),
            }
        )

# ==========================================
# 2. INVENTORY
# ==========================================
elif menu == "📦 Inventory":
    page_header("📦", "Inventory", "Manage products, stock levels, and costs")
    
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
                new_cost_val = c2.number_input("Unit Cost ($)", 0.0, 10000.0, float(row.get('Cost', 0.0)))

                st.caption(f"New Total Stock will be: {row['StockQty'] + qty_add}")

                st.divider()
                log_purchase = st.checkbox("📒 Also log as Inventory Purchase expense?", value=True,
                                           help="Records total purchase cost in Expenses for accurate P&L reporting")
                ex_c1, ex_c2 = st.columns(2)
                ex_date = ex_c1.date_input("Purchase Date", value=date.today())
                ex_desc = ex_c2.text_input("Description", value=f"Restocked {row['Name']} (SKU: {row['SKU']})")

                if st.form_submit_button("➕ Update Stock & Cost", type="primary"):
                    db.restock_item(lookup_sku, qty_add, new_cost_val)
                    if log_purchase and new_cost_val > 0:
                        total_purchase = qty_add * new_cost_val
                        db.add_expense(ex_date, "Inventory Purchase", total_purchase, ex_desc)
                        st.success(f"Added {qty_add} units to {row['Name']} and logged ${total_purchase:.2f} inventory purchase expense!")
                    else:
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
        _fs_col, _ = st.columns([1, 5])
        if _fs_col.button("⛶ Full Screen", key="inv_fs_open"):
            st.session_state['inv_fullscreen'] = True
            st.rerun()
        _render_inv_editor(height=600)

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
    page_header("🛒", "Point of Sale", "Admin checkout with invoice + wholesale support")

    # --- SUCCESS STATE ---
    if st.session_state.get('checkout_complete'):
        st.success(f"✅ Order #{st.session_state['last_order']['id']} Recorded Successfully!")
        
        c1, c2, c3 = st.columns(3)
        
        # 1. View Invoice
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

        # Preview Modal (JUMBO SIZE)
        if st.session_state.get('view_last_invoice'):
            st.divider()
            st.caption("ℹ️ To print: Download the PDF and print from your computer.")
            # Increased Width and Height significantly
            pdf_viewer(input=st.session_state['last_order']['pdf'], width=1000, height=1000)
            
            if st.button("❌ Close Preview"):
                st.session_state['view_last_invoice'] = False
                st.rerun()

    # --- NORMAL CHECKOUT SCREEN ---
    else:
        c1, c2 = st.columns([1.5, 1])
        
        # LEFT: Add Item
        with c1:
            st.subheader("Add Item")
            is_wholesale = st.checkbox("Apply Wholesale Pricing?", key='ck_wholesale')
            inv = st.session_state['data']['inventory'].copy()
            cust = st.session_state['data']['customers']
            # Hide inactive items from checkout search
            if 'Active' in inv.columns:
                inv = inv[inv['Active'].apply(lambda x: str(x).strip().lower() not in ['false', '0', 'no', ''])]
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

        # RIGHT: Cart & Pay
        with c2:
            with st.container(border=True):
                st.subheader("Current Order")
                if not st.session_state['cart']: 
                    st.info("Cart is empty.")
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
                    
                    try:
                        tax_rate = float(str(raw_rate).replace("%", "").strip())
                        if tax_rate > 1: tax_rate = tax_rate / 100
                    except: tax_rate = 0.0
                    # Always start with the fresh global rate; only override if a customer
                    # with a custom rate is actively selected (set via rerun in customer block below)
                    cust_has_custom_rate = (
                        st.session_state.get('co_last_cust') is not None and
                        st.session_state.get('co_effective_tax_rate') is not None and
                        st.session_state.get('co_effective_tax_rate') != tax_rate
                    )
                    effective_tax_rate = st.session_state['co_effective_tax_rate'] if cust_has_custom_rate else tax_rate

                    apply_tax = st.checkbox(f"Apply Tax ({(effective_tax_rate*100):.3f}%)", value=not is_wholesale)
                    tax_amt = subtotal * effective_tax_rate if apply_tax else 0.0
                    cart_total = subtotal + tax_amt

                    # CUSTOMER & CREDIT LOGIC
                    cust_tab1, cust_tab2 = st.tabs(["Existing", "New"])
                    selected_cust = None; cust_credit = 0.0; cust_id = "Guest"
                    with cust_tab1:
                        selected_cust_name = st.selectbox("Customer", cust['Name'], index=None, key='co_cust_sel')
                        if selected_cust_name:
                            selected_cust = selected_cust_name
                            cust_row = cust[cust['Name'] == selected_cust].iloc[0]
                            cust_id = cust_row['CustomerID']
                            try: cust_credit = float(cust_row.get('Credit', 0) if cust_row.get('Credit') != "" else 0)
                            except: cust_credit = 0.0
                            cust_is_wholesale = str(cust_row.get('IsWholesale', '')).strip().upper() == 'TRUE'
                            # Per-customer tax rate override
                            raw_cust_tax = str(cust_row.get('TaxRate', '')).strip()
                            try:
                                cust_tax_val = float(raw_cust_tax)
                                new_eff_rate = (cust_tax_val / 100 if cust_tax_val > 1 else cust_tax_val) if cust_tax_val > 0 else tax_rate
                            except (ValueError, TypeError):
                                new_eff_rate = tax_rate
                            # Rerun when customer changes so wholesale + tax rate update before checkbox renders
                            if selected_cust_name != st.session_state.get('co_last_cust'):
                                st.session_state['co_last_cust'] = selected_cust_name
                                st.session_state['ck_wholesale'] = cust_is_wholesale
                                st.session_state['co_effective_tax_rate'] = new_eff_rate
                                st.rerun()
                            if cust_is_wholesale:
                                st.info("🏭 Wholesale customer — wholesale pricing auto-applied")
                        else:
                            if st.session_state.get('co_last_cust') is not None:
                                st.session_state['co_last_cust'] = None
                                st.session_state['co_effective_tax_rate'] = tax_rate
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
                                # Generate PDF
                                address = db.get_settings_dict().get("Address", "Modesto, CA")
                                
                                pdf_bytes = db.create_pdf(new_id, selected_cust, address, st.session_state['cart'], subtotal, tax_amt, cart_total, "Upon Receipt", credit_applied=credit_applied)
                                
                                # Store State
                                st.session_state['last_order'] = {
                                    'id': new_id,
                                    'pdf': pdf_bytes
                                }
                                st.session_state['checkout_complete'] = True
                                st.session_state['cart'] = []
                                st.rerun()
                        else: st.error("Select customer (required for non-cash orders).")

# ==========================================
# 4. CUSTOMERS (Card View & CRM)
# ==========================================
elif menu == "👥 Customers":
    page_header("👥", "Customers", "CRM — profiles, purchase history, and store credit")
    
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
                        if st.button("Manage ➝", key=f"btn_m_{i}_{row['CustomerID']}"):
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

            # Pre-compute transaction history so the preview can render full-width below columns
            my_trans = df_trans[df_trans['CustomerID'] == cid]
            if not my_trans.empty:
                my_trans = my_trans.sort_values(by="Timestamp", ascending=False)

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
                        st.divider()
                        u_wholesale = st.checkbox(
                            "🏭 Wholesale Customer",
                            value=str(row.get('IsWholesale', '')).strip().upper() == 'TRUE',
                            help="Auto-applies wholesale pricing and no tax at checkout"
                        )
                        raw_cust_tax = str(row.get('TaxRate', '')).strip()
                        try:
                            stored_rate = float(raw_cust_tax)
                            display_rate = stored_rate * 100 if stored_rate < 1.0 else stored_rate
                        except (ValueError, TypeError):
                            display_rate = 0.0
                        u_tax_override = st.number_input(
                            "Custom Tax Rate (% — 0 = use global default)",
                            min_value=0.0, max_value=100.0,
                            value=float(display_rate), step=0.001, format="%.3f",
                            help="Overrides the global tax rate for this customer only."
                        )
                        if st.form_submit_button("💾 Save Changes"):
                            tax_override_decimal = u_tax_override / 100.0 if u_tax_override > 0 else None
                            db.update_customer_details(cid, u_name, u_addr, u_phone, u_notes,
                                                       is_wholesale=u_wholesale,
                                                       tax_rate_override=tax_override_decimal)
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
                if my_trans.empty:
                    st.info("No purchase history.")
                else:
                    # Iterate with Index (i) to fix duplicate key error
                    for i, t_row in my_trans.iterrows():
                        with st.container(border=True):
                            c_d, c_a, c_s, c_act = st.columns([1.5, 1, 1, 1.5])

                            c_d.write(f"**{str(t_row['Timestamp'])[:10]}**")
                            c_d.caption(f"#{t_row['TransactionID']}")

                            try: amt = float(t_row['TotalAmount'] if t_row['TotalAmount'] != '' else 0)
                            except: amt = 0.0
                            c_a.write(f"**${amt:.2f}**")

                            status_raw = str(t_row['Status']).strip()
                            is_paid = status_raw.lower() not in ['pending', 'unpaid', 'open']
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

                        # --- INLINE PREVIEWER (Now part of the same loop for better UX) ---
                        if st.session_state.get(f"view_inv_{t_row['TransactionID']}", False):
                            with st.container(border=True):
                                if st.button("❌ Close Preview", key=f"cls_{t_row['TransactionID']}_{i}"):
                                    st.session_state[f"view_inv_{t_row['TransactionID']}"] = False
                                    st.rerun()
                                t_id = str(t_row['TransactionID'])
                                pdf_bytes = _build_invoice_pdf(t_id, row['Name'])
                                st.download_button(
                                    "🖨️ Download / Print Invoice",
                                    data=pdf_bytes,
                                    file_name=f"Invoice_{t_id}.pdf",
                                    mime="application/pdf",
                                    key=f"dl_{t_id}_{i}",
                                    type="primary",
                                    use_container_width=True
                                )
                                pdf_viewer(input=pdf_bytes, width=1000, height=1000)

# ==========================================
# 5. REPORTS
# ==========================================
elif menu == "📝 Reports":
    page_header("📝", "Financial Reports", "Income statement, tax liability, top sellers, and A/R")
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
            valid_ids = f_trans['TransactionID'].astype(str).tolist()
            df_items['TransactionID'] = df_items['TransactionID'].astype(str)
            f_items = df_items[df_items['TransactionID'].isin(valid_ids)].copy()
            # Exclude non-product items (gift certificates have no inventory cost)
            f_items = f_items[~f_items['SKU'].astype(str).str.upper().str.startswith('GIFT')]

            if 'inventory' in st.session_state['data']:
                inv_ref = st.session_state['data']['inventory'][['SKU', 'Cost']].copy()
                inv_ref['SKU'] = inv_ref['SKU'].astype(str)
                f_items['SKU'] = f_items['SKU'].astype(str)
                merged_items = f_items.merge(inv_ref, on='SKU', how='left')
                merged_items['QtySold'] = pd.to_numeric(merged_items['QtySold'], errors='coerce').fillna(0)
                merged_items['Cost'] = pd.to_numeric(merged_items['Cost'], errors='coerce')
                no_cost_skus = merged_items[merged_items['Cost'].isna() | (merged_items['Cost'] == 0)]['SKU'].unique()
                if len(no_cost_skus) > 0:
                    st.warning(f"⚠️ COGS may be understated: {len(no_cost_skus)} SKU(s) sold in this period have no unit cost entered. Set costs in Inventory to improve accuracy.")
                merged_items['LineCost'] = merged_items['QtySold'] * merged_items['Cost'].fillna(0)
                total_cogs = merged_items['LineCost'].sum()
            else: total_cogs = 0.0

            # Check for invoices with no line items (contribute $0 to COGS)
            product_item_ids = set(
                df_items[
                    df_items['TransactionID'].astype(str).isin(valid_ids) &
                    ~df_items['SKU'].astype(str).str.upper().str.startswith('GIFT')
                ]['TransactionID'].astype(str).unique()
            )
            invoices_no_items = [tid for tid in valid_ids if tid not in product_item_ids]
            if invoices_no_items:
                st.warning(
                    f"⚠️ {len(invoices_no_items)} invoice(s) in this period have no matching line item records "
                    f"and contribute $0 to COGS. This is common for old imported invoices. "
                    f"Invoice IDs: {', '.join(invoices_no_items[:10])}{'…' if len(invoices_no_items) > 10 else ''}"
                )

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
            
            # Preview
            st.divider()
            # No base64 encoding needed
            pdf_viewer(input=pdf_data, width=1000, height=1000)
            
            st.download_button(
                "⬇️ Download PDF", data=pdf_data,
                file_name=f"IncomeStatement_{r_start}_{r_end}.pdf",
                mime="application/pdf", type="primary", use_container_width=True
            )
            

        # --- LOG AN EXPENSE (always visible, outside Generate button) ---
        st.divider()
        with st.expander("➕ Log an Expense"):
            if 'settings' in st.session_state['data']:
                s_df = st.session_state['data']['settings']
                s_dict = dict(zip(s_df['Key'], s_df['Value']))
                raw_cats = s_dict.get("ExpenseCategories", "Fabric, Notions, Rent, Marketing, Shipping, Wages, Other")
                cat_options = [x.strip() for x in raw_cats.split(",") if x.strip()]
            else:
                cat_options = ["Fabric", "Notions", "Rent", "Marketing", "Other"]

            with st.form("log_expense_form"):
                ex_c1, ex_c2 = st.columns(2)
                ex_date = ex_c1.date_input("Date", value=date.today(), key="ex_date")
                ex_cat = ex_c2.selectbox("Category", cat_options, key="ex_cat")
                ex_c3, ex_c4 = st.columns(2)
                ex_amount = ex_c3.number_input("Amount ($)", 0.01, 100000.0, 10.0, key="ex_amount")
                ex_desc = ex_c4.text_input("Description", placeholder="e.g. Fabric from JoAnn", key="ex_desc")
                if st.form_submit_button("💾 Save Expense", type="primary"):
                    db.add_expense(ex_date, ex_cat, ex_amount, ex_desc)
                    st.success(f"Logged ${ex_amount:.2f} under {ex_cat}.")
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

    # --- TAB 3: TOP SELLERS (Product Focused) ---
    with tab3:
        st.header("🏆 Product Performance")
        
        # 1. Controls
        c1, c2, c3 = st.columns([1, 1, 2])
        ts_start = c1.date_input("Start Date", value=date(date.today().year, 1, 1), key="ts_start")
        ts_end = c2.date_input("End Date", value=date.today(), key="ts_end")
        rank_by = c3.radio("Rank Products By:", ["Quantity Sold", "Total Revenue ($)", "Net Profit ($)"], horizontal=True)
        
        # 2. Data Preparation
        df_items = st.session_state['data']['items'].copy()
        df_trans = st.session_state['data']['transactions'][['TransactionID', 'Timestamp']].copy()
        
        # Merge Transactions to get Date
        df_items['TransactionID'] = df_items['TransactionID'].astype(str)
        df_trans['TransactionID'] = df_trans['TransactionID'].astype(str)
        merged = df_items.merge(df_trans, on='TransactionID', how='left')
        
        # Filter by Date
        merged['DateObj'] = pd.to_datetime(merged['Timestamp']).dt.date
        mask = (merged['DateObj'] >= ts_start) & (merged['DateObj'] <= ts_end)
        filtered_items = merged[mask].copy()
        
        if not filtered_items.empty:
            # Clean Numbers
            filtered_items['QtySold'] = pd.to_numeric(filtered_items['QtySold'], errors='coerce').fillna(0)
            filtered_items['Price'] = pd.to_numeric(filtered_items['Price'], errors='coerce').fillna(0)
            
            # Merge with Inventory to get COST (exclude gift certificates)
            filtered_items = filtered_items[~filtered_items['SKU'].astype(str).str.upper().str.startswith('GIFT')]
            if 'inventory' in st.session_state['data']:
                inv_ref = st.session_state['data']['inventory'][['SKU', 'Cost']].copy()
                inv_ref['SKU'] = inv_ref['SKU'].astype(str)
                filtered_items['SKU'] = filtered_items['SKU'].astype(str)
                full_data = filtered_items.merge(inv_ref, on='SKU', how='left')
                full_data['Cost'] = pd.to_numeric(full_data['Cost'], errors='coerce').fillna(0)
            else:
                full_data = filtered_items.copy()
                full_data['Cost'] = 0.0

            # Calculate Metrics
            full_data['Revenue'] = full_data['QtySold'] * full_data['Price']
            full_data['TotalCost'] = full_data['QtySold'] * full_data['Cost']
            full_data['Profit'] = full_data['Revenue'] - full_data['TotalCost']
            
            # Group by Product
            product_group = full_data.groupby(['Name', 'SKU'])[['QtySold', 'Revenue', 'Profit']].sum().reset_index()
            
            # Sort
            if "Revenue" in rank_by:
                sorted_df = product_group.sort_values(by='Revenue', ascending=False)
                metric_col = 'Revenue'
                chart_color = "#2ecc71" # Green
            elif "Profit" in rank_by:
                sorted_df = product_group.sort_values(by='Profit', ascending=False)
                metric_col = 'Profit'
                chart_color = "#f1c40f" # Gold
            else:
                sorted_df = product_group.sort_values(by='QtySold', ascending=False)
                metric_col = 'QtySold'
                chart_color = "#3498db" # Blue
            
            # --- VISUALIZATION: TOP 10 CHART ---
            st.subheader(f"📊 Top 10 by {rank_by.split('(')[0].strip()}")
            top_10 = sorted_df.head(10).set_index('Name')
            st.bar_chart(top_10[metric_col], color=chart_color)
            
            st.divider()

            # --- DETAILED TABLE ---
            st.subheader("📋 Product Leaderboard")
            st.dataframe(
                sorted_df.head(50), # Showing top 50 rows
                use_container_width=True,
                hide_index=True,
                column_config={
                    "Name": st.column_config.TextColumn("Product Name", width="medium"),
                    "SKU": st.column_config.TextColumn("SKU", width="small"),
                    "QtySold": st.column_config.NumberColumn("Sold", format="%d"),
                    "Revenue": st.column_config.NumberColumn("Revenue", format="$%.2f"),
                    "Profit": st.column_config.NumberColumn("Profit", format="$%.2f"),
                }
            )
            
        else:
            st.info("No sales found in this period.")

    with tab4:
        st.header("Accounts Receivable")
        df_trans = st.session_state['data']['transactions']
        df_cust = st.session_state['data']['customers']
        df_items = st.session_state['data']['items']
        pending = df_trans[df_trans['Status'].astype(str).str.strip().str.lower().isin(['pending', 'unpaid', 'open'])].copy()
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

                # Previewer (Unpaid Report)
                if st.session_state.get(f"view_inv_{row['TransactionID']}", False):
                    with st.container(border=True):
                        if st.button("❌ Close", key=f"uclose_{row['TransactionID']}"):
                            st.session_state[f"view_inv_{row['TransactionID']}"] = False
                            st.rerun()

                        # Build PDF from stored transaction data
                        t_id = str(row['TransactionID'])
                        pdf_bytes = _build_invoice_pdf(t_id, cust_name)
                        
                        # 2. Download Button
                        st.download_button(
                            "🖨️ Download Invoice", 
                            data=pdf_bytes,
                            file_name=f"Invoice_{t_id}.pdf",
                            mime="application/pdf",
                            key=f"dl_unpaid_{t_id}",
                            type="primary",
                            use_container_width=True
                        )

                        # 3. PDF Viewer (No Base64!)
                        pdf_viewer(input=pdf_bytes, width=700, height=800)

# ==========================================
# 6. SETTINGS
# ==========================================
elif menu == "⚙️ Settings":
    page_header("⚙️", "Settings", "Company info, tax rate, invoice numbering")
    
    # Load Settings
    if 'settings' in st.session_state['data']:
        raw_settings = st.session_state['data']['settings']
        settings_dict = dict(zip(raw_settings['Key'], raw_settings['Value']))
    else: settings_dict = {}

    with st.form("settings_form"):
        col1, col2 = st.columns(2)
        
        # COLUMN 1: Company Info
        with col1:
            st.subheader("🏢 Company Info")
            c_name = st.text_input("Company Name", value=settings_dict.get("CompanyName", "Notion to Sew"))
            c_addr = st.text_area("Address", value=settings_dict.get("Address", "Modesto, CA"))
            
            st.subheader("💰 Financials")
            venmo_user = st.text_input("Venmo Username", value=settings_dict.get("VenmoUser", ""))
            
        # COLUMN 2: Operations
        with col2:
            st.subheader("⚙️ Operations")
            # Tax Rate Logic
            raw_val = settings_dict.get("TaxRate", "0.08")
            try:
                clean_val = float(str(raw_val).replace("%", "").strip())
                # Normalize: stored as decimal (0.0875) → display as 8.75; stored as percent (8.75) → display as 8.75
                display_rate = clean_val * 100 if clean_val < 1.0 else clean_val
            except ValueError:
                display_rate = 8.0
            # Guard: clamp display_rate to a sane percentage range (0–99)
            display_rate = max(0.0, min(float(display_rate), 99.0))

            new_rate_percent = st.number_input(
                "Sales Tax Rate — enter as a percentage, e.g. 8.75 for 8.75%",
                min_value=0.0, max_value=99.0,
                value=display_rate, step=0.001, format="%.3f"
            )
            st.caption(f"ℹ️ Will be applied as **{new_rate_percent:.3f}%** on retail sales.")
            next_inv = st.text_input("Next Invoice ID", value=settings_dict.get("NextInvoiceID", "1000"))
            
            # NEW: Expense Categories Management
            st.divider()
            st.markdown("### 🏷️ Expense Categories")
            st.caption("Separate categories with commas.")
            default_cats = "Fabric, Notions, Rent, Marketing, Shipping, Wages, Other"
            current_cats = settings_dict.get("ExpenseCategories", default_cats)
            new_cats = st.text_area("Categories", value=current_cats, height=100)

        st.divider()
        if st.form_submit_button("💾 Save All Settings", type="primary"):
            decimal_rate = new_rate_percent / 100
            
            # Clean up the categories list (remove extra spaces)
            clean_cats_str = ", ".join([x.strip() for x in new_cats.split(",") if x.strip()])
            
            updates = {
                "CompanyName": c_name, 
                "Address": c_addr, 
                "TaxRate": decimal_rate, 
                "NextInvoiceID": next_inv, 
                "VenmoUser": venmo_user,
                "ExpenseCategories": clean_cats_str  # Saving the new list
            }
            db.update_settings(updates)
            st.success("✅ Settings Saved!")
            auto_refresh()

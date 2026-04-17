import streamlit as st
import backend as db
import pandas as pd
import base64
import streamlit.components.v1 as components

# --- CONFIG (iPad Optimized - Refined) ---
st.set_page_config(page_title="Kiosk | Notion to Sew", layout="wide", initial_sidebar_state="collapsed")

# --- KEEP APP AWAKE ---
components.html(
    """<script>
    setInterval(function() {
        fetch('/_stcore/health').catch(function(){});
    }, 540000);
    </script>""",
    height=0
)

# --- CUSTOM CSS FOR A MODERN KIOSK FEEL ---
st.markdown("""
<style>
    /* Global Styles */
    .main {
        background-color: #fcfaf9;
    }
    
    /* Hero Banner - Much Slimmer */
    .hero-container {
        background: linear-gradient(135deg, #5d6d7e 0%, #85929e 100%);
        padding: 0.8rem 1rem;
        border-radius: 0.8rem;
        color: white;
        text-align: center;
        margin-bottom: 1rem;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
    }
    .hero-title {
        font-size: 1.4rem !important;
        font-weight: 700 !important;
        margin-bottom: 0rem !important;
        letter-spacing: -0.5px;
    }
    .hero-subtitle {
        font-size: 0.8rem !important;
        opacity: 0.85;
    }
    
    /* Dominant Search Box Styling */
    div[data-baseweb="select"] {
        border-radius: 1.2rem !important;
        border: 2px solid #5d6d7e !important;
        height: 80px !important;
        display: flex !important;
        align-items: center !important;
        font-size: 1.5rem !important;
    }
    
    div[data-baseweb="select"] > div {
        height: 100% !important;
        display: flex !important;
        align-items: center !important;
    }

    div[data-baseweb="select"] input {
        font-size: 1.5rem !important;
    }

    /* Cart Button Tuning */
    .stButton > button[kind="primary"] {
        height: 60px !important;
        font-size: 1.2rem !important;
        font-weight: 600 !important;
    }
    
    /* Card Styling */
    .stButton button {
        border-radius: 0.6rem !important;
        transition: all 0.2s ease-in-out !important;
    }
    
    /* Quick Add Section */
    .quick-add-header {
        font-size: 1.3rem;
        font-weight: 700;
        margin-top: 1.5rem;
        margin-bottom: 0.8rem;
        color: #2c3e50;
    }
</style>
""", unsafe_allow_html=True)

# --- INIT ---
if 'data' not in st.session_state or not st.session_state['data']:
    st.session_state['data'] = db.get_data()
if 'kiosk_cart' not in st.session_state: st.session_state['kiosk_cart'] = []
if 'page' not in st.session_state: st.session_state['page'] = 'shop'
if 'show_admin_login' not in st.session_state: st.session_state['show_admin_login'] = False

# --- HELPERS ---
def go_home(): st.session_state['page'] = 'shop'
def go_checkout(): st.session_state['page'] = 'checkout'

def _get_pdf_print_button(pdf_bytes, label="🖨️ Print / Open in New Tab"):
    try:
        b64 = base64.b64encode(pdf_bytes).decode()
        html = f"""
            <a href="data:application/pdf;base64,{b64}" target="_blank" style="text-decoration: none;">
                <button style="width: 100%; background-color: #FF4B4B; color: white; padding: 0.5rem 1rem; border: none; border-radius: 0.5rem; cursor: pointer; font-weight: 500; font-size: 1rem; margin-top: 10px; margin-bottom: 10px;">
                    {label}
                </button>
            </a>
        """
        st.markdown(html, unsafe_allow_html=True)
    except: pass

# --- STAFF ACCESS (RESTORED) ---
with st.sidebar:
    st.markdown("### 🔐 Staff Access")
    st.caption("Enter your PIN to open the Admin portal.")
    pin_input = st.text_input("PIN", type="password", label_visibility="collapsed", placeholder="Enter PIN")
    if st.button("Unlock Admin ➝", use_container_width=True):
        correct_pin = str(st.secrets.get("admin", {}).get("pin", "1234"))
        if pin_input == correct_pin:
            st.session_state['admin_authenticated'] = True
            st.switch_page("Home.py")
        else:
            st.error("Incorrect PIN")

# --- ADMIN FAB ---
st.markdown('<a id="admin-fab" href="?admin_open=1" style="position:fixed; top:16px; right:16px; width:42px; height:42px; border-radius:50%; background:rgba(255,255,255,0.5); border:1px solid rgba(218,220,224,0.6); display:flex; align-items:center; justify-content:center; font-size:16px; z-index:99999; box-shadow:0 1px 4px rgba(0,0,0,0.08); backdrop-filter:blur(6px); opacity:0.22; text-decoration:none;">🔐</a>', unsafe_allow_html=True)

if st.query_params.get("admin_open") == "1":
    st.session_state['show_admin_login'] = True
    st.query_params.clear()

@st.dialog("Admin Sign In")
def admin_login_dialog():
    st.caption("Enter your PIN to open the Admin portal.")
    pin = st.text_input("PIN", type="password", placeholder="Enter PIN", label_visibility="collapsed")
    if st.button("Unlock →", type="primary", use_container_width=True):
        if pin == str(st.secrets.get("admin", {}).get("pin", "1234")):
            st.session_state['admin_authenticated'] = True
            st.switch_page("Home.py")
        else: st.error("Incorrect PIN")

if st.session_state['show_admin_login']:
    admin_login_dialog()

# ==========================================
# PAGE 1: THE SHOP
# ==========================================
if st.session_state['page'] == 'shop':
    cart_count = sum(item['qty'] for item in st.session_state['kiosk_cart'])

    # --- HERO SECTION (SLIMMER & SOFTER) ---
    st.markdown("""
        <div class="hero-container">
            <div class="hero-title">Notion to Sew</div>
            <div class="hero-subtitle">Quality Supplies · Local Service</div>
        </div>
    """, unsafe_allow_html=True)

    # --- DOMINANT SEARCH BAR ---
    df = st.session_state['data']['inventory'].copy()
    if 'Active' in df.columns:
        df = df[df['Active'].apply(lambda x: str(x).strip().lower() not in ['false', '0', 'no', ''])]
    df['lookup'] = df.apply(lambda r: f"{r['SKU']} — {r['Name']} (${float(r['Price']):.2f})", axis=1)
    
    search_selection = st.selectbox(
        "Find Items",
        df['lookup'],
        index=None,
        placeholder="🔍  START TYPING TO SEARCH ITEMS...",
        label_visibility="collapsed",
        key="kiosk_item_search"
    )

    # --- CART & INFO ROW ---
    c_info, c_cart = st.columns([4, 1.2], vertical_alignment="center")
    
    with c_info:
        if not search_selection:
            st.markdown("### Please search for an item below to begin.")
        else:
            st.markdown("### Item found:")

    with c_cart:
        btn_label = f"🛒 CART ({cart_count})" if cart_count > 0 else "🛒 CART (0)"
        if st.button(btn_label, type="primary", use_container_width=True, disabled=cart_count == 0):
            go_checkout()
            st.rerun()

    # --- SEARCH RESULT VIEW ---
    if search_selection:
        sku = search_selection.split(" — ")[0].strip()
        row = df[df['SKU'].astype(str).str.strip() == sku].iloc[0]
        
        if 'main_qty' not in st.session_state: st.session_state['main_qty'] = 1
        
        st.write("")
        with st.container(border=True):
            cols = st.columns([3, 2, 2], vertical_alignment="center")
            with cols[0]:
                st.markdown(f"### {row['Name']}")
                st.caption(f"Item #: {row['SKU']}")
                st.markdown(f"## ${row['Price']:.2f}")
            with cols[1]:
                q1, q2, q3 = st.columns([1, 2, 1], vertical_alignment="center")
                if q1.button("−", key="main_sub"):
                    if st.session_state['main_qty'] > 1:
                        st.session_state['main_qty'] -= 1
                        st.rerun()
                q2.markdown(f"<div style='text-align:center;font-size:2rem;font-weight:600'>{st.session_state['main_qty']}</div>", unsafe_allow_html=True)
                if q3.button("＋", key="main_add"):
                    st.session_state['main_qty'] += 1
                    st.rerun()
            with cols[2]:
                def add_to_cart_kiosk(k_sku, k_name, k_price, k_qty):
                    for item in st.session_state['kiosk_cart']:
                        if item['sku'] == k_sku:
                            item['qty'] += k_qty
                            st.session_state['main_qty'] = 1
                            st.session_state['kiosk_item_search'] = None
                            return
                    st.session_state['kiosk_cart'].append({"sku": k_sku, "name": k_name, "price": k_price, "qty": k_qty})
                    st.session_state['main_qty'] = 1
                    st.session_state['kiosk_item_search'] = None

                st.button("Add to Cart", type="primary", use_container_width=True,
                          on_click=add_to_cart_kiosk, args=(row['SKU'], row['Name'], row['Price'], st.session_state['main_qty']))
                st.toast(f"Added {row['Name']}")

    # --- QUICK ADD SECTION ---
    else:
        st.markdown('<div class="quick-add-header">Popular Items</div>', unsafe_allow_html=True)
        popular_items = df.head(4) 
        p_cols = st.columns(4)
        for i, (idx, p_row) in enumerate(popular_items.iterrows()):
            with p_cols[i]:
                with st.container(border=True):
                    st.markdown(f"**{p_row['Name'][:22]}...**" if len(p_row['Name']) > 22 else f"**{p_row['Name']}**")
                    st.write(f"${p_row['Price']:.2f}")
                    if st.button("Add +", key=f"quick_add_{i}", use_container_width=True):
                        found = False
                        for item in st.session_state['kiosk_cart']:
                            if str(item['sku']) == str(p_row['SKU']):
                                item['qty'] += 1
                                found = True; break
                        if not found:
                            st.session_state['kiosk_cart'].append({"sku": p_row['SKU'], "name": p_row['Name'], "price": p_row['Price'], "qty": 1})
                        st.toast(f"Added {p_row['Name']}")
                        st.rerun()

    st.write("")
    st.info("Need help? Please ask — we are happy to assist.")

# ==========================================
# PAGE 2: CHECKOUT
# ==========================================
elif st.session_state['page'] == 'checkout':
    st.title("Checkout")
    if st.button("⬅️ Back to Shop", use_container_width=True):
        go_home(); st.rerun()
    st.divider()

    st.subheader("👤 Step 1: Who is checking out?")
    cust_tab1, cust_tab2 = st.tabs(["Search Name", "New Customer"])
    selected_cust_name = None; cust_row = None

    with cust_tab1:
        cust_df = st.session_state['data']['customers']
        selected_cust_name = st.selectbox("Name", cust_df['Name'], index=None, placeholder="Search customer name...", label_visibility="collapsed", key="kiosk_checkout_customer_sel")
        if selected_cust_name:
            cust_row = cust_df[cust_df['Name'] == selected_cust_name].iloc[0]

    with cust_tab2:
        with st.form("new_kiosk_cust"):
            n_name = st.text_input("Name"); n_email = st.text_input("Email")
            if st.form_submit_button("Join & Select"):
                if n_name:
                    new_cid = db.add_customer(n_name, n_email)
                    # We don't need to call force_refresh() here as add_customer already does it
                    st.session_state['data'] = db.get_data()
                    st.session_state['kiosk_checkout_customer_sel'] = n_name
                    st.rerun()
                else: st.error("Name required.")

    st.divider()
    st.subheader("🛒 Step 2: Your Items")
    if not st.session_state['kiosk_cart']:
        st.info("Cart is empty.")
    else:
        if 'settings' in st.session_state['data']:
            s_df = st.session_state['data']['settings']
            s_dict = dict(zip(s_df['Key'], s_df['Value']))
            raw_rate = s_dict.get("TaxRate", "0.08"); venmo_user = s_dict.get("VenmoUser", "")
        else: raw_rate = "0.08"; venmo_user = ""

        try:
            clean_rate = float(str(raw_rate).replace("%", "").strip())
            if clean_rate > 1: clean_rate = clean_rate / 100
        except: clean_rate = 0.0

        cust_credit = 0.0; cust_is_wholesale = False; cust_tax_override = None; cust_id = "Guest"
        if cust_row is not None:
            cust_id = cust_row['CustomerID']
            try: cust_credit = float(cust_row.get('Credit', 0) if cust_row.get('Credit') != "" else 0)
            except: cust_credit = 0.0
            cust_is_wholesale = str(cust_row.get('IsWholesale', '')).strip().upper() == 'TRUE'
            raw_cust_tax = str(cust_row.get('TaxRate', '')).strip()
            try:
                cust_tax_val = float(raw_cust_tax)
                if cust_tax_val > 0:
                    cust_tax_override = cust_tax_val / 100 if cust_tax_val > 1 else cust_tax_val
            except: pass

        if cust_tax_override is not None: clean_rate = cust_tax_override

        inv_df = st.session_state['data']['inventory']; checkout_cart = []
        for i, item in enumerate(st.session_state['kiosk_cart']):
            with st.container(border=True):
                c_desc, c_qty_edit, c_line_total, c_del = st.columns([3, 2, 1.5, 0.5])
                eff_price = item['price']
                if cust_is_wholesale:
                    inv_rows = inv_df[inv_df['SKU'].astype(str) == str(item['sku'])]
                    if not inv_rows.empty:
                        ws_p = float(inv_rows.iloc[0].get('WholesalePrice', 0) or 0)
                        if ws_p > 0: eff_price = ws_p
                
                c_desc.write(f"**{item['name']}**")
                c_desc.caption(f"Item #: {item['sku']} | Price: ${eff_price:.2f}")

                def update_qty(idx, new_val):
                    if new_val > 0: st.session_state['kiosk_cart'][idx]['qty'] = new_val
                    else: st.session_state['kiosk_cart'].pop(idx)

                new_q = c_qty_edit.number_input("Qty", 1, 1000, value=int(item['qty']), key=f"edit_q_{i}")
                if new_q != item['qty']: update_qty(i, new_q); st.rerun()

                c_line_total.write(f"**${new_q * eff_price:.2f}**")
                if c_del.button("🗑️", key=f"del_{i}"): st.session_state['kiosk_cart'].pop(i); st.rerun()
                checkout_cart.append({**item, 'price': eff_price, 'qty': new_q})

        st.divider()
        st.subheader("💰 Step 3: Total & Payment")
        subtotal = sum(i['qty'] * i['price'] for i in checkout_cart)
        tax_amt = 0.0 if cust_is_wholesale else subtotal * clean_rate
        total = subtotal + tax_amt

        col_tot1, col_tot2 = st.columns([1, 1])
        with col_tot1:
            if cust_is_wholesale: st.info("🏭 Wholesale customer — pricing applied, no tax")
            st.write(f"Subtotal: ${subtotal:.2f}"); st.write(f"Tax: ${tax_amt:.2f}")
            credit_applied = 0.0
            if cust_row is not None and cust_credit > 0:
                st.info(f"💎 You have **${cust_credit:.2f}** credit!")
                if st.checkbox("Apply Credit?"):
                    credit_applied = min(cust_credit, total)
                    st.write(f"Applied: -${credit_applied:.2f}")
            st.markdown(f"## Total Due: ${max(0.0, total - credit_applied):.2f}")

        with col_tot2:
            pay_method = st.radio("Payment Method", ["Cash", "Venmo", "Pay Later (Invoice)"], horizontal=True)
            if not selected_cust_name:
                st.error("⚠️ Please search for your name or create a profile in Step 1."); can_finish = False
            else: can_finish = True

            if pay_method == "Venmo" and venmo_user:
                st.image(f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://venmo.com/u/{venmo_user}", width=150)

            if st.button("✅ Finish Sale", type="primary", use_container_width=True, disabled=not can_finish):
                try:
                    cust_display = selected_cust_name or "Guest"
                    status = "Pending" if pay_method == "Pay Later (Invoice)" else "Paid"
                    with st.spinner("Processing..."):
                        new_id = db.commit_sale(checkout_cart, total, tax_amt, cust_id, pay_method, cust_is_wholesale, status, credit_used=credit_applied)
                        address = db.get_settings_dict().get("Address", "Modesto, CA")
                        pdf_bytes = db.create_pdf(new_id, cust_display, address, checkout_cart, subtotal, tax_amt, total, "Upon Receipt", credit_applied=credit_applied)
                        st.session_state['last_kiosk_order'] = {
                            'id': new_id, 'pdf': pdf_bytes, 'customer': cust_display,
                            'customer_email': str(cust_row.get('Email', '') or '') if cust_row is not None else "",
                            'email_sent': False, 'total': max(0.0, total - credit_applied),
                        }
                        st.session_state['kiosk_cart'] = []; st.session_state['page'] = 'success'
                        db.force_refresh(); st.rerun()
                except Exception as e: st.error(f"Error: {e}")

    st.write("<br><br><br><br>", unsafe_allow_html=True); st.caption("Notion to Sew · Kiosk v1.2")

# ==========================================
# PAGE 3: SUCCESS
# ==========================================
elif st.session_state['page'] == 'success':
    components.html("""<script>setTimeout(function() { window.parent.location.assign(window.parent.location.origin + window.parent.location.pathname); }, 120000);</script>""", height=0)
    order = st.session_state.get('last_kiosk_order', {})
    c1, c2, c3 = st.columns([1, 2, 1])
    with c2:
        with st.container(border=True):
            st.markdown("# ✅ Thank You!")
            st.subheader(f"Order #{order.get('id', '')} · ${order.get('total', 0):.2f}")
        
        st.write("")
        with st.container(border=True):
            st.subheader("📧 Email Receipt")
            if order.get('email_sent'): st.success(f"Receipt sent to **{order.get('receipt_email')}**")
            else:
                st.text_input("Enter Email", value=order.get('customer_email', ''), key="kiosk_receipt_email")
                def send_receipt_action(order_data):
                    email_addr = st.session_state.get("kiosk_receipt_email", "").strip()
                    if not email_addr: st.session_state['email_error_msg'] = "Enter an email address."; return
                    try:
                        db.send_receipt_email(email_addr, order_data['id'], order_data['pdf'])
                        st.session_state['last_kiosk_order']['email_sent'] = True
                        st.session_state['last_kiosk_order']['receipt_email'] = email_addr
                    except Exception as e: st.session_state['email_error_msg'] = str(e)
                st.button("Send Receipt ➝", type="primary", use_container_width=True, on_click=send_receipt_action, args=(order,))
                if 'email_error_msg' in st.session_state: st.error(st.session_state['email_error_msg']); del st.session_state['email_error_msg']

        st.write("")
        with st.container(border=True):
            st.subheader("🖨️ In-Store Print")
            if order.get('pdf'):
                _get_pdf_print_button(order['pdf'], label="Open / Print Receipt Now")
                st.download_button("💾 Save PDF", data=order['pdf'], file_name=f"Receipt_{order.get('id', 'order')}.pdf", mime="application/pdf", use_container_width=True)

            st.write("")
            if st.button("🏠 Start New Order", type="primary", use_container_width=True):
                st.session_state['last_kiosk_order'] = None; go_home(); st.rerun()

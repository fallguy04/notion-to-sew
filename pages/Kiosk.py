import streamlit as st
import backend as db
import pandas as pd
import base64
import streamlit.components.v1 as components

# --- CONFIG (iPad Optimized - Refined) ---
st.set_page_config(page_title="Kiosk | Notion to Sew", layout="wide", initial_sidebar_state="collapsed")

# --- KEEP APP AWAKE: pings Streamlit health endpoint every 9 min so the app never sleeps ---
components.html(
    """<script>
    setInterval(function() {
        fetch('/_stcore/health').catch(function(){});
    }, 540000);
    </script>""",
    height=0
)


# --- INIT ---
if 'data' not in st.session_state or not st.session_state['data']:
    st.session_state['data'] = db.get_data()
    if not st.session_state['data']:
        st.warning("⚠️ Could not load data from Google Sheets.")
        st.stop()
if 'kiosk_cart' not in st.session_state: st.session_state['kiosk_cart'] = []
if 'page' not in st.session_state: st.session_state['page'] = 'shop'
if 'show_admin_login' not in st.session_state: st.session_state['show_admin_login'] = False

# --- ADMIN FAB: detect click via query param ---
if st.query_params.get("admin_open") == "1":
    st.session_state['show_admin_login'] = True
    st.query_params.clear()

# --- ADMIN LOGIN DIALOG ---
@st.dialog("Admin Sign In")
def admin_login_dialog():
    st.caption("Enter your PIN to open the Admin portal.")
    pin = st.text_input("PIN", type="password", placeholder="Enter PIN", label_visibility="collapsed")
    c1, c2 = st.columns(2)
    with c1:
        if st.button("Unlock →", type="primary", use_container_width=True):
            correct_pin = str(st.secrets.get("admin", {}).get("pin", "1234"))
            if pin == correct_pin:
                st.session_state['admin_authenticated'] = True
                st.session_state['show_admin_login'] = False
                st.switch_page("Home.py")
            else:
                st.error("Incorrect PIN")
    with c2:
        if st.button("Cancel", use_container_width=True):
            st.session_state['show_admin_login'] = False
            st.rerun()

if st.session_state['show_admin_login']:
    admin_login_dialog()

# --- HELPERS ---
def go_home(): st.session_state['page'] = 'shop'
def go_checkout(): st.session_state['page'] = 'checkout'

def _get_pdf_print_button(pdf_bytes, label="🖨️ Print / Open in New Tab"):
    """Generates an HTML button that opens the PDF in a new browser tab for direct printing."""
    try:
        b64 = base64.b64encode(pdf_bytes).decode()
        # Primary Streamlit Red: #FF4B4B
        html = f"""
            <a href="data:application/pdf;base64,{b64}" target="_blank" style="text-decoration: none;">
                <button style="
                    width: 100%;
                    background-color: #FF4B4B;
                    color: white;
                    padding: 0.5rem 1rem;
                    border: none;
                    border-radius: 0.5rem;
                    cursor: pointer;
                    font-weight: 500;
                    font-size: 1rem;
                    margin-top: 10px;
                    margin-bottom: 10px;
                ">
                    {label}
                </button>
            </a>
        """
        st.markdown(html, unsafe_allow_html=True)
    except Exception as e:
        st.error(f"Could not generate print link: {e}")

# --- STAFF ACCESS (hidden in collapsed sidebar — customers won't find it) ---
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

# --- ADMIN FAB (anchor link — position:fixed works in main page, href survives Streamlit's HTML) ---
st.markdown("""
<style>
#admin-fab {
    position: fixed; top: 16px; right: 16px;
    width: 42px; height: 42px; border-radius: 50%;
    background: rgba(255,255,255,0.5);
    border: 1px solid rgba(218,220,224,0.6);
    display: flex; align-items: center; justify-content: center;
    font-size: 16px; z-index: 99999;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    opacity: 0.22; transition: opacity .25s, box-shadow .25s, background .25s;
    text-decoration: none; line-height: 1;
}
#admin-fab:hover {
    opacity: 0.85;
    box-shadow: 0 2px 10px rgba(0,0,0,0.18);
    background: rgba(255,255,255,0.95);
}
</style>
<a id="admin-fab" href="?admin_open=1" title="Admin Login">🔐</a>
""", unsafe_allow_html=True)

# ==========================================
# PAGE 1: THE SHOP
# ==========================================
if st.session_state['page'] == 'shop':
    cart_count = sum(item['qty'] for item in st.session_state['kiosk_cart'])

    # Top bar
    c1, c2 = st.columns([5, 1])
    with c1:
        with st.container(border=True):
            st.subheader("🧵 Notion to Sew")
            st.caption("Type any item name or number below")
    with c2:
        st.write("")
        st.write("")
        if st.button(f"🛒 Cart ({cart_count})", type="primary", use_container_width=True):
            go_checkout()
            st.rerun()

    df = st.session_state['data']['inventory'].copy()
    # Hide inactive items from kiosk search
    if 'Active' in df.columns:
        df = df[df['Active'].apply(lambda x: str(x).strip().lower() not in ['false', '0', 'no', ''])]
    df['lookup'] = df.apply(lambda r: f"{r['SKU']} — {r['Name']} (${float(r['Price']):.2f})", axis=1)

    _, search_col, _ = st.columns([1, 6, 1])
    with search_col:
        search_selection = st.selectbox(
            "Search",
            df['lookup'],
            index=None,
            placeholder="🔍  Start typing a name or item number...",
            label_visibility="collapsed",
            key="kiosk_item_search"
        )

    if search_selection:
        sku = search_selection.split(" — ")[0]
        mask = df['SKU'].astype(str).str.strip() == sku.strip()
        row = df[mask].iloc[0]

        if 'main_qty' not in st.session_state:
            st.session_state['main_qty'] = 1

        st.write("")
        with st.container(border=True):
            cols = st.columns([3, 2, 2])

            with cols[0]:
                st.subheader(row['Name'])
                st.caption(f"Item #: {row['SKU']}")
                st.markdown(f"## ${row['Price']:.2f}")

            with cols[1]:
                q1, q2, q3 = st.columns([1, 2, 1], vertical_alignment="center")
                if q1.button("−", key="main_sub", use_container_width=True):
                    if st.session_state['main_qty'] > 1:
                        st.session_state['main_qty'] -= 1
                        st.rerun()
                q2.markdown(f"<div style='text-align:center;font-size:2rem;font-weight:500'>{st.session_state['main_qty']}</div>", unsafe_allow_html=True)
                if q3.button("＋", key="main_add", use_container_width=True):
                    st.session_state['main_qty'] += 1
                    st.rerun()

            with cols[2]:
                st.write("")
                
                def add_to_cart_kiosk(k_sku, k_name, k_price, k_qty):
                    # Check if SKU already in cart
                    for item in st.session_state['kiosk_cart']:
                        if item['sku'] == k_sku:
                            item['qty'] += k_qty
                            st.session_state['main_qty'] = 1
                            st.session_state['kiosk_item_search'] = None
                            return
                    
                    st.session_state['kiosk_cart'].append({
                        "sku": k_sku, "name": k_name,
                        "price": k_price, "qty": k_qty
                    })
                    st.session_state['main_qty'] = 1
                    st.session_state['kiosk_item_search'] = None

                st.button("Add to Cart", type="primary", use_container_width=True,
                          on_click=add_to_cart_kiosk, args=(row['SKU'], row['Name'], row['Price'], st.session_state['main_qty']))
                st.toast(f"Added {st.session_state['main_qty']} × {row['Name']}")
    else:
        # Friendly idle prompt when nothing is selected
        st.write("")
        st.info("Not sure what to search? Ask our staff for help — we're happy to assist! 😊")

# ==========================================
# PAGE 2: CHECKOUT
# ==========================================
elif st.session_state['page'] == 'checkout':
    st.title("Checkout")
    if st.button("⬅️ Back to Shop", use_container_width=True):
        go_home()
        st.rerun()
    
    st.divider()

    # --- STEP 1: WHO IS CHECKING OUT? ---
    st.subheader("👤 Step 1: Who is checking out?")
    cust_tab1, cust_tab2 = st.tabs(["Search Name", "New Customer"])
    selected_cust_name = None
    cust_row = None

    with cust_tab1:
        cust_df = st.session_state['data']['customers']
        selected_cust_name = st.selectbox("Name", cust_df['Name'], index=None, placeholder="Search customer name...", label_visibility="collapsed")
        if selected_cust_name:
            cust_row = cust_df[cust_df['Name'] == selected_cust_name].iloc[0]

    with cust_tab2:
        with st.form("new_kiosk_cust"):
            n_name = st.text_input("Name")
            n_email = st.text_input("Email")
            if st.form_submit_button("Join & Select"):
                if n_name:
                    db.add_customer(n_name, n_email)
                    db.force_refresh()
                    st.session_state['data'] = db.get_data()
                    st.rerun()
                else: st.error("Name required.")

    st.divider()

    # --- STEP 2: YOUR ITEMS ---
    st.subheader("🛒 Step 2: Your Items")
    if not st.session_state['kiosk_cart']:
        st.info("Cart is empty.")
    else:
        # Tax and Price Overrides pre-calculation
        if 'settings' in st.session_state['data']:
            s_df = st.session_state['data']['settings']
            settings_cache = dict(zip(s_df['Key'], s_df['Value']))
            raw_rate = settings_cache.get("TaxRate", "0.08")
            venmo_user = settings_cache.get("VenmoUser", "")
        else: raw_rate = "0.08"; venmo_user = ""

        try:
            clean_rate = float(str(raw_rate).replace("%", "").strip())
            if clean_rate > 1: clean_rate = clean_rate / 100
        except: clean_rate = 0.0

        cust_credit = 0.0
        cust_is_wholesale = False
        cust_tax_override = None
        cust_id = "Guest"

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
            except (ValueError, TypeError): pass

        if cust_tax_override is not None:
            clean_rate = cust_tax_override

        # Render Items
        inv_df = st.session_state['data']['inventory']
        checkout_cart = []
        for i, item in enumerate(st.session_state['kiosk_cart']):
            with st.container(border=True):
                c_desc, c_qty_edit, c_line_total, c_del = st.columns([3, 2, 1.5, 0.5])
                
                # Determine effective price
                eff_price = item['price']
                if cust_is_wholesale:
                    inv_rows = inv_df[inv_df['SKU'].astype(str) == str(item['sku'])]
                    if not inv_rows.empty:
                        ws_p = float(inv_rows.iloc[0].get('WholesalePrice', 0) or 0)
                        if ws_p > 0: eff_price = ws_p
                
                c_desc.write(f"**{item['name']}**")
                c_desc.caption(f"Item #: {item['sku']} | Price: ${eff_price:.2f}")

                # Edit Qty
                def update_qty(idx, new_val):
                    if new_val > 0:
                        st.session_state['kiosk_cart'][idx]['qty'] = new_val
                    else:
                        st.session_state['kiosk_cart'].pop(idx)

                new_q = c_qty_edit.number_input("Qty", 1, 1000, value=int(item['qty']), key=f"edit_q_{i}")
                if new_q != item['qty']:
                    update_qty(i, new_q)
                    st.rerun()

                line_tot = new_q * eff_price
                c_line_total.write(f"**${line_tot:.2f}**")
                
                if c_del.button("🗑️", key=f"del_{i}"):
                    st.session_state['kiosk_cart'].pop(i)
                    st.rerun()
                
                checkout_cart.append({**item, 'price': eff_price, 'qty': new_q})

        st.divider()

        # --- STEP 3: TOTAL & PAYMENT ---
        st.subheader("💰 Step 3: Total & Payment")
        
        subtotal = sum(i['qty'] * i['price'] for i in checkout_cart)
        tax_amt = 0.0 if cust_is_wholesale else subtotal * clean_rate
        total = subtotal + tax_amt

        col_tot1, col_tot2 = st.columns([1, 1])
        with col_tot1:
            if cust_is_wholesale:
                st.info("🏭 Wholesale customer — wholesale pricing applied, no tax")
            st.write(f"Subtotal: ${subtotal:.2f}")
            st.write(f"Tax: ${tax_amt:.2f}")

            credit_applied = 0.0
            if cust_row is not None and cust_credit > 0:
                st.info(f"💎 You have **${cust_credit:.2f}** in store credit!")
                if st.checkbox("Apply Credit?"):
                    max_apply = min(cust_credit, total)
                    credit_applied = max_apply 
                    st.write(f"Credit Applied: -${credit_applied:.2f}")

            final_total = max(0.0, total - credit_applied)
            st.markdown(f"## Total Due: ${final_total:.2f}")

        with col_tot2:
            # Email Receipt
            default_email = str(cust_row.get('Email', '') or '') if cust_row is not None else ""
            receipt_email = st.text_input("📧 Email Receipt To (optional)", value=default_email, placeholder="customer@example.com")

            # Payment
            pay_method = st.radio("Payment Method", ["Cash", "Venmo", "Pay Later (Invoice)"], horizontal=True)
            
            # --- GUEST CASH CHECKOUT PROTECTION ---
            if not selected_cust_name and pay_method == "Cash":
                st.error("⚠️ Guest checkout is only allowed for Venmo or Pay Later. Please select or create a customer for Cash sales.")
                can_finish = False
            else:
                can_finish = True

            if pay_method == "Venmo":
                if venmo_user:
                    st.image(f"https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://venmo.com/u/{venmo_user}", width=150)
                else: st.warning("Venmo account not set!")

            if st.button("✅ Finish Sale", type="primary", use_container_width=True, disabled=not can_finish):
                try:
                    cust_display = selected_cust_name or "Guest"
                    status = "Pending" if pay_method == "Pay Later (Invoice)" else "Paid"

                    with st.spinner("Processing..."):
                        new_id = db.commit_sale(
                            checkout_cart, final_total, tax_amt, cust_id,
                            pay_method, cust_is_wholesale, status, credit_used=credit_applied
                        )

                        address = db.get_settings_dict().get("Address", "Modesto, CA")
                        pdf_bytes = db.create_pdf(new_id, cust_display, address, checkout_cart, subtotal, tax_amt, final_total, "Upon Receipt", credit_applied=credit_applied, transaction_date=None)

                        email_sent = False
                        email_error = None
                        if receipt_email.strip():
                            try:
                                db.send_receipt_email(receipt_email.strip(), new_id, pdf_bytes)
                                email_sent = True
                            except Exception as e: email_error = str(e)

                        st.session_state['last_kiosk_order'] = {
                            'id': new_id, 'pdf': pdf_bytes, 'customer': cust_display,
                            'receipt_email': receipt_email.strip(), 'email_sent': email_sent,
                            'email_error': email_error, 'total': final_total,
                        }
                        st.session_state['kiosk_cart'] = []
                        st.session_state['page'] = 'success'
                        db.force_refresh()
                        st.rerun()
                except Exception as e: st.error(f"Error: {e}")

    # --- FOOTER SPACER (For Mobile Keyboard Clearance) ---
    st.write("<br><br><br><br><br><br><br><br><br><br>", unsafe_allow_html=True)
    st.caption("Notion to Sew · Kiosk v1.2")

# ==========================================
# PAGE 3: SUCCESS
# ==========================================
elif st.session_state['page'] == 'success':
    # --- AUTO-TIMEOUT: Return to home after 2 minutes of inactivity ---
    components.html(
        """
        <script>
        setTimeout(function() {
            window.parent.location.assign(window.parent.location.origin + window.parent.location.pathname);
        }, 120000);
        </script>
        """,
        height=0
    )
    
    order = st.session_state.get('last_kiosk_order', {})
    c1, c2, c3 = st.columns([1, 2, 1])
    with c2:
        with st.container(border=True):
            st.markdown("# ✅ Thank You!")
            st.subheader(f"Order #{order.get('id', '')} · ${order.get('total', 0):.2f}")
        st.write("")
        with st.container(border=True):

            # Email status
            receipt_email = order.get('receipt_email', '')
            if receipt_email:
                if order.get('email_sent'):
                    st.success(f"📧 Receipt emailed to **{receipt_email}**")
                else:
                    st.warning(f"⚠️ Could not send email to **{receipt_email}**")
                    if order.get('email_error'):
                        st.caption(f"Error detail: {order['email_error']}")
                    st.caption("Please ask staff for a printed copy.")
            else:
                st.info("No email provided — ask staff for a printed receipt if needed.")

            st.write("")

            # Staff can still download or print the PDF
            if order.get('pdf'):
                _get_pdf_print_button(order['pdf'])
                st.download_button(
                    "💾 Save Receipt",
                    data=order['pdf'],
                    file_name=f"Receipt_{order.get('id', 'order')}.pdf",
                    mime="application/pdf",
                    use_container_width=True
                )

            st.write("")
            if st.button("🏠 Start New Order", type="primary", use_container_width=True):
                st.session_state['last_kiosk_order'] = None
                go_home()
                st.rerun()

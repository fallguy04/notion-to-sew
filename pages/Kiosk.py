import streamlit as st
import backend as db
import pandas as pd
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

# --- CUSTOM CSS (ChromeOS / Google 2026 Design) ---
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');
@import url('https://fonts.googleapis.com/icon?family=Material+Icons');

/* ── GLOBAL ──
   DO NOT include `span` or `[class*="css"]` here.
   `span` breaks the sidebar toggle icon (Material Icons ligature lives in a <span>).
   `[class*="css"]` hits Streamlit's emotion class names and destroys popup menus.  ── */
html, body, p, label, input, textarea, select {
    font-family: 'Roboto', sans-serif !important;
    -webkit-font-smoothing: antialiased;
}
/* Force Roboto only on our own component wrappers, not Streamlit internals */
.stApp, .stMarkdown, .stText, .element-container {
    font-family: 'Roboto', sans-serif !important;
}
.stApp { background: #f8f9fa !important; }
#MainMenu, footer, header { visibility: hidden; }

/* ── STAFF SIDEBAR ── */
section[data-testid="stSidebar"] {
    background: #ffffff !important;
    border-right: 1px solid #dadce0 !important;
}
section[data-testid="stSidebar"] h3 {
    font-family: 'Roboto', sans-serif !important;
    color: #202124 !important;
    font-size: 1rem !important;
    font-weight: 500 !important;
}
/* Target only p and label — NOT span, which is used for button text */
section[data-testid="stSidebar"] p,
section[data-testid="stSidebar"] label {
    color: #5f6368 !important;
    font-size: 0.875rem !important;
}
section[data-testid="stSidebar"] .stButton > button {
    font-family: 'Roboto', sans-serif !important;
    background: #1a73e8 !important;
    color: #ffffff !important;
    border: none !important;
    border-radius: 8px !important;
    font-size: 0.875rem !important;
    font-weight: 500 !important;
    min-height: 36px !important;
    padding: 6px 16px !important;
    margin-top: 6px !important;
    box-shadow: 0 1px 2px rgba(0,0,0,0.2) !important;
    letter-spacing: 0.01em !important;
    width: 100% !important;
}
section[data-testid="stSidebar"] .stButton > button:hover {
    background: #1557b0 !important;
    box-shadow: 0 2px 5px rgba(0,0,0,0.25) !important;
}
/* Ensure button text (in <span> inside button) inherits the button's white color */
section[data-testid="stSidebar"] .stButton > button * {
    color: inherit !important;
}

/* ── KIOSK HEADER BAND ── */
.kiosk-header {
    background: #ffffff;
    border-radius: 12px;
    padding: 20px 28px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 1px solid #dadce0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.kiosk-header-title {
    color: #202124;
    font-family: 'Roboto', sans-serif;
    font-size: 1.4rem;
    font-weight: 500;
    margin: 0;
}
.kiosk-header-sub {
    color: #5f6368;
    font-family: 'Roboto', sans-serif;
    font-size: 0.85rem;
    font-weight: 400;
    margin: 3px 0 0;
}

/* ── SEARCH HERO ── */
.search-hero {
    text-align: center;
    padding: 32px 16px 20px;
}
.search-hero-title {
    font-family: 'Roboto', sans-serif;
    font-size: 2rem;
    font-weight: 400;
    color: #202124;
    margin: 0 0 6px;
    letter-spacing: -0.01em;
}
.search-hero-sub {
    font-family: 'Roboto', sans-serif;
    font-size: 1.1rem;
    font-weight: 400;
    color: #5f6368;
    margin: 0 0 24px;
}

/* ── ALL USER BUTTONS: iPad-sized tap targets ── */
.stButton > button {
    font-family: 'Roboto', sans-serif !important;
    min-height: 52px !important;
    font-size: 0.9375rem !important;
    font-weight: 500 !important;
    border-radius: 24px !important;
    letter-spacing: 0.01em !important;
    padding: 10px 24px !important;
    height: auto !important;
    transition: box-shadow 0.2s ease, background 0.2s ease !important;
}
/* Prevent global p/label color rules from overriding button text */
.stButton > button *, .stDownloadButton > button * {
    color: inherit !important;
}

/* Primary — Google Blue filled */
.stButton > button[kind="primary"] {
    background: #1a73e8 !important;
    border: none !important;
    color: #ffffff !important;
    box-shadow: 0 1px 3px rgba(0,0,0,0.2) !important;
}
.stButton > button[kind="primary"]:hover {
    background: #1557b0 !important;
    box-shadow: 0 2px 8px rgba(26,115,232,0.4) !important;
}
.stButton > button[kind="primary"]:active {
    background: #1246a0 !important;
    box-shadow: none !important;
}

/* Secondary — outlined */
.stButton > button:not([kind="primary"]) {
    background: #ffffff !important;
    border: 1px solid #dadce0 !important;
    color: #1a73e8 !important;
    box-shadow: none !important;
}
.stButton > button:not([kind="primary"]):hover {
    background: #e8f0fe !important;
    border-color: #1a73e8 !important;
}

/* ── SEARCH SELECTBOX — pill-shaped, Google style ── */
div[data-testid="stSelectbox"] > div > div {
    min-height: 56px !important;
    border-radius: 28px !important;
    border: 1px solid #dadce0 !important;
    font-size: 1.125rem !important;
    font-weight: 400 !important;
    background: #ffffff !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1) !important;
    padding-left: 24px !important;
    padding-right: 16px !important;
    display: flex !important;
    align-items: center !important;
    outline: none !important;
    transition: box-shadow 0.15s, border-color 0.15s !important;
}
/* Inner value container — vertically centered */
div[data-testid="stSelectbox"] > div > div > div[class] {
    display: flex !important;
    align-items: center !important;
    line-height: 1.2 !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
}
div[data-testid="stSelectbox"] > div > div:focus-within {
    border-color: #1a73e8 !important;
    box-shadow: 0 0 0 2px rgba(26,115,232,0.2), 0 2px 8px rgba(0,0,0,0.08) !important;
    outline: none !important;
}
div[data-testid="stSelectbox"] label {
    font-family: 'Roboto', sans-serif !important;
    font-size: 0.875rem !important;
    font-weight: 500 !important;
    color: #5f6368 !important;
}

/* ── TEXT INPUTS ── */
div[data-baseweb="input"] > div {
    border-radius: 8px !important;
    border: 1px solid #dadce0 !important;
    font-size: 1rem !important;
    background: #ffffff !important;
    min-height: 52px !important;
    box-shadow: none !important;
    outline: none !important;
}
div[data-baseweb="input"] input {
    outline: none !important;
}
div[data-baseweb="input"]:focus-within > div {
    border-color: #1a73e8 !important;
    box-shadow: 0 0 0 2px rgba(26,115,232,0.15) !important;
}

/* ── PRODUCT RESULT CARD ── */
div[data-testid="stContainer"] {
    background: #ffffff !important;
    border: 1px solid #dadce0 !important;
    border-radius: 12px !important;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07) !important;
}

/* ── QUANTITY DISPLAY ── */
.qty-display {
    font-family: 'Roboto', sans-serif;
    font-size: 2rem;
    font-weight: 400;
    color: #202124;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 56px;
    width: 100%;
    background: #f8f9fa;
    border-radius: 8px;
    border: 1px solid #dadce0;
}

/* ── TYPOGRAPHY ── */
h1 { font-family: 'Roboto', sans-serif !important; font-size: 1.75rem !important; font-weight: 400 !important; color: #202124 !important; }
h2 { font-family: 'Roboto', sans-serif !important; font-size: 1.25rem !important; font-weight: 500 !important; color: #202124 !important; }
h3 { font-family: 'Roboto', sans-serif !important; font-size: 1rem !important; font-weight: 500 !important; color: #3c4043 !important; }

/* ── SUCCESS SCREEN ── */
.success-card {
    background: #ffffff;
    border-radius: 16px;
    border: 1px solid #dadce0;
    padding: 48px 40px;
    text-align: center;
    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}
.success-card .success-icon {
    font-size: 4rem;
    display: block;
    margin-bottom: 16px;
}
.success-card h1 {
    color: #202124 !important;
    font-size: 2rem !important;
    font-weight: 400 !important;
    margin-bottom: 8px !important;
}
.success-card .order-info {
    font-size: 1.1rem;
    color: #1a73e8;
    font-weight: 500;
}

/* ── ALERTS ── */
div[data-testid="stAlert"] { border-radius: 8px !important; font-size: 0.9rem !important; }

/* ── TABS ── */
.stTabs [data-baseweb="tab-list"] {
    background: transparent !important;
    border-bottom: 1px solid #dadce0 !important;
    gap: 0 !important;
    padding: 0 !important;
}
.stTabs [data-baseweb="tab"] {
    background: transparent !important;
    border-radius: 0 !important;
    padding: 10px 24px !important;
    font-family: 'Roboto', sans-serif !important;
    font-size: 0.875rem !important;
    font-weight: 500 !important;
    color: #5f6368 !important;
    border: none !important;
    border-bottom: 3px solid transparent !important;
    min-height: 48px !important;
}
.stTabs [data-baseweb="tab"][aria-selected="true"] {
    color: #1a73e8 !important;
    border-bottom: 3px solid #1a73e8 !important;
}
.stTabs [data-baseweb="tab-border"],
.stTabs [data-baseweb="tab-highlight"] { display: none !important; }

/* ── DIVIDER ── */
hr { border-color: #dadce0 !important; }

/* ── FORM ── */
div[data-testid="stForm"] { border: none !important; background: transparent !important; }

</style>
""", unsafe_allow_html=True)

# --- INIT ---
if 'data' not in st.session_state:
    st.session_state['data'] = db.get_data()
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
        st.markdown("""
        <div class="kiosk-header">
            <div>
                <div class="kiosk-header-title">🧵 Notion to Sew</div>
                <div class="kiosk-header-sub">Type any item name or number below</div>
            </div>
        </div>""", unsafe_allow_html=True)
    with c2:
        st.write("")
        st.write("")
        if st.button(f"🛒 Cart ({cart_count})", type="primary", use_container_width=True):
            go_checkout()
            st.rerun()

    df = st.session_state['data']['inventory'].copy()
    df['lookup'] = df['SKU'].astype(str) + " — " + df['Name']

    _, search_col, _ = st.columns([1, 6, 1])
    with search_col:
        search_selection = st.selectbox(
            "Search",
            df['lookup'],
            index=None,
            placeholder="🔍  Start typing a name or item number...",
            label_visibility="collapsed"
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
                q1, q2, q3 = st.columns([1, 2, 1])
                if q1.button("−", key="main_sub"):
                    if st.session_state['main_qty'] > 1:
                        st.session_state['main_qty'] -= 1
                        st.rerun()
                q2.markdown(f"<div class='qty-display'>{st.session_state['main_qty']}</div>", unsafe_allow_html=True)
                if q3.button("＋", key="main_add"):
                    st.session_state['main_qty'] += 1
                    st.rerun()

            with cols[2]:
                st.write("")
                if st.button("Add to Cart", type="primary", use_container_width=True):
                    st.session_state['kiosk_cart'].append({
                        "sku": row['SKU'], "name": row['Name'],
                        "price": row['Price'], "qty": st.session_state['main_qty']
                    })
                    st.toast(f"Added {st.session_state['main_qty']} × {row['Name']}")
                    st.session_state['main_qty'] = 1
                    st.rerun()
    else:
        # Friendly idle prompt when nothing is selected
        st.write("")
        st.markdown(
            "<p style='text-align:center; color:#9aa0a6; font-size:1rem; padding:24px 0;'>"
            "Not sure what to search? Ask our staff for help — we're happy to assist! 😊"
            "</p>",
            unsafe_allow_html=True
        )

# ==========================================
# PAGE 2: CHECKOUT
# ==========================================
elif st.session_state['page'] == 'checkout':
    st.title("Checkout")
    if st.button("⬅️ Back to Shop", use_container_width=True):
        go_home()
        st.rerun()
    
    st.divider()
    c_left, c_right = st.columns([1.5, 1])
    
    # LEFT: Cart
    with c_left:
        st.subheader("Your Items")
        if not st.session_state['kiosk_cart']:
            st.info("Cart is empty.")
        else:
            for i, item in enumerate(st.session_state['kiosk_cart']):
                with st.container(border=True):
                    cl1, cl2, cl3 = st.columns([3, 1, 1])
                    cl1.write(f"**{item['name']}**\n{item['qty']} @ ${item['price']:.2f}")
                    cl2.write(f"**${item['qty'] * item['price']:.2f}**")
                    if cl3.button("🗑️", key=f"del_{i}"):
                        st.session_state['kiosk_cart'].pop(i)
                        st.rerun()

    # RIGHT: Pay
    with c_right:
        with st.container(border=True):
            st.subheader("Total")
            subtotal = sum(item['qty'] * item['price'] for item in st.session_state['kiosk_cart'])
            
            # Tax Logic
            if 'settings' in st.session_state['data']:
                s_df = st.session_state['data']['settings']
                settings_cache = dict(zip(s_df['Key'], s_df['Value']))
                raw_rate = settings_cache.get("TaxRate", "0.08")
                venmo_user = settings_cache.get("VenmoUser", "")
            else:
                raw_rate = "0.08"
                venmo_user = ""

            try:
                clean_rate = float(str(raw_rate).replace("%", "").strip())
                # If rate is > 1 (e.g. 8.0), divide by 100. If < 1 (e.g. 0.08), keep it.
                if clean_rate > 1: clean_rate = clean_rate / 100
            except: clean_rate = 0.0

            tax_amt = subtotal * clean_rate
            total = subtotal + tax_amt
            
            st.write(f"Subtotal: ${subtotal:.2f}")
            st.write(f"Tax: ${tax_amt:.2f}")
            
            # Customer & Credit Logic (NEW for Kiosk)
            cust_tab1, cust_tab2 = st.tabs(["Search Name", "New Customer"])
            selected_cust = None
            cust_credit = 0.0
            
            with cust_tab1:
                cust_df = st.session_state['data']['customers']
                cust_list = cust_df['Name']
                selected_cust = st.selectbox("Name", cust_list, index=None, placeholder="Select...", label_visibility="collapsed")
                
                if selected_cust:
                    cust_row = cust_df[cust_df['Name'] == selected_cust].iloc[0]
                    try: cust_credit = float(cust_row.get('Credit', 0) if cust_row.get('Credit') != "" else 0)
                    except: cust_credit = 0.0
                    
            with cust_tab2:
                with st.form("new_kiosk_cust"):
                    n_name = st.text_input("Name")
                    n_email = st.text_input("Email")
                    if st.form_submit_button("Join"):
                        db.add_customer(n_name, n_email)
                        # Clear cache and reload
                        del st.session_state['data']
                        st.rerun()

            credit_applied = 0.0
            if selected_cust and cust_credit > 0:
                st.info(f"💎 You have **${cust_credit:.2f}** in store credit!")
                if st.checkbox("Apply Credit?"):
                    max_apply = min(cust_credit, total)
                    credit_applied = max_apply # Kiosk usually auto-applies max for simplicity, or we can add input
                    st.write(f"Credit Applied: -${credit_applied:.2f}")

            final_total = max(0.0, total - credit_applied)
            st.markdown(f"# ${final_total:.2f}")

            st.divider()

            # Email Receipt
            default_email = ""
            if selected_cust:
                try:
                    default_email = str(cust_row.get('Email', '') or '')
                except: pass
            receipt_email = st.text_input(
                "📧 Email Receipt To (optional)",
                value=default_email,
                placeholder="customer@example.com"
            )

            # Payment
            pay_method = st.radio("Payment Method", ["Cash", "Venmo", "Pay Later (Invoice)"], horizontal=True)
            
            if pay_method == "Venmo":
                if venmo_user:
                    st.success(f"Scanning for @{venmo_user}")
                    qr_url = f"https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://venmo.com/u/{venmo_user}"
                    st.image(qr_url, caption=f"Scan to pay ${final_total:.2f}", width=200)
                else:
                    st.warning("No Venmo account set in Admin Settings!")

            if st.button("✅ Finish Sale", type="primary", use_container_width=True):
                if selected_cust or pay_method == "Cash":
                    try:
                        cust_id = cust_row['CustomerID'] if selected_cust else "Guest"
                        cust_display = selected_cust or "Guest"
                        status = "Pending" if pay_method == "Pay Later (Invoice)" else "Paid"

                        with st.spinner("Processing..."):
                            new_id = db.commit_sale(
                                st.session_state['kiosk_cart'], final_total, tax_amt, cust_id,
                                pay_method, False, status, credit_used=credit_applied
                            )

                            # PDF Generation
                            if 'settings' in st.session_state['data']:
                                s_df = st.session_state['data']['settings']
                                s_dict = dict(zip(s_df['Key'], s_df['Value']))
                                address = s_dict.get("Address", "Modesto, CA")
                            else: address = "Modesto, CA"

                            pdf_bytes = db.create_pdf(new_id, cust_display, address, st.session_state['kiosk_cart'], subtotal, tax_amt, final_total, "Upon Receipt", credit_applied=credit_applied)

                            # Send Email Receipt
                            email_sent = False
                            email_error = None
                            if receipt_email.strip():
                                try:
                                    db.send_receipt_email(receipt_email.strip(), new_id, pdf_bytes)
                                    email_sent = True
                                except Exception as e:
                                    email_error = str(e)

                            # Store Success Data
                            st.session_state['last_kiosk_order'] = {
                                'id': new_id,
                                'pdf': pdf_bytes,
                                'customer': selected_cust,
                                'receipt_email': receipt_email.strip(),
                                'email_sent': email_sent,
                                'email_error': email_error,
                                'total': final_total,
                            }
                            st.session_state['kiosk_cart'] = []
                            st.session_state['page'] = 'success'
                            db.force_refresh()
                            st.rerun()
                    except Exception as e:
                        st.error(f"Error: {e}")
                else:
                    st.warning("Please select a customer, or choose Cash for a guest sale.")

# ==========================================
# PAGE 3: SUCCESS
# ==========================================
elif st.session_state['page'] == 'success':
    order = st.session_state.get('last_kiosk_order', {})
    c1, c2, c3 = st.columns([1, 2, 1])
    with c2:
        st.markdown(f"""
        <div class="success-card">
            <span class="success-icon">✅</span>
            <h1>Thank You!</h1>
            <div class="order-info">Order #{order.get('id', '')} &nbsp;·&nbsp; ${order.get('total', 0):.2f}</div>
        </div>
        """, unsafe_allow_html=True)
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

            # Staff can still download the PDF
            if order.get('pdf'):
                st.download_button(
                    "🖨️ Download Receipt",
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

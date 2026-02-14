import streamlit as st
import backend as db
import pandas as pd
from streamlit_pdf_viewer import pdf_viewer
import time

# --- CONFIG (iPad Optimized - Refined) ---
st.set_page_config(page_title="Kiosk", layout="wide", initial_sidebar_state="collapsed")

# --- CUSTOM CSS (THE "GOLDILOCKS" UPDATE) ---
st.markdown("""
<style>
    /* Hide Streamlit Chrome */
    #MainMenu {visibility: hidden;}
    footer {visibility: hidden;}
    header {visibility: hidden;}
    
    /* Buttons: Big enough to tap, not comically large */
    .stButton button {
        height: 55px !important; /* Reduced from 80px */
        font-size: 22px !important;
        font-weight: 700 !important;
        border-radius: 10px !important;
        border: 2px solid #e0e0e0;
    }
    
    /* Primary Action Buttons (Add, Search) */
    div[data-testid="column"] .stButton button[kind="primary"] {
        background-color: #ff4b4b;
        color: white;
        border: none;
    }
    
    /* Search Input: Clean & Sized */
    div[data-testid="stSelectbox"] > div > div {
        height: 55px !important;
    }
    div[data-testid="stSelectbox"] label {
        font-size: 20px !important;
    }
    
    /* Product Cards */
    div[data-testid="stContainer"] {
        background-color: #ffffff;
        padding: 15px;
        border-radius: 12px;
        border: 1px solid #e0e0e0;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    /* Quantity Display - CENTERED PERFECTLY */
    .qty-display {
        font-size: 32px;
        font-weight: bold;
        color: #31333F;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 55px; /* Match button height */
        width: 100%;
        background-color: #f0f2f6;
        border-radius: 8px;
    }
    
    /* Align columns vertically */
    div[data-testid="column"] {
        display: flex;
        flex-direction: column;
        justify-content: center;
    }
</style>
""", unsafe_allow_html=True)

# --- INIT ---
if 'data' not in st.session_state:
    st.session_state['data'] = db.get_data()
if 'kiosk_cart' not in st.session_state: st.session_state['kiosk_cart'] = []
if 'page' not in st.session_state: st.session_state['page'] = 'shop'

# --- HELPERS ---
def go_home(): st.session_state['page'] = 'shop'
def go_checkout(): st.session_state['page'] = 'checkout'

# ==========================================
# PAGE 1: THE SHOP
# ==========================================
if st.session_state['page'] == 'shop':
    # Top Bar
    c1, c2 = st.columns([4, 1])
    c1.title("🧵 Notion to Sew")
    
    cart_count = sum(item['qty'] for item in st.session_state['kiosk_cart'])
    if c2.button(f"🛒 Cart ({cart_count})", type="primary", use_container_width=True):
        go_checkout()
        st.rerun()

    # --- 1. SEARCH ---
    st.markdown("### 🔍 Search")
    
    df = st.session_state['data']['inventory'].copy()
    df['lookup'] = df['SKU'].astype(str) + " | " + df['Name']
    
    search_selection = st.selectbox(
        "Start typing SKU or Name...", 
        df['lookup'], 
        index=None, 
        placeholder="Tap here to search...",
        label_visibility="collapsed"
    )
    
    if search_selection:
        sku = search_selection.split(" | ")[0]
        mask = df['SKU'].astype(str).str.strip() == sku.strip()
        row = df[mask].iloc[0]
        
        if 'main_qty' not in st.session_state: st.session_state['main_qty'] = 1
        
        st.divider()
        with st.container(border=True):
            cols = st.columns([3, 2, 2])
            
            # Info
            with cols[0]:
                st.subheader(row['Name'])
                st.caption(f"SKU: {row['SKU']}")
                st.markdown(f"## ${row['Price']:.2f}")
            
            # Quantity Selector
            with cols[1]:
                q1, q2, q3 = st.columns([1, 2, 1])
                if q1.button("−", key="main_sub"):
                    if st.session_state['main_qty'] > 1:
                        st.session_state['main_qty'] -= 1
                        st.rerun()
                
                # The Centered Number
                q2.markdown(f"<div class='qty-display'>{st.session_state['main_qty']}</div>", unsafe_allow_html=True)
                
                if q3.button("＋", key="main_add"):
                    st.session_state['main_qty'] += 1
                    st.rerun()
            
            # Add Button
            with cols[2]:
                st.write("") 
                if st.button("ADD TO CART", type="primary", use_container_width=True):
                    st.session_state['kiosk_cart'].append({
                        "sku": row['SKU'], "name": row['Name'], 
                        "price": row['Price'], "qty": st.session_state['main_qty']
                    })
                    st.toast(f"Added {st.session_state['main_qty']} x {row['Name']}")
                    st.session_state['main_qty'] = 1 
                    time.sleep(0.5)
                    st.rerun()

    st.divider()
    
    # --- 2. POPULAR ITEMS (FIXED LOGIC) ---
    st.subheader("🔥 Popular Items")
    
    # 1. Prepare Inventory Data (Ensure SKU is string)
    df['SKU'] = df['SKU'].astype(str).str.strip()
    
    # 2. Prepare Sales Data
    if 'items' in st.session_state['data'] and not st.session_state['data']['items'].empty:
        history = st.session_state['data']['items'].copy()
        history['QtySold'] = pd.to_numeric(history['QtySold'], errors='coerce').fillna(0)
        
        # Group sales by SKU
        popularity = history.groupby('SKU')['QtySold'].sum().reset_index()
        popularity['SKU'] = popularity['SKU'].astype(str).str.strip()
        
        # 3. MERGE (THE FIX: suffixes ensures we don't lose the main SKU)
        # We perform a left join: Keep all inventory items, attach sales data where available
        df_sorted = df.merge(popularity, on='SKU', how='left', suffixes=('', '_pop'))
        
        # Fill missing sales with 0 and sort
        df_sorted['QtySold'] = df_sorted['QtySold'].fillna(0)
        display_df = df_sorted.sort_values(by='QtySold', ascending=False).head(12)
    else:
        display_df = df.head(12)
    
    # Grid
    cols = st.columns(3)
    for i, row in display_df.iterrows():
        with cols[i % 3]:
            with st.container(border=True):
                st.markdown(f"**{row['Name']}**")
                st.caption(f"${row['Price']:.2f}")
                
                # Grid Quantity Selector
                c_sub, c_val, c_add = st.columns([1, 2, 1])
                
                k_qty = f"qty_{i}"
                if k_qty not in st.session_state: st.session_state[k_qty] = 1
                
                if c_sub.button("−", key=f"sub_{i}"):
                    if st.session_state[k_qty] > 1: st.session_state[k_qty] -= 1
                    st.rerun()
                    
                c_val.markdown(f"<div class='qty-display' style='height: 55px; font-size: 24px;'>{st.session_state[k_qty]}</div>", unsafe_allow_html=True)
                
                if c_add.button("＋", key=f"pls_{i}"):
                    st.session_state[k_qty] += 1
                    st.rerun()
                
                # Add Button
                total_price = row['Price'] * st.session_state[k_qty]
                if st.button(f"Add ${total_price:.2f}", key=f"add_{i}", use_container_width=True):
                    st.session_state['kiosk_cart'].append({
                        "sku": row['SKU'], "name": row['Name'], 
                        "price": row['Price'], "qty": st.session_state[k_qty]
                    })
                    st.session_state[k_qty] = 1 
                    st.toast("Added!")

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
                if selected_cust:
                    try:
                        cust_id = cust_row['CustomerID']
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
                            
                            pdf_bytes = db.create_pdf(new_id, selected_cust, address, st.session_state['kiosk_cart'], subtotal, tax_amt, final_total, "Upon Receipt", credit_applied=credit_applied)
                            
                            # Store Success Data
                            st.session_state['last_kiosk_order'] = {
                                'id': new_id,
                                'pdf': pdf_bytes,
                                'customer': selected_cust
                            }
                            st.session_state['kiosk_cart'] = []
                            st.session_state['page'] = 'success' # GO TO SUCCESS PAGE
                            st.rerun()
                    except Exception as e:
                        st.error(f"Error: {e}")
                else:
                    st.error("Who is this for? (Select Name)")

# ==========================================
# PAGE 3: SUCCESS (New!)
# ==========================================
elif st.session_state['page'] == 'success':
    # Simple, clear success screen
    c1, c2, c3 = st.columns([1, 2, 1])
    with c2:
        with st.container(border=True):
            st.markdown("<h1 style='text-align: center; color: green;'>Thank You!</h1>", unsafe_allow_html=True)
            st.markdown(f"<h3 style='text-align: center;'>Order #{st.session_state['last_kiosk_order']['id']} Confirmed</h3>", unsafe_allow_html=True)
            st.write("")
            
            import base64
            
            # View Invoice Button
            if st.button("👁️ View Receipt", use_container_width=True):
                st.session_state['view_kiosk_receipt'] = True
            
            if st.session_state.get('view_kiosk_receipt'):
                # Use raw bytes
                pdf_data = st.session_state['last_kiosk_order']['pdf']
                
                pdf_viewer(input=pdf_data, width=1000, height=1000)
                
                if st.button("Close Receipt"):
                    st.session_state['view_kiosk_receipt'] = False
                    st.rerun()
            
            # Return Home
            if st.button("🏠 Start New Order", type="primary", use_container_width=True):
                # Clean up
                st.session_state['view_kiosk_receipt'] = False
                st.session_state['last_kiosk_order'] = None
                go_home()
                st.rerun()

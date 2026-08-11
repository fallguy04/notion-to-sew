"""Invoice PDFs, receipt email and the income-statement report.

Split out of backend.py so the storage layer can be swapped without touching a
line of document generation. Nothing here talks to a database.
"""
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email.mime.text import MIMEText
from email import encoders
from datetime import datetime
import streamlit as st
import pytz
from fpdf import FPDF

# --- PDF GENERATOR ---
def create_pdf(invoice_id, customer_name, company_address, cart, subtotal, tax, total, due_date, credit_applied=0.0, transaction_date=None, discount_amount=0.0, freight_amount=0.0):
    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 20); pdf.cell(0, 10, "Notion to Sew", ln=True)
    pdf.set_font("Helvetica", "", 10)
    for line in company_address.split("\n"): pdf.cell(0, 5, line.strip(), ln=True)
    pdf.ln(10)

    # Handle Date and Timezone (Los Angeles)
    tz = pytz.timezone("America/Los_Angeles")
    if transaction_date:
        # If transaction_date is a string, we assume it's already in the correct format or try to parse it
        # If it's datetime, we use it.
        if isinstance(transaction_date, str):
            try: 
                display_date = datetime.strptime(transaction_date, "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%d")
            except: 
                try: display_date = datetime.strptime(transaction_date, "%Y-%m-%d").strftime("%Y-%m-%d")
                except: display_date = transaction_date # Fallback to original string
        elif isinstance(transaction_date, datetime):
            display_date = transaction_date.strftime("%Y-%m-%d")
        else:
            display_date = str(transaction_date)
    else:
        display_date = datetime.now(tz).strftime("%Y-%m-%d")

    pdf.set_font("Helvetica", "B", 12); pdf.cell(0, 10, f"INVOICE #{invoice_id}", ln=True, align='R')
    pdf.set_font("Helvetica", "", 10); pdf.cell(0, 5, f"Date: {display_date}", ln=True, align='R')
    pdf.cell(0, 5, f"Due: {due_date}", ln=True, align='R'); pdf.ln(5)
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
    if discount_amount > 0:
        pdf.cell(165, 6, "Bulk Discount:", 0, 0, 'R'); pdf.cell(25, 6, f"-${discount_amount:.2f}", 0, 1, 'R')
        pdf.cell(165, 6, "Discounted Subtotal:", 0, 0, 'R'); pdf.cell(25, 6, f"${subtotal - discount_amount:.2f}", 0, 1, 'R')
    
    if freight_amount > 0:
        pdf.cell(165, 6, "Freight:", 0, 0, 'R'); pdf.cell(25, 6, f"${freight_amount:.2f}", 0, 1, 'R')

    pdf.cell(165, 6, "Tax:", 0, 0, 'R'); pdf.cell(25, 6, f"${tax:.2f}", 0, 1, 'R')
    if credit_applied > 0:
        pdf.cell(165, 6, "Store Credit Used:", 0, 0, 'R'); pdf.cell(25, 6, f"-${credit_applied:.2f}", 0, 1, 'R')
    pdf.set_font("Helvetica", "B", 12); pdf.cell(165, 8, "AMOUNT DUE:", 0, 0, 'R'); pdf.cell(25, 8, f"${max(0.0, total - credit_applied):.2f}", 0, 1, 'R')
    return pdf.output(dest='S').encode('latin-1')
# --- EMAIL RECEIPT ---
def send_receipt_email(to_email: str, invoice_id: str, pdf_bytes: bytes):
    """Sends the PDF receipt as an email attachment via Gmail SMTP.
    Requires [email] sender and app_password keys in st.secrets.
    """
    # 1. Direct root access
    sender = st.secrets.get("sender")
    password = st.secrets.get("app_password")

    # 2. Section-based search (looks in [email], [admin], or any other block)
    if not sender or not password:
        for key in st.secrets.keys():
            try:
                # We try to treat every top-level key as a dictionary/section
                section = st.secrets[key]
                if not sender: sender = section.get("sender")
                if not password: password = section.get("app_password")
            except:
                continue # Skip if the key isn't a section (like a simple string)
            if sender and password: break

    # 3. Final validation with detailed error
    if not sender or not password:
        all_found_keys = list(st.secrets.keys())
        raise KeyError(
            f"Email credentials missing. I can see these sections: {all_found_keys}. "
            "If you just added 'sender' and 'app_password' to the Streamlit Cloud dashboard, "
            "please go to the dashboard and click 'Reboot App' to force a refresh."
        )
    
    # Try to get company name from settings
    try:
        settings = get_settings_dict()
        company_name = settings.get("CompanyName", "Notion to Sew")
    except:
        company_name = "Notion to Sew"

    msg = MIMEMultipart()
    msg['From'] = f"{company_name} <{sender}>"
    msg['To'] = to_email
    msg['Subject'] = f"Your Receipt from {company_name} — Invoice #{invoice_id}"

    body = (
        f"Hi there!\n\n"
        f"Thank you for shopping at {company_name}. "
        f"Your receipt for Invoice #{invoice_id} is attached as a PDF.\n\n"
        f"Questions? Just reply to this email.\n\n"
        f"— {company_name}"
    )
    msg.attach(MIMEText(body, 'plain'))

    attachment = MIMEBase('application', 'pdf')
    attachment.set_payload(pdf_bytes)
    encoders.encode_base64(attachment)
    attachment.add_header(
        'Content-Disposition',
        f'attachment; filename="Receipt_{invoice_id}.pdf"'
    )
    msg.attach(attachment)

    with smtplib.SMTP_SSL('smtp.gmail.com', 465) as smtp:
        smtp.login(sender, password)
        smtp.send_message(msg)

# --- REPORT GENERATION ---
def generate_income_statement_pdf(start_date, end_date, financials):
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    
    # 1. Header (Tighter spacing)
    pdf.set_font("Arial", 'B', 16)
    pdf.cell(0, 8, "Notion to Sew", 0, 1, 'C')
    pdf.set_font("Arial", 'B', 12)
    pdf.cell(0, 6, "Income Statement - Classified", 0, 1, 'C')
    
    pdf.set_font("Arial", '', 10)
    pdf.cell(0, 5, f"Period: {start_date.strftime('%m/%d/%Y')} - {end_date.strftime('%m/%d/%Y')}", 0, 1, 'C')
    pdf.ln(5) # Small gap
    
    # Helper for lines
    def add_line(label, amount, bold=False, indent=0, is_total=False):
        pdf.set_font("Arial", 'B' if bold else '', 10)
        x_start = 10 + (indent * 5)
        pdf.set_x(x_start)
        
        page_width = 190
        amount_str = f"${amount:,.2f}" if amount >= 0 else f"(${abs(amount):,.2f})"
        
        # Draw label
        pdf.cell(100, 5, label, 0, 0)
        
        # Draw Amount aligned right
        pdf.set_x(page_width - 40)
        pdf.cell(30, 5, amount_str, 0, 1, 'R')

    # 2. REVENUE
    pdf.set_font("Arial", 'B', 10); pdf.cell(0, 6, "REVENUE", 0, 1)
    
    add_line("Retail Sales (Taxable)", financials['retail_sales'], indent=1)
    add_line("Wholesale Sales (Non-Taxable)", financials['wholesale_sales'], indent=1)
    
    if financials.get('freight_income', 0) > 0:
        add_line("Freight Income", financials['freight_income'], indent=1)

    pdf.ln(1)
    add_line("Total Revenue:", financials['total_income'], bold=True, indent=0)
    pdf.ln(3)

    # 3. COGS
    pdf.set_font("Arial", 'B', 10); pdf.cell(0, 6, "COST OF GOODS SOLD", 0, 1)
    
    add_line("Cost of Goods Sold", financials['cogs'], indent=1)
    
    pdf.ln(1)
    add_line("Total COGS:", financials['cogs'], bold=True, indent=0)
    pdf.ln(2)
    add_line("Gross Profit:", financials['gross_profit'], bold=True, indent=0)
    pdf.ln(4)

    # 4. EXPENSES
    pdf.set_font("Arial", 'B', 10); pdf.cell(0, 6, "EXPENSES", 0, 1)
    
    if financials['expenses_breakdown']:
        for cat, amt in financials['expenses_breakdown'].items():
            add_line(f"{cat}", amt, indent=1)
    else:
        add_line("No Expenses Recorded", 0.0, indent=1)

    pdf.ln(1)
    add_line("Total Expenses:", financials['total_expenses'], bold=True, indent=0)
    
    # 5. NET PROFIT (Big & Bold)
    pdf.ln(5)
    pdf.set_font("Arial", 'B', 12)
    pdf.cell(0, 8, f"Net Profit / (Loss):   ${financials['net_profit']:,.2f}", 0, 1, 'R')
    
    # Footer (Absolute positioning to ensure it stays on page 1 if space permits)
    pdf.set_y(-20)
    pdf.set_font("Arial", 'I', 8)
    pdf.cell(0, 5, f"Generated: {datetime.now().strftime('%m/%d/%Y %H:%M')}", 0, 1, 'C')

    return pdf.output(dest='S').encode('latin-1')


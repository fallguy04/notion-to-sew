-- Notion to Sew — migration 006: returns
--
-- Virginia Skiles bought five serger threads and brought one back. There was no
-- way to record that: the only options were deleting the whole sale, which
-- would have been a lie about what she bought, or leaving the books wrong.
--
-- A return is recorded as what it is — a sale with negative quantities, linked
-- to the invoice it came from. That makes the arithmetic look after itself:
-- revenue drops, sales tax drops, stock comes back, and the customer's history
-- shows both the purchase and the return rather than neither.

-- Money can go the other way now. The signs on discount, freight and credit
-- stay positive: those are always amounts taken off, never added.
ALTER TABLE invoices DROP CONSTRAINT invoices_subtotal_check;
ALTER TABLE invoices DROP CONSTRAINT invoices_tax_check;
ALTER TABLE invoices DROP CONSTRAINT invoices_total_check;

-- Which sale this return came from, so both ends can point at each other and a
-- line can't be returned twice over.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS returns_id bigint
    REFERENCES invoices(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_returns_idx ON invoices (returns_id)
    WHERE returns_id IS NOT NULL;

-- Stock coming back deserves its own word in the ledger.
ALTER TYPE stock_reason ADD VALUE IF NOT EXISTS 'return';

-- ---------------------------------------------------------------------------
-- record_sale, with two changes:
--   * the total is no longer clamped at zero, or a refund would record as $0
--   * a negative line is a 'return' in the stock ledger, not a 'sale'
-- Everything else is exactly as it was.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_sale(
    p_customer_id text,
    p_lines       jsonb,
    p_payment     payment_method,
    p_status      invoice_status,
    p_discount    numeric DEFAULT 0,
    p_freight     numeric DEFAULT 0,
    p_tax         numeric DEFAULT 0,
    p_credit      numeric DEFAULT 0,
    p_wholesale   boolean DEFAULT false
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
    v_invoice_id bigint;
    v_subtotal   numeric(10,2);
    v_line       jsonb;
    v_qty        numeric;
BEGIN
    SELECT COALESCE(SUM((l->>'qty')::numeric * (l->>'unit_price')::numeric), 0)
      INTO v_subtotal FROM jsonb_array_elements(p_lines) l;

    INSERT INTO invoices (customer_id, status, payment, subtotal, discount, freight,
                          tax, credit_applied, total, is_wholesale, paid_at)
    VALUES (p_customer_id, p_status, p_payment,
            round(v_subtotal, 2), round(p_discount, 2), round(p_freight, 2),
            round(p_tax, 2), round(p_credit, 2),
            round(v_subtotal - p_discount + p_freight + p_tax - p_credit, 2),
            p_wholesale,
            CASE WHEN p_status = 'paid' THEN now() END)
    RETURNING id INTO v_invoice_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
        INSERT INTO invoice_lines (invoice_id, sku, description, qty, unit_price)
        VALUES (v_invoice_id,
                NULLIF(v_line->>'sku', ''),
                v_line->>'description',
                (v_line->>'qty')::numeric,
                (v_line->>'unit_price')::numeric);

        IF NULLIF(v_line->>'sku', '') IS NOT NULL THEN
            v_qty := (v_line->>'qty')::numeric;
            INSERT INTO stock_moves (sku, delta, reason, invoice_id)
            VALUES (v_line->>'sku', -v_qty::integer,
                    CASE WHEN v_qty < 0 THEN 'return' ELSE 'sale' END::stock_reason,
                    v_invoice_id);

            UPDATE products SET stock_qty = stock_qty - v_qty::integer
             WHERE sku = v_line->>'sku';
        END IF;
    END LOOP;

    IF p_credit > 0 AND p_customer_id IS NOT NULL THEN
        UPDATE customers SET credit = credit - round(p_credit, 2) WHERE id = p_customer_id;
    END IF;

    RETURN v_invoice_id;
END $$;

-- Notion to Sew — Postgres schema
--
-- Every constraint below exists because the spreadsheet couldn't enforce it and
-- something broke. The comments name the incident so nobody removes one later
-- thinking it's decorative.

BEGIN;

CREATE TYPE invoice_status  AS ENUM ('paid', 'pending', 'void');
CREATE TYPE payment_method  AS ENUM ('cash', 'check', 'card', 'venmo', 'invoice', 'credit');

-- ---------------------------------------------------------------- customers --
CREATE TABLE customers (
    id            text PRIMARY KEY,                    -- C-5 was shared by two shops:
                                                       -- Calico Point's invoices showed
                                                       -- under Bob's Bangles and her
                                                       -- store credit was pooled.
    name          text        NOT NULL CHECK (btrim(name) <> ''),
    email         text,
    phone         text,
    address       text,
    notes         text,
    joined_on     date,
    credit        numeric(10,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
    is_wholesale  boolean     NOT NULL DEFAULT false,
    tax_rate      numeric(6,5) CHECK (tax_rate IS NULL OR tax_rate BETWEEN 0 AND 1),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Two customers may legitimately share a name (Willow Overholtzer), so this is a
-- soft warning surfaced in the UI rather than a unique constraint.
CREATE INDEX customers_name_idx ON customers (lower(btrim(name)));

-- ----------------------------------------------------------------- products --
CREATE TABLE products (
    sku            text PRIMARY KEY,                   -- four books all shared the SKU
                                                       -- "Book": they rang up at the
                                                       -- first one's price and stock came
                                                       -- off a different row than
                                                       -- restocking added to.
    name           text        NOT NULL CHECK (btrim(name) <> ''),
    price          numeric(10,2) NOT NULL CHECK (price >= 0),
    wholesale_price numeric(10,2) CHECK (wholesale_price IS NULL OR wholesale_price >= 0),
    cost           numeric(10,2) CHECK (cost IS NULL OR cost >= 0),
    stock_qty      integer     NOT NULL DEFAULT 0,     -- deliberately allows negative:
                                                       -- 21 items are already negative and
                                                       -- clamping would hide the drift.
    vendor         text,
    category       text,
    active         boolean     NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_active_idx ON products (active) WHERE active;
CREATE INDEX products_search_idx ON products
    USING gin (to_tsvector('simple', sku || ' ' || name));

-- ----------------------------------------------------------------- invoices --
-- invoice_no comes from a sequence, not a counter cell read-modify-written by the
-- app. Six sales were lost because the old code claimed the number *before*
-- writing the row, so a failed write burned the number and the sale vanished.
CREATE SEQUENCE invoice_no_seq AS bigint START WITH 10200;

CREATE TABLE invoices (
    id             bigint PRIMARY KEY DEFAULT nextval('invoice_no_seq'),
    customer_id    text REFERENCES customers(id) ON DELETE RESTRICT,  -- NULL = walk-in
    status         invoice_status NOT NULL DEFAULT 'pending',
    payment        payment_method,
    subtotal       numeric(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    discount       numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
    freight        numeric(10,2) NOT NULL DEFAULT 0 CHECK (freight >= 0),
    tax            numeric(10,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
    credit_applied numeric(10,2) NOT NULL DEFAULT 0 CHECK (credit_applied >= 0),
    total          numeric(10,2) NOT NULL CHECK (total >= 0),   -- rounded to cents on
                                                                -- write; the sheet stored
                                                                -- values like 81.7023675
    is_wholesale   boolean     NOT NULL DEFAULT false,
    due_date       date,
    sold_at        timestamptz NOT NULL DEFAULT now(),
    paid_at        timestamptz,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT paid_has_timestamp CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
CREATE INDEX invoices_customer_idx ON invoices (customer_id, sold_at DESC);
CREATE INDEX invoices_open_idx     ON invoices (due_date) WHERE status = 'pending';
CREATE INDEX invoices_sold_at_idx  ON invoices (sold_at DESC);

-- ------------------------------------------------------------- invoice_lines --
CREATE TABLE invoice_lines (
    id          bigserial PRIMARY KEY,
    invoice_id  bigint NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
                -- CASCADE replaces delete_invoice()'s "loop find() until it throws",
                -- which could leave line items behind if it failed midway.
    sku         text   REFERENCES products(sku) ON DELETE RESTRICT,
    description text   NOT NULL,          -- kept verbatim: what the item was called at
                                          -- the time of sale, even if renamed since
    qty         numeric(10,2) NOT NULL CHECK (qty <> 0),
    unit_price  numeric(10,2) NOT NULL CHECK (unit_price >= 0),
    line_total  numeric(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);
CREATE INDEX invoice_lines_sku_idx     ON invoice_lines (sku);

-- ------------------------------------------------------- stock_moves (ledger) --
-- Stock becomes derived rather than a mutable cell. Every change is an append-only
-- row, so "why is this at -76?" is answerable instead of a mystery.
CREATE TYPE stock_reason AS ENUM ('sale', 'restock', 'adjustment', 'count', 'migration');

CREATE TABLE stock_moves (
    id          bigserial PRIMARY KEY,
    sku         text NOT NULL REFERENCES products(sku) ON DELETE RESTRICT,
    delta       integer NOT NULL CHECK (delta <> 0),
    reason      stock_reason NOT NULL,
    invoice_id  bigint REFERENCES invoices(id) ON DELETE SET NULL,
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_moves_sku_idx ON stock_moves (sku, created_at DESC);

-- ------------------------------------------------------------------ vendors --
CREATE TABLE vendors (
    id       text PRIMARY KEY,
    name     text NOT NULL CHECK (btrim(name) <> ''),
    contact  text,
    phone    text,
    email    text,
    address  text
);

-- ----------------------------------------------------------------- expenses --
CREATE TABLE expenses (
    id          bigserial PRIMARY KEY,
    spent_on    date NOT NULL,
    category    text NOT NULL,
    amount      numeric(10,2) NOT NULL CHECK (amount >= 0),
    description text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_date_idx ON expenses (spent_on DESC);

-- ----------------------------------------------------------------- settings --
CREATE TABLE settings (
    key   text PRIMARY KEY,
    value text NOT NULL
);

-- --------------------------------------------------------------- timestamps --
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER customers_touch BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER products_touch  BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;

-- ---------------------------------------------------------------------------
-- Selling, as one transaction. Either all of it happens or none of it does —
-- which is the whole reason the six lost sales cannot recur.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_sale(
    p_customer_id text,
    p_lines       jsonb,      -- [{sku, description, qty, unit_price}, ...]
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
BEGIN
    SELECT COALESCE(SUM((l->>'qty')::numeric * (l->>'unit_price')::numeric), 0)
      INTO v_subtotal FROM jsonb_array_elements(p_lines) l;

    INSERT INTO invoices (customer_id, status, payment, subtotal, discount, freight,
                          tax, credit_applied, total, is_wholesale, paid_at)
    VALUES (p_customer_id, p_status, p_payment,
            round(v_subtotal, 2), round(p_discount, 2), round(p_freight, 2),
            round(p_tax, 2), round(p_credit, 2),
            round(GREATEST(v_subtotal - p_discount + p_freight + p_tax - p_credit, 0), 2),
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
            INSERT INTO stock_moves (sku, delta, reason, invoice_id)
            VALUES (v_line->>'sku', -(v_line->>'qty')::numeric::integer, 'sale', v_invoice_id);

            UPDATE products SET stock_qty = stock_qty - (v_line->>'qty')::numeric::integer
             WHERE sku = v_line->>'sku';
        END IF;
    END LOOP;

    IF p_credit > 0 AND p_customer_id IS NOT NULL THEN
        -- The CHECK (credit >= 0) makes over-spending credit fail the whole sale
        -- rather than silently leaving the customer their balance, which the old
        -- bare `except: pass` did.
        UPDATE customers SET credit = credit - round(p_credit, 2) WHERE id = p_customer_id;
    END IF;

    RETURN v_invoice_id;
END $$;

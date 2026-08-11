-- Notion to Sew — migration 004: room for a fractional unit price
--
-- Six buttons sold together for 99c is 16.5c each. `unit_price numeric(10,2)`
-- rounded that to 17c and the line came to $1.02 — three cents over, with
-- nothing on screen to say so. It happened for real on invoice 10230.
--
-- Four decimal places is enough for any "N for $X" the shop actually sells,
-- and the money column stays at two: line_total is still rounded to the cent,
-- so nothing downstream sees a third decimal.
--
-- Widening never loses data. The generated column has to be dropped first
-- because Postgres won't alter a type another column is computed from; it is
-- re-added with exactly the same expression, and Postgres recomputes every row.

ALTER TABLE invoice_lines DROP COLUMN line_total;

ALTER TABLE invoice_lines ALTER COLUMN unit_price TYPE numeric(10,4);

ALTER TABLE invoice_lines
    ADD COLUMN line_total numeric(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED;

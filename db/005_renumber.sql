-- Notion to Sew — migration 005: let an invoice be filed under a gap
--
-- Six invoice numbers were spent without a sale ever being written, back when
-- the old checkout claimed the number first. Four of those sales happened;
-- their customers may still have the paperwork. Re-entering one should be able
-- to reclaim its original number, so the shop's copy and the customer's copy
-- agree and the numbering stays continuous.
--
-- That means changing an invoice's primary key after its lines and stock
-- movements already point at it. NO ACTION — the default — refuses, so the
-- children follow the parent instead. Nothing else about these constraints
-- changes: ON DELETE behaviour is restated exactly as it was.

ALTER TABLE invoice_lines DROP CONSTRAINT invoice_lines_invoice_id_fkey;
ALTER TABLE invoice_lines
    ADD CONSTRAINT invoice_lines_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE stock_moves DROP CONSTRAINT stock_moves_invoice_id_fkey;
ALTER TABLE stock_moves
    ADD CONSTRAINT stock_moves_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE email_log DROP CONSTRAINT email_log_invoice_id_fkey;
ALTER TABLE email_log
    ADD CONSTRAINT email_log_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE email_replies DROP CONSTRAINT email_replies_invoice_id_fkey;
ALTER TABLE email_replies
    ADD CONSTRAINT email_replies_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON UPDATE CASCADE ON DELETE SET NULL;

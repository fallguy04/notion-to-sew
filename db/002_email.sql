-- Notion to Sew — migration 002: the email log, and credentials set in the app
--
-- Additive only. Two new tables, nothing existing is touched.

-- ------------------------------------------------------------- email_log --
-- Every receipt and invoice the app tries to send, and what came of it.
--
-- The point is the failures. A send that doesn't arrive is invisible otherwise:
-- the customer is already out of the door, and the only record was a toast that
-- disappeared after four seconds.
CREATE TABLE IF NOT EXISTS email_log (
    id          bigserial PRIMARY KEY,
    sent_at     timestamptz NOT NULL DEFAULT now(),
    to_address  text NOT NULL,
    subject     text NOT NULL,
    kind        text NOT NULL,                    -- receipt | invoice | test
    source      text NOT NULL,                    -- admin | kiosk | settings
    invoice_id  bigint REFERENCES invoices(id) ON DELETE SET NULL,
    status      text NOT NULL CHECK (status IN ('sent', 'failed')),
    message_id  text,                             -- what the mail server called it
    error       text
);
CREATE INDEX IF NOT EXISTS email_log_sent_at_idx ON email_log (sent_at DESC);
CREATE INDEX IF NOT EXISTS email_log_invoice_idx ON email_log (invoice_id);

-- ----------------------------------------------------------- app_secrets --
-- Credentials the shop sets from inside the app, encrypted with the server's
-- KIOSK_SESSION_SECRET.
--
-- Deliberately not in `settings`: that table is read wholesale and rendered on
-- screen in several places, and a credential must never be one careless
-- SELECT * away from a web page. `hint` is the only part safe to display.
CREATE TABLE IF NOT EXISTS app_secrets (
    key         text PRIMARY KEY,
    ciphertext  text NOT NULL,
    hint        text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

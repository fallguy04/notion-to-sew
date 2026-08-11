-- Notion to Sew — migration 003: did it arrive, and did they write back
--
-- Additive only. New columns default to NULL and new tables start empty, so
-- everything that worked before this ran still works after it.

-- Gmail can tell you a message left the building and nothing more. A sending
-- service reports back what happened to it, through a webhook — so the log
-- gains somewhere to put that.
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS provider       text NOT NULL DEFAULT 'smtp';
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS delivered_at   timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS opened_at      timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS bounced_at     timestamptz;
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS failure_reason text;

-- Webhooks arrive knowing only the provider's own id for the message.
CREATE INDEX IF NOT EXISTS email_log_message_idx ON email_log (message_id);

-- --------------------------------------------------------- email_replies --
-- Replies to receipts and invoices, so "she says she paid it" is something you
-- can look up rather than something you have to remember.
--
-- Matched to a customer by the address they wrote from, and to an invoice by
-- the number in the subject line. Both are best-effort: an unmatched reply is
-- still worth showing, so neither is required.
CREATE TABLE IF NOT EXISTS email_replies (
    id           bigserial PRIMARY KEY,
    received_at  timestamptz NOT NULL DEFAULT now(),
    provider_id  text UNIQUE,               -- so a redelivered webhook is not a second reply
    from_address text NOT NULL,
    from_name    text,
    subject      text,
    body         text,
    attachments  integer NOT NULL DEFAULT 0,
    invoice_id   bigint REFERENCES invoices(id) ON DELETE SET NULL,
    customer_id  text   REFERENCES customers(id) ON DELETE SET NULL,
    read_at      timestamptz
);
CREATE INDEX IF NOT EXISTS email_replies_received_idx ON email_replies (received_at DESC);
CREATE INDEX IF NOT EXISTS email_replies_customer_idx ON email_replies (customer_id);
CREATE INDEX IF NOT EXISTS email_replies_unread_idx   ON email_replies (received_at DESC)
    WHERE read_at IS NULL;

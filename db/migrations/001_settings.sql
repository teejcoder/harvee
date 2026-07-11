-- 001_settings.sql — singleton settings row per .memory/domain-model.md §4
-- and .memory/conventions.md §1 (id = literal integer 1, not a ULID).

CREATE TABLE settings (
  id                          INTEGER PRIMARY KEY CHECK (id = 1),
  sender_name                 TEXT    NOT NULL,
  sender_address              TEXT    NOT NULL,
  sender_email                TEXT    NOT NULL,
  sender_phone                TEXT,
  payment_instructions        TEXT    NOT NULL,
  currency_code               TEXT    NOT NULL,
  currency_decimals           INTEGER NOT NULL,
  default_payment_terms_days  INTEGER NOT NULL,
  invoice_locale              TEXT    NOT NULL
);

-- Seed placeholder values; user overwrites on first visit to /settings.
INSERT INTO settings (
  id,
  sender_name,
  sender_address,
  sender_email,
  sender_phone,
  payment_instructions,
  currency_code,
  currency_decimals,
  default_payment_terms_days,
  invoice_locale
) VALUES (
  1,
  'Your Name',
  'Your Address',
  'you@example.com',
  NULL,
  'Payment instructions here.',
  'USD',
  2,
  30,
  'en-US'
);

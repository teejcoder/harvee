-- 006_client_default_terms.sql — optional per-client default payment terms.
-- NULL means "fall back to settings.default_payment_terms_days" at invoice
-- generation (per .memory/domain-model.md §7). Existing clients backfill to NULL.

ALTER TABLE clients ADD COLUMN default_payment_terms_days INTEGER;

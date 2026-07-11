-- 003_invoices.sql — invoices + invoice_line_items.
-- Per .memory/domain-model.md §5, §6, §8, §10 and
-- .memory/state-transitions.md §3.

CREATE TABLE invoices (
  id                  TEXT    PRIMARY KEY,
  client_id           TEXT    NOT NULL REFERENCES clients(id),
  state               TEXT    NOT NULL CHECK (state IN (
                        'invoice.draft',
                        'invoice.finalized',
                        'invoice.exported',
                        'invoice.voided'
                      )),
  start_date          TEXT    NOT NULL,  -- local date YYYY-MM-DD (inclusive)
  end_date            TEXT    NOT NULL,  -- local date YYYY-MM-DD (inclusive)
  invoice_number      TEXT    UNIQUE,    -- YYYYMMDD-N; NULL until finalize
  payment_terms_days  INTEGER NOT NULL,
  currency_code       TEXT    NOT NULL,  -- snapshotted from settings at generation
  currency_decimals   INTEGER NOT NULL,
  invoice_locale      TEXT    NOT NULL,
  subtotal            INTEGER NOT NULL,  -- integer minor units
  discount_total      INTEGER NOT NULL,  -- integer minor units, <= 0
  total               INTEGER NOT NULL,  -- integer minor units, = subtotal + discount_total
  finalized_at        TEXT,              -- NOT NULL once state != draft
  voided_at           TEXT,              -- NOT NULL only when state = voided
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,

  -- Date range sanity.
  CHECK (end_date >= start_date),

  -- Money invariants (domain-model.md §8).
  CHECK (discount_total <= 0),
  CHECK (total = subtotal + discount_total),

  -- State-dependent nullability. Both sides of `=` evaluate to 1/0 in SQLite;
  -- a mismatch means CHECK failure. Read as: "field X is NULL iff state is Y".
  CHECK ((state = 'invoice.draft') = (invoice_number IS NULL)),
  CHECK ((state = 'invoice.draft') = (finalized_at IS NULL)),
  CHECK ((state = 'invoice.voided') = (voided_at IS NOT NULL))
);

CREATE INDEX idx_invoices_client_id ON invoices(client_id);
CREATE INDEX idx_invoices_state     ON invoices(state);

CREATE TABLE invoice_line_items (
  id           TEXT    PRIMARY KEY,
  invoice_id   TEXT    NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL CHECK (kind IN ('task', 'discount')),
  task_id      TEXT    REFERENCES tasks(id),
  description  TEXT    NOT NULL,
  hours        REAL,     -- decimal hours; NULL for discount lines
  rate         INTEGER,  -- integer minor units; NULL for discount lines
  amount       INTEGER NOT NULL,
  sort_order   INTEGER NOT NULL,

  -- Kind-specific field shape and sign (domain-model.md §8.1 / §8.2).
  CHECK (
    (kind = 'task'
       AND task_id IS NOT NULL
       AND hours   IS NOT NULL AND hours  > 0
       AND rate    IS NOT NULL
       AND amount  > 0)
    OR
    (kind = 'discount'
       AND task_id IS NULL
       AND hours   IS NULL
       AND rate    IS NULL
       AND amount  < 0)
  )
);

CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX idx_invoice_line_items_task_id    ON invoice_line_items(task_id);

-- At most one discount line per invoice (domain-model.md §8.2).
CREATE UNIQUE INDEX idx_invoice_line_items_one_discount_per_invoice
  ON invoice_line_items(invoice_id)
  WHERE kind = 'discount';

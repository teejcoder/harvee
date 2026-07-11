-- 004_time_entries.sql — time entries and their segments.
-- Per .memory/domain-model.md §10 and .memory/state-transitions.md §2.

CREATE TABLE time_entries (
  id                  TEXT    PRIMARY KEY,
  task_id             TEXT    NOT NULL REFERENCES tasks(id),
  notes               TEXT    NOT NULL DEFAULT '',
  state               TEXT    NOT NULL CHECK (state IN (
                        'entry.draft',
                        'entry.running',
                        'entry.stopped',
                        'entry.editing',
                        'entry.locked',
                        'entry.discarded'
                      )),
  invoice_id          TEXT    REFERENCES invoices(id),
  edit_form_snapshot  TEXT,   -- nullable JSON payload while state = entry.editing
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,

  -- Locked entries must point at an invoice; non-locked entries must not.
  CHECK (
    (state = 'entry.locked' AND invoice_id IS NOT NULL) OR
    (state != 'entry.locked' AND invoice_id IS NULL)
  )
);

CREATE INDEX idx_time_entries_task_id    ON time_entries(task_id);
CREATE INDEX idx_time_entries_state      ON time_entries(state);
CREATE INDEX idx_time_entries_invoice_id ON time_entries(invoice_id);

CREATE TABLE time_entry_segments (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES time_entries(id),
  started_at  TEXT NOT NULL,
  stopped_at  TEXT,

  CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

CREATE INDEX idx_time_entry_segments_entry_id ON time_entry_segments(entry_id);

-- At most one open (stopped_at IS NULL) segment per entry per
-- .memory/state-transitions.md §2 segment model.
CREATE UNIQUE INDEX idx_time_entry_segments_one_open_per_entry
  ON time_entry_segments(entry_id)
  WHERE stopped_at IS NULL;

# Domain Model

The business rules and data shapes that aren't captured by the state machines in [[state-transitions]]. Read alongside [[overview]] and [[conventions]].

---

## 1. Timezone

- All day/week/month boundaries — invoice date ranges, calendar views — are computed in the **system local timezone** (the machine's `Intl.DateTimeFormat().resolvedOptions().timeZone`).
- All timestamps are **stored as UTC ISO 8601** in the database.
- The system-local timezone is used only for _display_ and _day-boundary math_, never for storage.
- If the user changes the machine timezone, past data is unaffected; boundaries are recomputed on read.

---

## 2. Rates

- Rate is a field on the **project** (`projects.hourly_rate`, integer minor units — see Currency below).
- Every task inherits its parent project's rate. Tasks have no rate field.
- When an invoice draft is generated, each line item's rate is **snapshotted** from the project at generation time (`invoice_line_items.rate`). Subsequent edits to the project's rate do not affect existing drafts or finalized invoices.
- The user may edit a line item's rate while in `invoice.draft`.

---

## 3. Currency

- Single currency for the entire app, configured in the sender settings record (see §4).
- Stored as an **ISO 4217 code** (e.g. `"USD"`, `"EUR"`) plus a **decimal-places** value (2 for most, 0 for JPY, etc.).
- All monetary values in the database are **integer minor units** (cents for USD). Rates, line-item amounts, invoice totals — all integers. Formatting happens at render time using `Intl.NumberFormat(locale, { style: "currency", currency })`.
- Changing the configured currency does **not** rewrite historical invoices. Existing invoices always render in the currency they were finalized under, which is snapshotted onto the invoice row.

---

## 4. Sender identity ("me")

Single row in a `settings` table (enforced with `CHECK (id = 1)`). Fields:

| Field                        | Type             | Notes                                                         |
| ---------------------------- | ---------------- | ------------------------------------------------------------- |
| `sender_name`                | text             | e.g. "Teej Contract Dev"                                      |
| `sender_address`             | text (multiline) | Postal address                                                |
| `sender_email`               | text             |                                                               |
| `sender_phone`               | text (nullable)  |                                                               |
| `payment_instructions`       | text (multiline) | Bank/wire/other; rendered on the PDF                          |
| `currency_code`              | text             | ISO 4217, e.g. `"USD"`                                        |
| `currency_decimals`          | integer          | e.g. `2`                                                      |
| `default_payment_terms_days` | integer          | e.g. `30` for Net 30                                          |
| `invoice_locale`             | text             | e.g. `"en-US"`; used for currency and date formatting on PDFs |

Editable via a `/settings` page in the UI. There is exactly one row and it always exists (seeded by the initial migration with placeholder values the user overwrites on first use).

---

## 5. Invoice numbering

- Format: **`YYYYMMDD-N`** where `YYYYMMDD` is the invoice's `finalized_at` date in the system-local timezone and `N` is a per-day counter starting at 1.
- The number is assigned atomically at **finalize time**, not at draft creation. Drafts have `invoice_number = NULL`.
- The counter resets each day. Uniqueness enforced by `UNIQUE (invoice_number)`.
- If two invoices are finalized on the same day, the second is `YYYYMMDD-2`, etc.
- Voiding an invoice does **not** free its number. The number stays with the voided record.

---

## 6. Invoice scope and generation

- An invoice covers **one client + one inclusive date range** `[startDate, endDate]`, day-precision, interpreted in the system-local timezone.
- "Generate invoice" gathers all `entry.stopped` records where:
  - `entry.client_id = <selected client>`,
  - the entry has **at least one segment** whose `startedAt` (converted to local date) falls within `[startDate, endDate]`,
  - the entry is not already linked to any non-voided invoice (`entry.invoice_id IS NULL`).
- Entries whose segments span into or out of the range are still included **whole** — segment splitting is not supported.
- Line items are aggregated **per task**: one line per distinct task in the gathered entries, with `hours` = sum of segment durations across that task's included entries and `rate` = the project's current `hourly_rate` snapshot.

---

## 7. Payment terms and due date

- Default payment term in days lives in `settings.default_payment_terms_days`.
- A client may set its own `clients.default_payment_terms_days` (nullable); when set it overrides the settings default for that client's invoices. NULL falls back to the settings default.
- Each invoice has its own `payment_terms_days` column, initialized at draft creation from the client's default (if any), else the settings default.
- Editable while `invoice.draft`. Frozen at finalize.
- Due date is computed at render time: `due_date = finalized_at (date) + payment_terms_days`. Displayed on the PDF and the invoice detail page. Not stored.

---

## 8. Line-item rules

An invoice has two kinds of line items:

### 8.1 Task lines (auto-generated)

- Created when a draft is generated.
- One per distinct task in scope.
- Fields: `task_id`, `description` (defaults to `"<Project name> — <Task name>"`, editable), `hours` (decimal), `rate` (integer minor units), `amount` = `round(hours * rate)`.
- Editable in draft: description, hours, rate. `amount` is always recomputed from `hours * rate`.
- **Must be positive**: `hours > 0` and `amount > 0`. A draft cannot be finalized if any task line is non-positive.

### 8.2 Discount line (manual, optional)

- At most **one** discount line per invoice.
- Fields: `description` (user-supplied, e.g. `"Early-payment discount"`), `amount` (integer minor units, **must be negative**).
- No `task_id`, no `hours`, no `rate`.
- Added and removed by the user while in `invoice.draft`.
- Attempting to finalize with more than one discount line, or a discount line whose amount is `>= 0`, is rejected (`invalid_discount_line` — see [[state-transitions]]).

### 8.3 Total

- `invoice.subtotal` = sum of task line amounts.
- `invoice.discount_total` = discount line amount (0 if no discount line).
- `invoice.total` = `subtotal + discount_total`.
- Finalizing requires `total > 0` (`invoice_non_positive_total`).

---

## 9. Hour rounding

- **No automatic rounding.** Hours are stored and displayed to the precision of the underlying segments (millisecond math on `startedAt`/`stoppedAt`, displayed to 2 decimals on the invoice).
- If the user wants to bill rounded hours, they **edit the time entry's segments** directly to whatever times they want. The invoice always reflects exact segment math.

---

## 10. Data model summary (tables)

| Table                 | Key columns                                                                                                                                                                                                                                                          |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settings`            | id (always 1), sender fields, currency_code, currency_decimals, default_payment_terms_days, invoice_locale                                                                                                                                                           |
| `clients`             | id (ULID), name, default_payment_terms_days (nullable — overrides settings default), archived_at (nullable), timestamps                                                                                                                                              |
| `projects`            | id, client_id, name, hourly_rate (int minor units), archived_at, timestamps                                                                                                                                                                                          |
| `tasks`               | id, project_id, name, description, archived_at, timestamps                                                                                                                                                                                                           |
| `time_entries`        | id, task_id, notes, state (`entry.*`), invoice_id (nullable), edit_form_snapshot (nullable JSON for `entry.editing`), timestamps                                                                                                                                     |
| `time_entry_segments` | id, entry_id, started_at, stopped_at (nullable while running)                                                                                                                                                                                                        |
| `invoices`            | id, client_id, state (`invoice.*`), start_date, end_date, invoice_number (nullable until finalize), payment_terms_days, currency_code, currency_decimals, invoice_locale, subtotal, discount_total, total, finalized_at (nullable), voided_at (nullable), timestamps |
| `invoice_line_items`  | id, invoice_id, kind (`task` \| `discount`), task_id (nullable), description, hours (nullable for discount), rate (nullable for discount), amount, sort_order                                                                                                        |

Column names in SQL are snake_case; TypeScript representations are camelCase (see [[conventions]]).

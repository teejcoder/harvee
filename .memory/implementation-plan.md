# Implementation Plan

Build order for harvest-clone. Each step is small, has one goal, and ends with a validation gate. Do not start step N+1 until step N's validation passes.

Two validation modes are used:

- **HITL** — human-in-the-loop: user opens a page, runs a command, or reads a file to confirm.
- **AI-FB** — AI feedback loop: the system emits structured output (JSONL log, JSON report, test result) that the AI reads and evaluates autonomously.

Every step below has at least one.

Load-bearing context: [[overview]], [[state-transitions]], [[tech-stack]], [[domain-model]], [[conventions]].

---

## Phase 0 — Foundations

### Step 0.1 — Initialize repo skeleton

**Goal:** SvelteKit 2 + Svelte 5 (runes) + TypeScript strict + Tailwind v4 project boots on Node 22.
**Validation (HITL):** `pnpm dev` serves the default page at `localhost:5173`.
**Validation (AI-FB):** `pnpm build` exits 0; `pnpm check` (svelte-check) reports zero errors.

### Step 0.2 — Add VitePress docs site

**Goal:** `docs/` runs as a VitePress site with the sidebar sections from [[tech-stack]] stubbed (one empty `index.md` per section).
**Validation (HITL):** `pnpm docs:dev` serves at `localhost:5174` and every sidebar link resolves.
**Validation (AI-FB):** `pnpm docs:build` writes `docs/.vitepress/dist/` and exits 0.

### Step 0.3 — Create `docs/changelog.md`

**Goal:** Empty Keep-a-Changelog file with an `Unreleased` section.
**Validation (HITL):** File renders in the docs site under "Changelog".

### Step 0.4 — ULID module (`src/lib/ids.ts`)

**Goal:** Single `ulid()` function used for every entity ID and every correlation ID.
**Validation (AI-FB):** Vitest test asserts output matches `/^[0-9A-HJKMNP-TV-Z]{26}$/` and that 10k generated IDs are sortable in ascending time order.

### Step 0.5 — Time module (`src/lib/time.ts`)

**Goal:** `nowUtcIso()`, `localDayBounds(date)`, `localWeekBounds(date)`, `localMonthBounds(yyyyMm)`, `localDateOf(utcIso)` — all timezone math in one place per [[conventions]] §4.
**Validation (AI-FB):** Vitest table-driven tests using `vi.setSystemTime()` cover DST forward, DST back, and a non-DST timezone. All pass.

### Step 0.6 — Structured logger (`src/lib/log.ts`)

**Goal:** `log.debug/info/warn/error({...})` appends camelCase-keyed JSON lines to `logs/transitions.jsonl`. Includes a `logTransition({...})` helper writing the transition schema from [[state-transitions]].
**Validation (AI-FB):** Test invokes each level plus one accepted and one rejected transition; AI reads the resulting file and confirms:

- every line parses as JSON,
- general log lines have `timestamp`, `level`, `event`,
- transition lines have `timestamp`, `previousState`, `newState`, `accepted`, `trigger`, `actor` (transition lines omit `level` and `event`; `trigger` is the equivalent field per [[state-transitions]] §Structured Transition Log),
- rejected transitions have `rejectionReason` populated with a canonical code from the exported `REJECTION_REASONS` list.

### Step 0.7 — Correlation ID hook (`src/hooks.server.ts`)

**Goal:** For every non-GET request, mint a ULID, set `event.locals.correlationId`, and attach header `X-Correlation-Id`. GET requests get no correlation ID per [[conventions]] §5.
**Validation (AI-FB):** Playwright-free curl-driven test: POST returns `X-Correlation-Id` header matching ULID regex; GET does not.

---

## Phase 1 — Data layer

### Step 1.1 — Migration runner (startup)

**Goal:** On app startup, apply every `.sql` file in `db/migrations/` in ascending filename order against `./data.sqlite`; skip already-applied files (tracked in a `_migrations` table). No separate CLI command.
**Validation (HITL):** Delete `data.sqlite`, run `pnpm dev`, confirm file appears and app boots.
**Validation (AI-FB):** Second boot logs `event: "db.migrate.skip"` for every migration file with zero writes.

### Step 1.2 — Schema: settings singleton

**Goal:** Migration `001_settings.sql` creates the singleton `settings` row per [[domain-model]] §4, seeded with placeholder values.
**Validation (AI-FB):** Introspection script confirms `CHECK (id = 1)` constraint and that exactly one row exists after boot.

### Step 1.3 — Schema: clients, projects, tasks

**Goal:** Migration `002_clients_projects_tasks.sql` with ULID PKs, `name`, `archived_at` nullable, timestamps; `projects.hourly_rate` INTEGER (minor units); FKs `projects.client_id`, `tasks.project_id`.
**Validation (AI-FB):** Introspection JSON matches the column list in [[domain-model]] §10.

### Step 1.4 — Schema: invoices + invoice_line_items

**Goal:** Migration `003_invoices.sql`. Invoices carry `state`, `client_id`, `start_date`, `end_date`, `invoice_number` nullable UNIQUE, `payment_terms_days`, snapshotted `currency_code` / `currency_decimals` / `invoice_locale`, `subtotal`, `discount_total`, `total`, `finalized_at` nullable, `voided_at` nullable. Line items carry `kind` (`task`|`discount`), nullable `task_id`, `description`, nullable `hours`, nullable `rate`, `amount`, `sort_order`.
**Validation (AI-FB):** Introspection confirms columns and the `UNIQUE (invoice_number)` index.
**Ordering note:** invoices lands before time_entries because `time_entries.invoice_id` FK-references `invoices.id`. SQLite with `foreign_keys = ON` rejects INSERTs into a table that FK-references a not-yet-created table, even for NULL FK values. Original plan had these steps swapped; swap discovered during Step 1.4 implementation.

### Step 1.5 — Schema: time_entries + time_entry_segments

**Goal:** Migration `004_time_entries.sql` for `time_entries` (`task_id`, `notes`, `state`, `invoice_id` nullable FK → invoices.id, `edit_form_snapshot` nullable JSON) and `time_entry_segments` (`entry_id`, `started_at`, `stopped_at` nullable). Constraints: `stopped_at IS NULL OR stopped_at >= started_at`; at most one segment per entry with `stopped_at IS NULL`.
**Validation (AI-FB):** Introspection confirms columns, FKs (including `invoice_id → invoices.id` now that `invoices` exists), and that the check constraints exist.

### Step 1.6 — Query modules

**Goal:** `src/lib/db/queries/{settings,clients,projects,tasks,entries,segments,invoices,lineItems}.ts` — typed functions per [[conventions]] §7. Every write signature takes `correlationId: string`; reads omit it.
**Validation (AI-FB):** Vitest suite inserts and reads one row per entity, converts snake_case → camelCase, all pass. A separate test asserts that calling a write function without a correlation ID logs an `error` line and throws.

---

## Phase 2 — State machines

### Step 2.1 — Client / Project / Task state machine (`src/lib/state/{client,project,task}.ts`)

**Goal:** Pure `canTransition(from, to, ctx)` and `apply(from, to, ctx, correlationId)` for the setup lifecycle in [[state-transitions]] §1, including the "block archive if children exist" rule.
**Validation (AI-FB):** Table-driven Vitest covers every accepted transition and every rejection reason (`parent_archived`, `children_not_archived`, `task_has_running_timer`, `referenced_by_invoice`). Output is a JSON coverage report the AI diffs against the transition tables.

### Step 2.2 — Time entry state machine (`src/lib/state/entry.ts`)

**Goal:** Same shape, for the entry lifecycle including the multi-segment resume model per [[state-transitions]] §2. Handles Start, Stop, Edit (opens `entry.editing` with persisted `edit_form_snapshot`), Save, Cancel, Resume (opens a new segment), Discard, invoice-finalize lock, invoice-void discard.
**Validation (AI-FB):** Table-driven Vitest covers every accepted transition and every rejection reason. Explicit scenario tests:

- Start → Stop → Resume → Stop produces one entry with two segments, total duration = sum.
- Attempting a second Start while one entry is running logs `concurrent_timer_forbidden`.
- Editing a segment to overlap another logs `segment_overlap`.

### Step 2.3 — Invoice state machine (`src/lib/state/invoice.ts`)

**Goal:** Draft → finalized → exported / voided per [[state-transitions]] §3, including the line-item rules from [[domain-model]] §8.
**Validation (AI-FB):** Table-driven test covers every transition and rejection reason (`no_billable_entries`, `invoice_locked`, `invoice_non_positive_total`, `invalid_discount_line`, `must_finalize_before_export`, `void_requires_finalized`). Cascade test: finalize emits one invoice transition plus N `entry.stopped → entry.locked` lines sharing one correlation ID; void emits one invoice transition plus N `entry.locked → entry.discarded` lines sharing one correlation ID.

### Step 2.4 — Wire state machines to the transition logger

**Goal:** Every `apply()` and every rejection emits a `logTransition` line matching the schema in [[state-transitions]] §Structured Transition Log.
**Validation (AI-FB):** Scripted end-to-end scenario (create client → project → task → start → stop → edit → save → generate invoice → finalize) produces exactly the expected sequence of lines in `logs/transitions.jsonl`; AI diffs actual vs. expected.

---

## Phase 3 — Setup UI

### Step 3.1 — Settings page

**Goal:** `/settings` renders the singleton settings row and lets the user edit sender fields, currency, default payment terms, locale.
**Validation (HITL):** User saves settings, refreshes, values persist.
**Validation (AI-FB):** DB row reflects the submitted values; log line at `info` with `before`/`after`.

### Step 3.2 — Clients list + create form

**Goal:** `/clients` route lists clients and has a form to create one.
**Validation (HITL):** User creates a client, sees it in the list, refreshes, still there.
**Validation (AI-FB):** Transition log entry `— → client.active` with the entered name.

### Step 3.3 — Projects under a client

**Goal:** `/clients/[id]` shows projects (with `hourly_rate`) and a form to create one.
**Validation (HITL):** User creates a project; appears with correct rate.
**Validation (AI-FB):** Attempting to create a project under an archived client is rejected with `rejectionReason: "parent_archived"`.

### Step 3.4 — Tasks under a project

**Goal:** `/projects/[id]` shows tasks and a form to create one.
**Validation (HITL):** User creates a task; appears under project.
**Validation (AI-FB):** Creation transition logged.

### Step 3.5 — Archive / unarchive

**Goal:** Archive buttons on client, project, task. "Block if children" rule enforced.
**Validation (AI-FB):** Attempting to archive a client with any `project.active` under it logs `rejectionReason: "children_not_archived"`. Archiving a task with a running timer logs `rejectionReason: "task_has_running_timer"`.

---

## Phase 4 — Timer

### Step 4.1 — Timer widget: create draft, Start

**Goal:** A persistent widget lets the user pick a task, which creates an `entry.draft` row. Clicking Start opens the first segment and transitions to `entry.running`.
**Validation (HITL):** Picking a task then refreshing keeps the draft (persisted state); clicking Start shows a live-updating elapsed time.
**Validation (AI-FB):** Transition log has `— → entry.draft` followed by `entry.draft → entry.running`.

### Step 4.2 — Stop

**Goal:** Stop closes the open segment and transitions to `entry.stopped`.
**Validation (HITL):** Widget returns to idle; entry appears in a "today" list with correct duration.
**Validation (AI-FB):** `entry.running → entry.stopped` line present; segment's `stopped_at > started_at`.

### Step 4.3 — Concurrent-timer rejection

**Goal:** Starting a second timer while one runs is rejected at the state-machine layer; UI shows an inline error.
**Validation (HITL):** Error visible in UI.
**Validation (AI-FB):** `rejectionReason: "concurrent_timer_forbidden"`.

### Step 4.4 — Notes

**Goal:** Notes editable on draft, running, or stopped entries. Not editable on locked entries.
**Validation (HITL):** Typed note persists across refresh.
**Validation (AI-FB):** Attempting to edit notes on a locked entry logs `entry_locked_by_invoice`.

### Step 4.5 — Edit stopped entry (segment editor)

**Goal:** Clicking an entry opens `entry.editing` (persisted). User can add/edit/delete individual segments.
**Validation (HITL):** Adjusted segments are reflected in totals; closing and reopening the edit form preserves in-progress form values (persisted `edit_form_snapshot`).
**Validation (AI-FB):** Invalid range logs `invalid_time_range`; overlapping segments logs `segment_overlap`.

### Step 4.6 — Resume

**Goal:** From a stopped entry, Resume opens a new segment on the same entry and returns it to `entry.running`.
**Validation (HITL):** Total time = sum of all segments.
**Validation (AI-FB):** Two `entry.stopped → entry.running` transitions on the same entity ID over its lifetime produce a `time_entry_segments` count of 2.

---

## Phase 5 — Calendar / historical view

Boundaries are computed in the **system-local timezone** via `src/lib/time.ts`.

### Step 5.1 — Day view

**Goal:** `/calendar/day/[date]` lists entries (grouped by task) whose segments intersect that local day; shows per-project totals for the day.
**Validation (HITL):** Yesterday's entries render correctly.
**Validation (AI-FB):** Sum of displayed durations matches SQL `SUM` of segment intersections for the day.

### Step 5.2 — Week view

**Goal:** `/calendar/week/[date]` — 7-column grid with entries and daily totals.
**Validation (HITL):** Weekly total matches sum of the 7 day-view totals.

### Step 5.3 — Month view

**Goal:** `/calendar/month/[yyyy-mm]` — calendar grid with per-day totals.
**Validation (HITL):** Clicking a day navigates to that day's view.

---

## Phase 6 — Invoicing

### Step 6.1 — Generate draft invoice

**Goal:** From a client page, "Generate invoice" prompts for `[startDate, endDate]` and creates an `invoice.draft` per [[domain-model]] §6. Task lines auto-generated, rates snapshotted from projects, currency/locale snapshotted from settings.
**Validation (HITL):** Draft page renders correct line items and total.
**Validation (AI-FB):** `— → invoice.draft` logged; source-entry count matches expected count from a control SQL query.

### Step 6.2 — No-billable-entries rejection

**Goal:** Generating on a (client, range) with no unbilled entries is rejected.
**Validation (AI-FB):** `rejectionReason: "no_billable_entries"`.

### Step 6.3 — Edit draft (task lines, discount line, terms)

**Goal:** Task line description/hours/rate editable; add/remove single discount line (negative amount); change payment terms. Amount always recomputed from hours × rate for task lines.
**Validation (HITL):** Edits persist; total reflects subtotal + discount.
**Validation (AI-FB):** Attempting to add a second discount line, or a non-negative discount line, logs `invalid_discount_line`.

### Step 6.4 — Finalize

**Goal:** Finalize assigns `invoice_number = YYYYMMDD-N` per [[domain-model]] §5, transitions the invoice to `invoice.finalized`, and cascades every source entry to `entry.locked` under one correlation ID.
**Validation (AI-FB):** One transition-log line for the invoice plus N for entries, all with the same `correlationId`. `invoice_number` matches format.

### Step 6.5 — Finalize guards

**Goal:** Reject finalize when total ≤ 0, or when any task line is non-positive, or on already-finalized invoice.
**Validation (AI-FB):** `rejectionReason` is one of `invoice_non_positive_total`, `invoice_locked`.

### Step 6.6 — Export PDF

**Goal:** Export button renders the finalized invoice via `pdf-lib`, writes to `./invoices/<invoiceNumber>.pdf`, and streams the same bytes to the browser as a download.
**Validation (HITL):** User opens the PDF and confirms sender block, client block, line items, subtotal, discount, total, due date, invoice number, currency formatting.
**Validation (AI-FB):** `invoice.finalized → invoice.exported` line logged; file exists at expected path with non-zero size and valid PDF header (`%PDF-`).

### Step 6.7 — Void

**Goal:** Voiding a finalized (or exported) invoice cascades every source entry to `entry.discarded`.
**Validation (AI-FB):** One transition line for the invoice plus N for entries, all sharing one correlation ID. Attempting to void a draft logs `void_requires_finalized`.

---

## Phase 7 — Documentation catch-up

### Step 7.1 — Architecture pages

**Goal:** `docs/architecture/overview.md`, `state-machines.md` (Mermaid from [[state-transitions]]), `data-model.md` (schema summary from [[domain-model]] §10).
**Validation (HITL):** User reads and confirms accuracy.

### Step 7.2 — Guides

**Goal:** `docs/guides/running-locally.md`, `generating-an-invoice.md`, `editing-time-entries.md`.
**Validation (HITL):** A first-time reader can follow each guide end to end without asking questions.

### Step 7.3 — Changelog backfill

**Goal:** `docs/changelog.md` has one `Added` entry per phase completed, with dates.
**Validation (HITL):** User reviews and approves.

---

## Global validation invariant

At any point during the build, the AI can run this self-check:

1. Read the last 200 lines of `logs/transitions.jsonl`.
2. Every line parses as JSON with camelCase keys.
3. No accepted transition uses a `(previousState → newState)` pair that isn't in the transition tables in [[state-transitions]].
4. Every rejection uses one of the canonical codes:
   `parent_archived`, `children_not_archived`, `task_has_running_timer`, `referenced_by_invoice`,
   `concurrent_timer_forbidden`, `entry_locked_by_invoice`, `invalid_time_range`, `segment_overlap`, `task_archived`, `cannot_edit_running_entry`,
   `no_billable_entries`, `invoice_locked`, `invoice_non_positive_total`, `invalid_discount_line`, `must_finalize_before_export`, `void_requires_finalized`.
5. Every transition whose actor is `system` shares a `correlationId` with the user-triggered transition that spawned its cascade.

If any check fails, stop and fix before proceeding.

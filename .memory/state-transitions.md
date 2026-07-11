# State Transitions

Defines the state machines that drive the system. Three linked lifecycles: **Client/Project/Task setup**, **Time Entry (timer)**, and **Invoice**.

For conventions on IDs, log key casing, and correlation-ID origin, see [[conventions]].
For rate, currency, invoice-number, and line-item rules, see [[domain-model]].

---

## 1. Client / Project / Task Lifecycle

### States

- `client.draft` — client record being created, not yet saved
- `client.active` — client saved, available to attach projects to
- `client.archived` — client hidden from active pickers but preserved for historical invoices (terminal for active use)
- `project.draft` — project being created under a client
- `project.active` — project saved, tasks and timers can attach
- `project.archived` — project hidden (terminal for active use)
- `task.draft` — task being created under a project
- `task.active` — task saved, timers can attach
- `task.archived` — task hidden (terminal for active use)

### Transitions

| From               | To                 | Trigger                                               | Actor |
| ------------------ | ------------------ | ----------------------------------------------------- | ----- |
| `—`                | `client.draft`     | User opens "new client" form                          | user  |
| `client.draft`     | `client.active`    | User saves valid client                               | user  |
| `client.draft`     | `—` (discarded)    | User cancels                                          | user  |
| `client.active`    | `client.archived`  | User archives (only if no active children)            | user  |
| `client.archived`  | `client.active`    | User unarchives                                       | user  |
| `—`                | `project.draft`    | User opens "new project" under a client               | user  |
| `project.draft`    | `project.active`   | User saves valid project                              | user  |
| `project.active`   | `project.archived` | User archives (only if no active children)            | user  |
| `project.archived` | `project.active`   | User unarchives                                       | user  |
| `—`                | `task.draft`       | User opens "new task" under a project                 | user  |
| `task.draft`       | `task.active`      | User saves valid task                                 | user  |
| `task.active`      | `task.archived`    | User archives (only if no running timer on this task) | user  |
| `task.archived`    | `task.active`      | User unarchives                                       | user  |

### Cascade rule (explicit — no auto-cascade)

Archive does **not** cascade. Attempting to archive a client that still has any `project.active` or `task.active` under it is rejected. The user must archive children first, bottom-up.

### Invalid transitions (rejected)

- Creating a `project.draft` under an archived client. Reason: `parent_archived`.
- Creating a `task.draft` under an archived project. Reason: `parent_archived`.
- Archiving a client that has any `project.active` under it. Reason: `children_not_archived`.
- Archiving a project that has any `task.active` under it. Reason: `children_not_archived`.
- Archiving a task while a timer is running against it. Reason: `task_has_running_timer`.
- Hard-deleting a client/project/task that appears on any finalized invoice. Reason: `referenced_by_invoice`.

### Terminal states

`client.archived`, `project.archived`, `task.archived` are terminal for _active use_ but remain readable for history and past invoices.

---

## 2. Time Entry (Timer) Lifecycle

Core loop of the app.

### Data model note (persisted states)

`entry.draft` and `entry.editing` are **persisted** — they exist as DB rows, not UI-only modes. Draft rows survive page reloads. Editing rows survive tab close (the last-known edit form values are stored; user resumes editing from that state).

### Segment model (Resume)

A time entry owns one or more **segments** in a child table `time_entry_segments`. Each segment has its own `startedAt` and `stoppedAt`. Total duration = sum of segment durations. Any segment can be edited individually. When an entry is `running`, exactly one of its segments has `stoppedAt = NULL`.

### States

- `entry.draft` — persisted row. Task selected, notes may be composed, no segments yet. Terminal until Start or Discard.
- `entry.running` — the entry has one open segment (`stoppedAt IS NULL`). At most one `entry.running` exists across the whole app at any time.
- `entry.stopped` — every segment is closed. Duration is fixed but editable via `entry.editing`.
- `entry.editing` — user has opened the entry (or one of its segments) for edit. Edit form state is persisted. A new segment cannot be opened while in `editing`.
- `entry.locked` — entry has been included on a finalized invoice; no further edits allowed. Terminal.
- `entry.discarded` — entry deleted before invoicing, OR entry belonged to a voided invoice. Terminal.

### Transitions

| From            | To                | Trigger                                                    | Actor  |
| --------------- | ----------------- | ---------------------------------------------------------- | ------ |
| `—`             | `entry.draft`     | User picks a task                                          | user   |
| `entry.draft`   | `entry.running`   | User clicks Start (opens first segment)                    | user   |
| `entry.draft`   | `entry.discarded` | User discards draft                                        | user   |
| `entry.running` | `entry.stopped`   | User clicks Stop (closes open segment)                     | user   |
| `entry.stopped` | `entry.editing`   | User opens edit form                                       | user   |
| `entry.editing` | `entry.stopped`   | User saves valid edits                                     | user   |
| `entry.editing` | `entry.stopped`   | User cancels edits                                         | user   |
| `entry.stopped` | `entry.running`   | User clicks Resume (opens a new segment on the same entry) | user   |
| `entry.stopped` | `entry.discarded` | User deletes entry                                         | user   |
| `entry.stopped` | `entry.locked`    | Parent invoice is finalized                                | system |
| `entry.locked`  | `entry.discarded` | Parent invoice is voided                                   | system |

There is **no midnight auto-stop**. A running timer may span multiple days; segments encode continuous time. Calendar views split rendering by day but the underlying entry/segment is not split.

### Invalid transitions (rejected)

- Starting a timer (from `entry.draft` or Resume) while any `entry.running` exists. Reason: `concurrent_timer_forbidden`.
- Editing an `entry.locked` entry (or its segments). Reason: `entry_locked_by_invoice`.
- Saving a segment where `stoppedAt < startedAt`. Reason: `invalid_time_range`.
- Saving a segment that overlaps another segment of the same entry. Reason: `segment_overlap`.
- Starting a timer against an archived task. Reason: `task_archived`.
- Discarding an entry already on a finalized invoice. Reason: `entry_locked_by_invoice`.
- Opening `entry.editing` on an entry that is currently `entry.running`. Reason: `cannot_edit_running_entry` (stop it first).

### Terminal states

`entry.locked`, `entry.discarded`.

---

## 3. Invoice Lifecycle

### States

- `invoice.draft` — generated from unbilled entries within a date range, editable
- `invoice.finalized` — locked, line items and totals frozen; source entries transition to `entry.locked`
- `invoice.exported` — a PDF has been rendered and saved from a finalized invoice (non-exclusive; invoice stays finalized)
- `invoice.voided` — finalized invoice reversed; source entries transition to `entry.discarded` (terminal)

### Scope

An invoice covers **one client + one date range** (inclusive `[startDate, endDate]`, day-precision in system local timezone). Line items are grouped by task; hours per line = sum of that task's stopped-entry segments whose `startedAt` falls within the range. Rate per line = the parent project's rate at the moment of invoice generation (frozen into the line item; later project-rate changes do not affect existing drafts or finalized invoices).

### Transitions

| From                | To                  | Trigger                                                                                         | Actor |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------- | ----- |
| `—`                 | `invoice.draft`     | User clicks "Generate invoice" with client + date range that yields at least one unbilled entry | user  |
| `invoice.draft`     | `invoice.draft`     | User edits line items, adds discount line, adjusts client details, changes payment terms        | user  |
| `invoice.draft`     | `invoice.finalized` | User clicks Finalize                                                                            | user  |
| `invoice.finalized` | `invoice.exported`  | User clicks Export PDF                                                                          | user  |
| `invoice.exported`  | `invoice.exported`  | User re-exports PDF (overwrites file on disk, re-downloads)                                     | user  |
| `invoice.finalized` | `invoice.voided`    | User voids invoice                                                                              | user  |
| `invoice.exported`  | `invoice.voided`    | User voids invoice                                                                              | user  |
| `invoice.draft`     | `—` (discarded)     | User deletes draft                                                                              | user  |

### Invalid transitions (rejected)

- Generating an invoice for a (client, date range) with no unbilled `entry.stopped` records. Reason: `no_billable_entries`.
- Editing an `invoice.finalized` or `invoice.exported` invoice. Reason: `invoice_locked`.
- Finalizing a draft where the sum of line items is `<= 0`. Reason: `invoice_non_positive_total`.
- Finalizing a draft with more than one discount line, or a discount line that isn't negative. Reason: `invalid_discount_line`.
- Exporting an `invoice.draft`. Reason: `must_finalize_before_export`.
- Voiding an `invoice.draft` (drafts are deleted, not voided). Reason: `void_requires_finalized`.

### Terminal states

`invoice.voided`.

---

## Mermaid Diagram

```mermaid
stateDiagram-v2
    direction LR

    state "Time Entry" as TE {
        [*] --> entry_draft: pick task
        entry_draft --> entry_running: Start
        entry_draft --> entry_discarded: Discard
        entry_running --> entry_stopped: Stop
        entry_stopped --> entry_editing: Edit
        entry_editing --> entry_stopped: Save / Cancel
        entry_stopped --> entry_running: Resume (new segment)
        entry_stopped --> entry_discarded: Delete
        entry_stopped --> entry_locked: invoice finalized
        entry_locked --> entry_discarded: invoice voided
        entry_locked --> [*]
        entry_discarded --> [*]
    }

    state "Invoice" as INV {
        [*] --> invoice_draft: generate
        invoice_draft --> invoice_draft: edit
        invoice_draft --> invoice_finalized: Finalize
        invoice_finalized --> invoice_exported: Export PDF
        invoice_exported --> invoice_exported: Re-export
        invoice_finalized --> invoice_voided: Void
        invoice_exported --> invoice_voided: Void
        invoice_voided --> [*]
    }

    invoice_finalized -.locks.-> entry_locked
    invoice_voided -.discards.-> entry_discarded
```

---

## Structured Transition Log

**Every** transition — accepted or rejected — emits one JSON-lines entry in `logs/transitions.jsonl`. Keys are **camelCase** (see [[conventions]]).

### Schema

```json
{
	"timestamp": "2026-07-11T14:32:07.412Z",
	"correlationId": "01HXZ8K3M9Q2R7VYABCDEF1234",
	"entityType": "timeEntry | invoice | client | project | task | segment",
	"entityId": "01HXZ8...ULID",
	"previousState": "entry.running",
	"newState": "entry.stopped",
	"trigger": "user.stopTimer",
	"actor": {
		"type": "user | system",
		"id": "user_teej | system.invoiceFinalize | system.invoiceVoid"
	},
	"accepted": true,
	"rejectionReason": null
}
```

### Field rules

- **timestamp** — ISO 8601 UTC, millisecond precision.
- **correlationId** — ULID minted by the SvelteKit `handle` hook for every **state-changing** request; passed through `event.locals` and threaded as an explicit argument through the state-machine and DB call chain. Reads (GETs) do not have correlation IDs; internal system triggers (invoice finalize cascading to entry locks) mint one at the top of the cascade and reuse it for every child transition.
- **entityId** — ULID for every entity (no prefixing).
- **previousState** — `null` for creation events (`— → entry.draft`).
- **newState** — the intended target. On rejection, this is the _attempted_ target and `accepted: false`.
- **trigger** — namespaced camelCase verb: `user.<action>`, `system.<action>`.
- **actor.type** — `user` for interactive input, `system` for cascade rules (invoice-finalize locks, invoice-void discards).
- **accepted** — `true` if applied; `false` if rejected.
- **rejectionReason** — required when `accepted: false`. Must be one of:
  `parent_archived`, `children_not_archived`, `task_has_running_timer`, `referenced_by_invoice`,
  `concurrent_timer_forbidden`, `entry_locked_by_invoice`, `invalid_time_range`, `segment_overlap`, `task_archived`, `cannot_edit_running_entry`,
  `no_billable_entries`, `invoice_locked`, `invoice_non_positive_total`, `invalid_discount_line`, `must_finalize_before_export`, `void_requires_finalized`.

### Example — accepted

```json
{
	"timestamp": "2026-07-11T14:32:07.412Z",
	"correlationId": "01HXZ8K3M9Q2R7VYABCDEF1234",
	"entityType": "timeEntry",
	"entityId": "01HXZ8K3M9Q2R7VYABCDEF9999",
	"previousState": "entry.running",
	"newState": "entry.stopped",
	"trigger": "user.stopTimer",
	"actor": { "type": "user", "id": "user_teej" },
	"accepted": true,
	"rejectionReason": null
}
```

### Example — rejected

```json
{
	"timestamp": "2026-07-11T09:15:44.001Z",
	"correlationId": "01HXZ7A1B2C3D4E5F6G7H8J9K0",
	"entityType": "timeEntry",
	"entityId": "01HXZ7A1B2C3D4E5F6G7H8AAAA",
	"previousState": "entry.draft",
	"newState": "entry.running",
	"trigger": "user.startTimer",
	"actor": { "type": "user", "id": "user_teej" },
	"accepted": false,
	"rejectionReason": "concurrent_timer_forbidden"
}
```

### Example — system cascade (finalize)

When invoice `INV-A` is finalized covering 3 entries, four log lines are written with the same `correlationId`:

1. `invoice.draft → invoice.finalized` (actor: user)
2. `entry.stopped → entry.locked` for entry 1 (actor: system)
3. `entry.stopped → entry.locked` for entry 2 (actor: system)
4. `entry.stopped → entry.locked` for entry 3 (actor: system)

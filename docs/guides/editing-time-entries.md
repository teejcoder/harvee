# Editing Time Entries

Every time entry is made of one or more **segments** — each a `startedAt`/`stoppedAt`
pair. Total duration is the sum of its segments. This guide covers running the timer
and then correcting an entry after the fact. The lifecycle rules are in
`.memory/state-transitions.md` §2.

## Running the timer

The timer widget (`/timer`) is the core loop:

1. **Pick a task.** This creates a persisted `entry.draft` — it survives a page
   reload, so a half-set-up entry isn't lost.
2. **Start.** Opens the first segment; the entry becomes `entry.running` and elapsed
   time ticks live. Only **one** entry can run at a time across the whole app —
   starting a second is refused with `concurrent_timer_forbidden`.
3. **Stop.** Closes the open segment; the entry becomes `entry.stopped` with a fixed
   (but still editable) duration.

You can't start a timer against an **archived** task (`task_archived`). There's no
midnight auto-stop — a segment may span days.

## Notes

Notes are editable while an entry is `draft`, `running`, or `stopped`, from the entry
detail page (`/entries/[id]`). They are **not** editable once the entry is `locked`
by a finalized invoice (`entry_locked_by_invoice`).

## Correcting a stopped entry (the segment editor)

Open the entry at **`/entries/[id]`** and choose **Edit**. This moves it to
`entry.editing` — a **persisted** state, so your in-progress edits survive closing the
tab (the form snapshot is stored on the row). From here you can:

- **Adjust a segment** — change its start or stop time.
- **Add a segment** — e.g. you forgot to run the timer for a block of work.
- **Delete a segment.**

Two rules are enforced on save:

- A segment's stop must be at or after its start, or it's rejected with
  `invalid_time_range`.
- Segments of the same entry may **not overlap** — an overlap is rejected with
  `segment_overlap`.

**Save** applies the edits and returns to `entry.stopped`. **Cancel** discards them
and also returns to `entry.stopped` — restored from the snapshot.

> You can't edit an entry while it's **running** — stop it first
> (`cannot_edit_running_entry`).

## Resume

From a stopped entry, **Resume** opens a _new_ segment on the _same_ entry and returns
it to `entry.running`. This is how you continue work you'd stopped: the entry ends up
with multiple segments and a total equal to their sum — no need to create a second
entry for the same task.

## Discard

**Discard** on a stopped entry moves it to `entry.discarded` (terminal) — use it to
throw away an entry you won't bill. An entry already on a finalized invoice can't be
discarded directly (`entry_locked_by_invoice`); void the invoice instead, which
discards its entries for you.

## How this connects to billing

Because invoices compute hours from exact segment math, the segment editor **is** your
rounding and correction tool. Adjust segments to the times you actually want to bill,
then generate the invoice — see [Generating an invoice](/guides/generating-an-invoice).

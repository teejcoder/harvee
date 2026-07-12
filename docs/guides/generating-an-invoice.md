# Generating an Invoice

This walks the full billing flow: from stopped time entries to a downloaded PDF.
The rules behind each step are in `.memory/domain-model.md` §5–8 and
`.memory/state-transitions.md` §3.

## Before you start

You need, for the client you want to bill:

- Correct **sender details and currency** at `/settings` (they're snapshotted onto
  the invoice — set them first).
- At least one **stopped time entry** whose segment falls in the date range you'll
  invoice, not already on another invoice. If there are none, generation is refused
  with `no_billable_entries`.

## 1. Generate the draft

Open the client at **`/clients/[id]`** and use the **Generate invoice** form. Enter
an inclusive start and end date (`YYYY-MM-DD`) and submit. The app:

- gathers every eligible `entry.stopped` for that client whose segment `startedAt`
  (in local time) falls in `[startDate, endDate]` and isn't already invoiced,
- groups them **by task** into one line each — `hours` = summed segment duration,
  `rate` = the project's current rate **snapshotted** onto the line,
- snapshots currency/locale/terms from settings,
- creates an `invoice.draft` and redirects you to **`/invoices/[id]`**.

Entries whose time spans in or out of the range are included **whole** — segments are
never split.

## 2. Review and edit the draft

On the draft page you can:

- **Edit task lines** — description, hours, and rate. `amount` always recomputes as
  `hours × rate`. Each task line must stay positive.
- **Add one discount line** — enter a positive amount in the "Discount line" box; it
  is stored as a negative value and subtracted from the subtotal. There can be **at
  most one** discount line, and it must be negative — a second one, or a non-negative
  one, is rejected with `invalid_discount_line`.
- **Adjust payment terms** (via the terms field) before finalizing.

The totals update as: `subtotal` (sum of task lines) + `discount_total` = `total`.

> Rounding hours? There's no auto-rounding. If you want to bill round numbers, edit
> the underlying **time entry segments** (see [Editing time entries](/guides/editing-time-entries)),
> then regenerate. The invoice always reflects exact segment math.

## 3. Finalize

Click **Finalize**. This is the point of no return for edits:

- the invoice gets its **number** — `YYYYMMDD-N`, where the date is today (local) and
  `N` is that day's counter starting at 1,
- state moves `invoice.draft → invoice.finalized`,
- every source entry cascades `entry.stopped → entry.locked` under one
  `correlationId`, so they can't be edited or double-billed.

Finalize is refused if `total <= 0` (`invoice_non_positive_total`) or if any task
line is non-positive.

## 4. Export the PDF

Click **Export PDF**. The app renders the invoice with `pdf-lib`, writes it to
`./invoices/<invoiceNumber>.pdf`, and streams the same bytes back to your browser as
a download. State moves `invoice.finalized → invoice.exported`. Re-exporting
overwrites the file and downloads again.

The PDF shows the sender block, the client, each line item with hours/rate/amount,
the subtotal, any discount, the total, the invoice number, and the **due date**
(finalized date + payment terms) — all formatted in the invoice's snapshotted
currency and locale.

## If you need to reverse it

Finalized or exported invoices can be **Voided**. Voiding cascades every locked entry
back to `entry.discarded` (they leave the billable pool) under one `correlationId`.
The invoice number stays with the voided record — it is not reused. Drafts can't be
voided (`void_requires_finalized`); delete the draft instead.

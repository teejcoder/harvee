# Architecture Overview

The shipped shape of harvest-clone: a single-user, local time-tracking and
invoicing tool. One user, one machine, one SQLite file. No auth, no multi-tenancy,
no cloud sync — see `.memory/overview.md` for what the product deliberately is
_not_.

## The stack in one line

SvelteKit 2 + Svelte 5 (runes) + TypeScript (strict) + SQLite (plain SQL via
`better-sqlite3`) + Tailwind v4 + `pdf-lib`. ULIDs for every ID. One JSONL log.
VitePress for these docs.

## Request lifecycle

```
Browser ──▶ hooks.server.ts ──▶ +page.server.ts (load / actions)
                │                        │
       mints correlationId        calls query modules
       for every non-GET          and state machines
                │                        │
     event.locals.correlationId          ▼
                              SQLite (./data.sqlite)
                                         │
                                         ▼
                            logs/transitions.jsonl
```

- **`src/hooks.server.ts`** mints a ULID `correlationId` for every non-GET request,
  stashes it on `event.locals`, and echoes it back as the `X-Correlation-Id`
  response header. GET (read) requests get none — reads are not state changes.
- **Routes** (`src/routes/**`) are thin. `load` functions read; form `actions` and
  the one `+server.ts` endpoint write. They pull `correlationId` off `locals` and
  thread it down into the state machines. They translate `StateTransitionError`
  into `fail(400, { rejectionReason })`; anything else is a 500.

## The four layers under the routes

| Layer              | Location                    | Responsibility                                                                                  |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------------------------- |
| **State machines** | `src/lib/state/*.ts`        | The only place entities change state. Pure preconditions + a DB write + a transition-log line.  |
| **Query modules**  | `src/lib/db/queries/*`      | Typed SQL. Writes take `correlationId`; reads don't. snake_case ⇄ camelCase mapping lives here. |
| **DB connection**  | `src/lib/db/index.ts`       | Opens `./data.sqlite`, runs `db/migrations/*.sql` at startup, caches prepared statements.       |
| **Cross-cutting**  | `src/lib/{ids,time,log}.ts` | ULID minting, all timezone/day-boundary math, and the structured logger.                        |

State machines are the heart. A route never writes an entity's state column
directly — it calls `finalizeInvoice(...)`, `startTimer(...)`, `archiveClient(...)`,
etc. Each of those runs its guard clauses, applies the write, and emits exactly one
transition-log line (accepted or rejected). See
[State machines](/architecture/state-machines).

## Data layer

- **`./data.sqlite`** — one file, `foreign_keys = ON`. Schema is built by the
  ordered migrations in `db/migrations/` (applied at startup, tracked in a
  `_migrations` table, skipped if already applied). See
  [Data model](/architecture/data-model).
- **Money** is always integer minor units (cents). Formatting happens only at
  render time via `Intl.NumberFormat`.
- **Time** is stored UTC ISO 8601; day/week/month boundaries are computed in the
  system-local timezone, all in `src/lib/time.ts`.

## Observability

The transition log at `logs/transitions.jsonl` is the primary debugging surface,
not an afterthought. Every state change writes one camelCase JSON line
(`previousState`, `newState`, `trigger`, `actor`, `accepted`, `rejectionReason`,
`correlationId`). A user action and every system cascade it triggers (e.g. finalize
locking N entries) share one `correlationId`, so an entire flow is greppable by that
single value. The full schema and rules live in `.memory/state-transitions.md` and
`.memory/conventions.md` §5–6.

## Routes at a glance

| Route                          | Purpose                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `/settings`                    | Edit the singleton sender/currency/terms record              |
| `/clients`, `/clients/[id]`    | Client list; projects + "Generate invoice" for one client    |
| `/projects/[id]`               | Tasks under a project                                        |
| `/timer`                       | The persistent timer widget (pick task, start, stop, resume) |
| `/entries/[id]`                | Entry detail + segment editor                                |
| `/calendar/day\|week\|month/…` | Historical views by local day / week / month                 |
| `/invoices/[id]`               | Draft editing, finalize, void, delete                        |
| `/invoices/[id]/export` (POST) | Render + stream the PDF, write `invoices/<number>.pdf`       |

## Deployment note

The production adapter is `@sveltejs/adapter-vercel`, but the local filesystem
dependencies (`./data.sqlite`, `logs/`, `invoices/`) mean a real Vercel deploy needs
a persistence rethink first — tracked as an open decision. For now the app runs
locally with `pnpm dev`. See [Running locally](/guides/running-locally).

# Running Locally

harvest-clone is a single-user local app. There is nothing to deploy and no account
to create — you run it on your own machine against a SQLite file.

## Prerequisites

- **Node 22** (the app targets the Node 22 LTS line).
- **pnpm** (the repo's package manager; `corepack enable` will provide it).

## First run

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts SvelteKit on **http://localhost:5173**. On startup it applies any
pending migrations in `db/migrations/` against `./data.sqlite`, creating that file on
the very first run. No separate migrate command — booting is enough.

Open http://localhost:5173, then head to **`/settings`** first and replace the seeded
placeholder sender details (name, address, email, currency, default payment terms,
locale). Those values are snapshotted onto every invoice you generate, so set them
before you bill anything.

## What lives where at runtime

| Path                       | What it is                                            |
| -------------------------- | ----------------------------------------------------- |
| `./data.sqlite`            | Your entire database. Delete it to start fresh.       |
| `./logs/transitions.jsonl` | The append-only structured log of every state change. |
| `./invoices/<number>.pdf`  | Exported invoice PDFs.                                |

All three are gitignored. Deleting `data.sqlite` and restarting gives you a clean
app (the next boot recreates it and re-seeds the settings row).

## The other commands

```bash
pnpm docs:dev   # these docs (VitePress) on http://localhost:5174
pnpm test       # the full Vitest suite (run mode)
pnpm check      # svelte-check — type + a11y checks, must be 0 errors
pnpm lint       # prettier --check + eslint
pnpm format     # prettier --write
pnpm build      # production build
```

## Watching what the app does

Because every state change is logged, the fastest way to understand a bug is to tail
the log while you click:

```bash
tail -f logs/transitions.jsonl
```

Each line is one JSON event. To follow a single user action and everything it
cascaded, grep by its `correlationId`. To find what got rejected, filter for
`"accepted":false` and read the `rejectionReason`. See
[State machines](/architecture/state-machines) for the vocabulary.

## Resetting

There is no migration-down. To reset: stop the dev server, delete `data.sqlite`
(and optionally `logs/transitions.jsonl` and `invoices/`), and run `pnpm dev` again.

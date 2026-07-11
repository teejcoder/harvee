# harvest-clone

A single-user time tracking and invoicing tool. Track billable hours against clients, projects, and tasks, then generate a PDF invoice.

For the full product description, see [`.memory/overview.md`](.memory/overview.md).

---

## Map

| You want... | Go to |
|---|---|
| Product description — what this is and isn't | [`.memory/overview.md`](.memory/overview.md) |
| State machines, transition logging schema, Mermaid diagram | [`.memory/state-transitions.md`](.memory/state-transitions.md) |
| Business rules — rates, currency, invoice #, terms, line items | [`.memory/domain-model.md`](.memory/domain-model.md) |
| Cross-cutting rules — IDs, casing, correlation IDs, SQL, tests | [`.memory/conventions.md`](.memory/conventions.md) |
| Tech stack decisions, pinned versions, and repo layout | [`.memory/tech-stack.md`](.memory/tech-stack.md) |
| Build order and validation gates | [`.memory/implementation-plan.md`](.memory/implementation-plan.md) |
| Internal documentation site (architecture, guides, ADRs) | [`docs/`](docs/) |
| Changelog | [`docs/changelog.md`](docs/changelog.md) |
| Rules for AI assistants working in this repo | [`CLAUDE.md`](CLAUDE.md) |

---

## Quickstart

```bash
pnpm install
pnpm dev              # SvelteKit app on http://localhost:5173 (runs migrations on startup)
pnpm docs:dev         # VitePress docs on http://localhost:5174
pnpm test             # Vitest
```

Data lives in `./data.sqlite` (hardcoded). Migrations in `db/migrations/*.sql` are applied automatically on app startup. All logs — general and state transitions — append to `logs/transitions.jsonl`. Exported invoice PDFs are written to `./invoices/<invoiceNumber>.pdf`.

---

## Repo shape

```
.memory/     agent memory — source of truth for product intent, state model, stack
docs/        VitePress site — internal documentation + changelog
db/          migrations/ and hand-written queries/
src/         SvelteKit app (routes, lib, state machines, PDF renderer)
logs/        JSONL transition log
```

For anything more specific than that, follow the map above.

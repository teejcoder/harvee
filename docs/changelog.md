# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project does not yet follow semantic versioning.

## [Unreleased]

### Added

- Initial repo skeleton: SvelteKit 2 + Svelte 5 (runes) + TypeScript strict + Tailwind v4 on Node 22, with Prettier, ESLint, and Vitest configured.
- Vitest test workspaces: `unit` (Node) and `component` (jsdom, `@testing-library/svelte`). Test root at `tests/{unit,component,e2e}/`.
- Playwright end-to-end test harness (`playwright.config.ts`), booting against `pnpm preview`.
- `@sveltejs/adapter-vercel` as the production adapter (deploy target: Vercel).
- VitePress documentation site at `docs/`, with mermaid support (`vitepress-plugin-mermaid`). Nav sections: Architecture, Guides, Decisions, Changelog. Stub pages under each section point at `.memory/` for the current source of truth. Scripts: `docs:dev`, `docs:build`, `docs:preview` (port 5174).
- ULID module at `src/lib/ids.ts` — thin `monotonicFactory()` wrapper around the `ulid` package; single source of ULIDs for every entity ID and every correlation ID. Covered by two Vitest tests (regex format + 10k ascending/unique).
- Pure-utility logging exemption in `.memory/conventions.md` §6 and `CLAUDE.md` §4.2.1: modules with no I/O, no side effects, and no branch decisions are exempt from the "every function logs" rule. Currently covers `src/lib/{ids,time,money}.ts`.
- Time module at `src/lib/time.ts` — `nowUtcIso`, `localDateOf`, `localDayBounds`, `localWeekBounds` (Monday-anchored), `localMonthBounds`. All timezone math lives here; day/week/month boundaries return half-open UTC ISO intervals. Optional `tz` argument on every function (defaults to system local). Covered by 11 Vitest cases spanning DST forward (23h day), DST back (25h day), and non-DST (24h day) zones.
- Structured logger at `src/lib/log.ts` — `log.debug/info/warn/error({...})` and `logTransition({...})`. camelCase JSON lines, appended to `logs/transitions.jsonl`. Exports `REJECTION_REASONS` (canonical list) and a discriminated `TransitionEntry` union so accepted/rejected mismatches are compile-time errors. `LOG_PATH` env var overrides the default file location for tests. Covered by 5 Vitest cases.
- Correlation-ID hook at `src/hooks.server.ts` — every non-GET / non-HEAD request mints a ULID, stores it on `event.locals.correlationId`, and attaches it to the response as `X-Correlation-Id`. Read paths (GET, HEAD) get no correlation ID per `.memory/conventions.md` §5. `App.Locals.correlationId` typed in `src/app.d.ts`. Covered by 6 Vitest cases (POST/PUT/PATCH/DELETE mint + attach, GET/HEAD skip, uniqueness across calls).
- SQLite connection + migration runner at `src/lib/db/index.ts`. `openDb(path?, migrationsDir?)` opens a database and applies every `.sql` file in `db/migrations/` in ascending filename order inside a transaction, tracked in a `_migrations` table. Already-applied files log `db.migrate.skip` and are no-ops. `getDb()` returns the memoized production connection (`./data.sqlite`). Missing migrations directory logs a warn but does not fail. WAL + foreign-keys pragmas enabled at open. Warmed at server boot by `src/hooks.server.ts` so migrations run before the first request. Covered by 5 Vitest cases including a transaction-rollback assertion. Runtime dep: `better-sqlite3`.
- First migration `db/migrations/001_settings.sql` — creates the singleton `settings` table (`INTEGER PRIMARY KEY CHECK (id = 1)`) with sender identity, currency, default payment terms, and invoice locale per `.memory/domain-model.md` §4. Seeds one row with placeholder values so `/settings` has something to render on first boot. Covered by 4 Vitest cases (CHECK constraint, placeholder shape, second-row rejection, second-boot idempotency).
- Second migration `db/migrations/002_clients_projects_tasks.sql` — three ULID-keyed tables per `.memory/domain-model.md` §10. `clients (id, name, archived_at?, timestamps)`. `projects (id, client_id → clients.id, name, hourly_rate INTEGER minor units, archived_at?, timestamps)` with index on `client_id`. `tasks (id, project_id → projects.id, name, archived_at?, timestamps)` with index on `project_id`. FKs default to NO ACTION (behaves like RESTRICT), matching the "block delete if children" rule. Covered by 7 Vitest cases (per-table column shape, FK metadata, orphan-insert rejection, delete-with-children rejection, indexes, second-boot ordering).
- Logger self-exemption in `.memory/conventions.md` §6: `src/lib/log.ts` has I/O but cannot log its own entry without infinite recursion.

### Fixed

- `CLAUDE.md` §4.4 was inconsistent with `.memory/conventions.md` §5 on correlation IDs (said "always"; conventions says "state-changing chains only"). Corrected `CLAUDE.md` to align with the earlier decision.

### Changed

- Tech stack: pinned TypeScript to latest 6.x, added Playwright + component testing surfaces, swapped `adapter-auto` for `adapter-vercel`.

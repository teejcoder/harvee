# Conventions

Cross-cutting rules that every file in the codebase must follow. If you find code that violates a rule here, fix the code — do not change the rule without discussion.

Read alongside [[tech-stack]] (versions), [[state-transitions]] (transition log schema), [[domain-model]] (business rules), and `CLAUDE.md` (behavior for AI assistants).

---

## 1. Identifiers

- **Every entity uses a ULID** for its primary key: `clients`, `projects`, `tasks`, `time_entries`, `time_entry_segments`, `invoices`, `invoice_line_items`.
- ULIDs are stored as the 26-character canonical string (`01HXZ8K3M9Q2R7VYABCDEF1234`), not binary. SQLite column type is `TEXT PRIMARY KEY`.
- **No prefixing** (`c_...`, `p_...`). ULID alone.
- Generated via a single `src/lib/ids.ts` module. No inline ULID generation elsewhere in the codebase.
- The `settings` table's PK is the literal integer `1` (`CHECK (id = 1)`), not a ULID — it's a singleton.

## 2. Case conventions

| Surface                                              | Case                                                                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL table + column names                             | `snake_case`                                                                                                                                      |
| TypeScript identifiers                               | `camelCase`                                                                                                                                       |
| TypeScript types + Svelte components                 | `PascalCase`                                                                                                                                      |
| Log JSON keys (both general logs and transition log) | **`camelCase`**                                                                                                                                   |
| State names and rejection reasons in logs            | `snake_case` (e.g. `entry.running`, `concurrent_timer_forbidden`) — these are enum values, not identifiers                                        |
| Route paths                                          | `kebab-case`                                                                                                                                      |
| Filenames                                            | `kebab-case.ts` for lib modules; `camelCase.ts` allowed for Svelte-store-like modules; `+page.svelte` / `+server.ts` follow SvelteKit conventions |

The row → object translation between SQL and TS happens in `db/queries/*` — each query function converts `snake_case` columns to `camelCase` object fields. No ORM does this automatically.

## 3. Money

- All monetary values in the DB are **integer minor units** (cents for USD, etc.). Never floats.
- Multiplication of `hours * rate` where `hours` is a decimal: compute `Math.round(hours * rate)` to get the integer amount. Done in one helper: `src/lib/money.ts#lineItemAmount(hours, rate)`.
- Formatting for display uses `Intl.NumberFormat(settings.invoiceLocale, { style: "currency", currency: settings.currencyCode, minimumFractionDigits: settings.currencyDecimals, maximumFractionDigits: settings.currencyDecimals })`.
- Never format money by hand.

## 4. Time

- Store timestamps as UTC ISO 8601 strings with millisecond precision (`2026-07-11T14:32:07.412Z`).
- Compute day/week/month boundaries in the **system local timezone** — see [[domain-model]] Timezone.
- One helper module: `src/lib/time.ts`. It exports `nowUtcIso()`, `localDayBounds(date)`, `localWeekBounds(date)`, `localMonthBounds(yyyyMm)`, `localDateOf(utcIso)`. All timezone math is here.
- No `Date.now()` sprinkled through business logic. Everything routes through `nowUtcIso()` so tests can mock the clock.

## 5. Correlation IDs

- One ULID per **state-changing HTTP request**, minted at the top of `src/hooks.server.ts`:
  ```
  handle: only for POST / form actions / any request whose method is not GET or HEAD.
    → event.locals.correlationId = ulid()
    → attach to response header X-Correlation-Id
  ```
- GET requests do **not** have a correlation ID. `event.locals.correlationId` is `undefined` and no logging call requires one on read paths.
- Every function whose call chain participates in a state change accepts `correlationId: string` as an **explicit argument**. Do not read it from module-level context or a global. If you can't produce a correlation ID at a call site, that call site does not belong in a state-changing path.
- System-triggered cascades (invoice finalize → entry locks; invoice void → entry discards) mint their own correlation ID at the top of the cascade and reuse it for every child transition, so a single logical operation groups by one ID.

## 6. Logging (canonical rules)

Full ruleset lives in `CLAUDE.md` §4. This section is the machine-readable summary:

- Single logger module: `src/lib/log.ts`.
- Levels: `debug`, `info`, `warn`, `error`.
- Every function has at least a `debug` entry log with its inputs (redacted where sensitive) — **with the pure-utility exemption below.**

**Pure-utility exemption.** Modules that satisfy all three of (a) no I/O, (b) no side effects, and (c) no branch decision worth tracing are exempt from the "every function logs" rule. Currently exempt: `src/lib/ids.ts` (ULID mint), `src/lib/time.ts` (timezone math), `src/lib/money.ts` (amount computation). Callers of these utilities log around the call site with the utility's return value — that's where the interesting context lives. If a new module qualifies, add it to this list; if a listed module grows I/O or branching, remove it from the list and add logging.

**Logger self-exemption.** `src/lib/log.ts` has file I/O but cannot log its own entry/exit without infinite recursion. Its exported functions (`log.debug/info/warn/error`, `logTransition`) do not emit meta-log lines. Errors thrown by `fs.appendFileSync` (permissions, disk full) propagate to the caller unmodified — loud failure is preferable to silently losing observability.

- State-changing operations log at `info` with `before` and `after` objects.
- Error paths log at `error` with `{ error: { message, stack, code? }, ...context }` and re-throw. Never swallow.
- Log lines are JSON objects appended one-per-line to `logs/transitions.jsonl`. Keys are camelCase. `event` is a required namespaced verb (`entry.start`, `db.query`, `invoice.finalize.failed`).
- State-machine `apply()` and `reject()` also emit one **transition-log** line per invocation using the schema in [[state-transitions]]. Transition lines and general log lines share the same file; they are distinguishable by presence of the field `previousState` (transition lines have it; general lines do not).

## 7. SQL

- Plain SQL in `db/queries/*.ts`. Each file exports one function per query.
- Every query function signature: `(db: Database, args: {...}, correlationId?: string) => TypedResult`.
- Correlation ID is `undefined` on read queries and required on write queries (enforce with a runtime check that logs an `error` if a write is attempted without one).
- Prepared statements are cached at module scope. Do not build SQL strings via concatenation with user input — always parameterize.
- Migrations are additive when possible. Destructive migrations (drop column, drop table) require an ADR.

## 8. Route conventions

- SvelteKit file-based routes.
- Mutations use **form actions** (`+page.server.ts` `actions`), not fetch to custom endpoints. This gives us progressive-enhancement and puts the correlation-ID hook in the natural place.
- Read data via `+page.server.ts` `load` functions. No client-side data fetching except for the live timer's elapsed-time display.

## 9. Svelte 5

- Use runes (`$state`, `$derived`, `$effect`). Do not use Svelte 4 stores (`writable`, `readable`) for new code.
- Shared reactive state lives in `.svelte.ts` files inside `src/lib/` (e.g. `src/lib/timer.svelte.ts` for the running-timer widget's client state).

## 10. Tailwind v4

- CSS-first config in `src/app.css` using `@theme`. No `tailwind.config.js`.
- Use utility classes on markup. Do not create component classes with `@apply` unless the same combination appears three or more times.

## 11. Testing

- Vitest, files under `tests/` mirroring `src/`.
- Test files end in `.test.ts`.
- Every state machine (`src/lib/state/*`) has a table-driven test covering every transition (accepted and rejected) listed in [[state-transitions]]. The test asserts the resulting transition-log entry matches the schema.
- The clock is mocked via `vi.setSystemTime()` — no real-time-dependent tests.
- **Never touch `./data.sqlite` from a test.** Vitest sets `process.env.VITEST`; boot-time side effects (like `hooks.server.ts` calling `getDb()`) must be guarded with `if (!process.env.VITEST)`. Tests that need a database open one with `openDb(tmpPath, tmpMigrationsDir)` into a `mkdtempSync` directory.

## 12. File and folder hygiene

- Gitignore: `data.sqlite`, `logs/`, `invoices/`, `node_modules/`, `.svelte-kit/`, `dist/`.
- Never commit `.env` files. There are no secrets in this app (single-user, local), but if one is introduced later it goes in `.env.local` and gets an ADR.

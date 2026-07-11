# Tech Stack

## Guiding principles

- **One user, one machine.** Personal tool for a single contract developer. No multi-tenancy, no auth, no cloud sync. Every "scale" concern (queues, caches, background workers, ORMs, microservices) is out of scope.
- **Boring wins.** Well-worn tools with small surface area over anything trendy.
- **File-based when possible.** Routing, config, and data should live as files you can open and read.
- **You should be able to delete any dependency and understand what breaks.** If a library is doing something you couldn't reproduce in ~50 lines, question whether you need it.

Primary language: **TypeScript** → docs site is **VitePress**.

---

## Pinned versions

| Tool                       | Version                                                             | Why                                                        |
| -------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Node.js                    | **22 LTS**                                                          | Current active LTS; native fetch; better-sqlite3 supported |
| pnpm                       | latest 11.x                                                         | Package manager                                            |
| SvelteKit                  | latest 2.x                                                          | Framework                                                  |
| Svelte                     | **5** (runes syntax: `$state`, `$derived`, `$effect`)               | Component model                                            |
| TypeScript                 | latest 6.x, `strict: true`                                          | Language                                                   |
| Tailwind CSS               | **v4** (CSS-first config in `src/app.css`, no `tailwind.config.js`) | Styling                                                    |
| better-sqlite3             | latest                                                              | SQLite driver                                              |
| pdf-lib                    | latest                                                              | PDF construction                                           |
| Vitest                     | latest (unit + component workspaces)                                | Unit + Svelte component tests                              |
| Playwright                 | latest                                                              | End-to-end tests                                           |
| `@sveltejs/adapter-vercel` | latest                                                              | Production adapter — deploy target is Vercel               |
| Prettier + ESLint          | SvelteKit defaults                                                  | Formatting / lint                                          |

**No** date-fns, no dayjs, no Luxon. Native `Date` + `Intl.DateTimeFormat` in the system-local timezone (see [[domain-model]] Timezone). If timezone math becomes painful later, revisit.

---

## What is deliberately NOT in the stack

- No Docker. Runs as `pnpm dev` locally.
- No auth library. Single user, local app.
- No state management library (Redux/Zustand). Svelte 5 runes cover it.
- No component library (shadcn, Radix, MUI). Native HTML + Tailwind.
- No ORM (Prisma, Drizzle). Plain SQL in `db/queries/`.
- No Puppeteer/Playwright for PDF. `pdf-lib` handles it.
- No calendar library. Hand-rolled grid.
- No monorepo tooling. One `package.json`.
- No CI/CD pipeline until there's something to deploy.
- No error tracking service. Console + JSONL log.
- No analytics.
- No log rotation. Single-user local app; the log grows unbounded and that's fine.
- No separate app-log file. Everything writes to `logs/transitions.jsonl`.

Adding anything from this list requires an ADR in `docs/decisions/`.

---

## Data

- **SQLite** via **better-sqlite3**. One file at `./data.sqlite` (hardcoded path — no env var).
- **Migrations** are plain `.sql` files in `db/migrations/` named `NNN_description.sql`, applied in ascending filename order **on app startup**. A `_migrations` table tracks applied filenames so re-runs are no-ops. No separate `pnpm db:migrate` command.
- **No ORM.** Hand-written SQL in `db/queries/`. One file per entity. Each function is typed input → typed output.

## Logging

- Single module `src/lib/log.ts` exposing `log.debug/info/warn/error({...})`.
- Single output file: `logs/transitions.jsonl`. Both general logs and transition-log entries append here as JSON lines. Transition entries follow the schema in [[state-transitions]]; general entries follow the log conventions in [[conventions]].
- All log keys are **camelCase** (see [[conventions]]).

## PDF export

- `pdf-lib`. Rendered PDF is **written to `invoices/<invoiceNumber>.pdf`** on disk **and streamed to the browser as a download** in the same request. Re-exporting overwrites the file and re-downloads.

## Testing

- **Vitest** for unit and Svelte component tests. Two Vitest workspaces:
  - `unit` — pure TS logic (state machines, SQL query modules, helpers). Node environment. Files under `tests/unit/**` mirroring `src/`.
  - `component` — Svelte component tests using `@testing-library/svelte` + `jsdom`. Files under `tests/component/**` mirroring `src/`.
- **Playwright** for end-to-end tests exercising the timer flow, invoice generation, and PDF export. Files under `tests/e2e/**`.
- No Puppeteer for PDF (see "deliberately NOT" list). Playwright is here for E2E only.

## Deployment

- Production adapter: **`@sveltejs/adapter-vercel`**, wired inline in `vite.config.ts` (the `sveltekit()` plugin accepts an `adapter` option in SvelteKit 2 — no separate `svelte.config.js`).
- Local development remains unchanged: `pnpm dev`, SQLite file at `./data.sqlite`.
- Vercel deployment implications for later phases:
  - Serverless functions do not have a persistent local filesystem, so `./data.sqlite`, `./logs/transitions.jsonl`, and `./invoices/*.pdf` will need a rethink before we ship to Vercel (blob storage, external DB, or edge storage). Track this as an open decision in `docs/decisions/` when we get to Phase 6.
  - For now, the adapter change is purely so the build targets Vercel; runtime persistence choices are deferred.

---

## Repository layout

```
harvest-clone/
├── .memory/                    # agent memory
│   ├── overview.md
│   ├── state-transitions.md
│   ├── tech-stack.md
│   ├── domain-model.md
│   ├── conventions.md
│   └── implementation-plan.md
├── db/
│   ├── migrations/             # 001_init.sql, 002_...
│   └── queries/                # clients.ts, projects.ts, tasks.ts, entries.ts, segments.ts, invoices.ts, settings.ts
├── src/
│   ├── lib/
│   │   ├── log.ts              # structured logger + transition log emitter
│   │   ├── ids.ts              # ULID generation
│   │   ├── time.ts             # system-local day/week/month math
│   │   ├── state/              # entry.ts, invoice.ts, client.ts, project.ts, task.ts
│   │   └── pdf/                # invoice.ts (pdf-lib renderer)
│   ├── routes/                 # SvelteKit file-based routes
│   ├── hooks.server.ts         # correlation-ID minting for state-changing requests
│   └── app.css                 # Tailwind v4 CSS-first config
├── invoices/                   # exported PDFs (gitignored)
├── logs/
│   └── transitions.jsonl       # gitignored
├── docs/                       # VitePress documentation site
├── tests/                      # Vitest, mirrors src/
├── data.sqlite                 # gitignored
├── package.json
├── vite.config.ts               # SvelteKit config lives inline in the `sveltekit()` Vite plugin
├── playwright.config.ts
└── tsconfig.json
```

---

## `docs/` — VitePress documentation site

VitePress lives in `docs/`. Internal documentation only; not a public marketing site.

### Structure

```
docs/
├── .vitepress/
│   └── config.ts               # nav, sidebar, mermaid plugin
├── index.md                    # landing (VitePress `layout: home` — hero + links to the four sections)
├── architecture/
│   ├── overview.md
│   ├── state-machines.md       # renders Mermaid from [[state-transitions]]
│   └── data-model.md
├── guides/
│   ├── running-locally.md
│   ├── generating-an-invoice.md
│   └── editing-time-entries.md
├── decisions/                  # ADRs — one file per material decision
└── changelog.md                # Keep-a-Changelog format
```

- `vitepress-plugin-mermaid` enabled for inline state diagrams.
- Root `package.json` scripts: `docs:dev`, `docs:build`.

---

## Summary in one line

**SvelteKit 2 + Svelte 5 runes + TypeScript strict + SQLite (plain SQL) + Tailwind v4 + pdf-lib, ULIDs everywhere, one JSONL log, VitePress for internal docs.** Nothing else without an ADR.

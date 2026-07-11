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

### Changed

- Tech stack: pinned TypeScript to latest 6.x, added Playwright + component testing surfaces, swapped `adapter-auto` for `adapter-vercel`.

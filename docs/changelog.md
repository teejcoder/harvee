# Changelog

All notable changes to this project are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project does not yet follow semantic versioning.

## [Unreleased]

### Added

- Initial repo skeleton: SvelteKit 2 + Svelte 5 (runes) + TypeScript strict + Tailwind v4 on Node 22, with Prettier, ESLint, and Vitest configured.
- Vitest test workspaces: `unit` (Node) and `component` (jsdom, `@testing-library/svelte`). Test root at `tests/{unit,component,e2e}/`.
- Playwright end-to-end test harness (`playwright.config.ts`), booting against `pnpm preview`.
- `@sveltejs/adapter-vercel` as the production adapter (deploy target: Vercel).

### Changed

- Tech stack: pinned TypeScript to latest 6.x, added Playwright + component testing surfaces, swapped `adapter-auto` for `adapter-vercel`.

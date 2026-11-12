# ourFund

Open-source, self-hosted investment portfolio tracker for the Polish market
(GPW, retail treasury bonds, IKE / IKZE / OKI accounts, PIT-38). Next.js + PostgreSQL in Docker.
The UI language is Polish; code, comments, commits and docs for contributors are in English.

@AGENTS.md

## Commands

| Task                                               | Command                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| Start the dev database                             | `pnpm db:up` (PostgreSQL on localhost:5432)                       |
| Dev server                                         | `pnpm dev`                                                        |
| Lint / format / types                              | `pnpm lint`, `pnpm format`, `pnpm format:check`, `pnpm typecheck` |
| Unit + component + integration tests with coverage | `pnpm test` (integration needs `pnpm db:up`)                      |
| Tests without a database                           | `pnpm test:unit`                                                  |
| End-to-end tests                                   | `pnpm e2e` (builds the app, needs `pnpm db:up`)                   |
| New migration after editing `prisma/schema.prisma` | `pnpm db:migrate --name <name>`                                   |
| Whole stack as users run it                        | `docker compose up -d --build`                                    |

## Architecture

- `src/app/` — Next.js routes. Keep them thin: compose components and call services, no logic.
- `src/components/` — React components (`ui/` is vendored shadcn/ui, do not hand-edit).
- `src/domain/` — pure TypeScript without I/O: money, positions, FIFO, returns, bonds, taxes.
- `src/server/` — `db/` (Prisma client, repositories), `auth/`, `services/` (use cases),
  `providers/` (market data), `importers/` (broker files), `jobs/`.
- `src/i18n/messages/pl.json` — every user-facing string. Never hard-code UI text.
- `prisma/` — schema and SQL migrations (committed). The generated client lives in
  `src/generated/prisma` and is not committed.
- `e2e/` — Playwright tests.

## Rules

- **Money and quantities are never `number`.** Use Prisma `Decimal` / `decimal.js` in code and
  `NUMERIC` in the database.
- **Tests come with the code.** Unit tests for all logic; `*.int.test.ts` for repositories and
  services against real PostgreSQL; Playwright for user flows. CI enforces 90% coverage for
  `src/domain` and `src/server`.
- Test file names: `*.test.ts` (node), `*.test.tsx` (jsdom), `*.int.test.ts` (needs the database).
- **Never commit to `main`.** Work on a `feat/…`, `fix/…` or `chore/…` branch, open a pull request,
  merge when CI is green.
- Code must pass `pnpm format:check` (Prettier) and `pnpm lint`; a pre-commit hook formats staged files.
- The app name lives only in `src/config/app.ts`.
- Do not copy code, assets, texts or screen layouts from myFund, and never fetch data from it.
- Next.js runs with `cacheComponents: true`: request-time data must be read inside `<Suspense>`
  or after `await connection()`; read the bundled docs in `node_modules/next/dist/docs/` first.
- Prisma stays on the stable 7.x line (npm's `latest` tag currently points at an 8.0 release candidate).

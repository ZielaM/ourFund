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
| New migration after editing `prisma/schema.prisma` | `pnpm db:migrate --name <name> && pnpm db:generate`               |
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

- **Money and quantities are never `number`.** Import `Decimal` from `@/domain/decimal`
  (decimal.js with the project's precision), store `NUMERIC` in the database, and format for
  display with `src/lib/format.ts`. User input is parsed with `parseDecimalInput` ("1 234,56").
- Dates of transactions are calendar days (`"YYYY-MM-DD"`, `IsoDate`), never timestamps.
- Holdings are never stored: `computeLedger` (`src/domain/portfolio/ledger.ts`) replays an
  account's transactions (FIFO, per account). Any change to transactions must keep every
  account replayable; `src/server/portfolio/transactions.ts` checks that inside a transaction.
- A user sees only their own portfolios. Services take the acting user and filter by owner;
  every new service needs an isolation test (user B cannot read or change user A's data).
- Forms use `<ActionForm>` with the fields from `src/components/form/fields.tsx`.
- Market data (`src/server/market-data/`): prices from Yahoo Finance's chart endpoint, exchange
  rates from the NBP API, both behind `MarketDataProviders`. Tests never reach the internet:
  unit tests inject a fake `fetch`, e2e runs with `MARKET_DATA=fixture`. After changing a
  provider, run `pnpm exec tsx scripts/check-market-data.mts` against the real services.
  stooq.pl is deliberately not used: it puts a browser check in front of automated clients.
- Prices entered by hand (`source = MANUAL`) are never overwritten by a refresh.
- Valuation (`src/domain/valuation/`) is in PLN. Cost and results are converted at the rate
  of each purchase or sale: the broker's rate when the account paid in PLN, otherwise the NBP
  rate of that day. A value that needs a missing price or rate is `null`, never a guess, and
  totals carry an `incomplete` flag. Without a market price a position is valued at the price
  of its last trade and reported in `missing.marketPrices`.
- Returns (TWR, XIRR) are measured on the securities only: buying is a contribution, selling
  and dividends are withdrawals. Deposits and withdrawals of cash are ignored on purpose, so
  results do not depend on whether a user records them. Rates are plain numbers; money is not.
- Charts follow one rule set: one accent series (`--chart-value`), context in gray
  (`--chart-context`), hairline grid, a legend, a tooltip listing every series, and a table
  view of the same data.
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
  (a `loading.tsx` counts) and after a request-time API; read the bundled docs in
  `node_modules/next/dist/docs/` first. Pages are also rendered at build time without a
  database, so the first thing a page does must be `requireUser()` / `getCurrentUser()` /
  `await connection()` — before `getDb()` or `getEnv()`.
- **Authorization lives on the server.** Every page and every Server Action calls
  `requireUser()` or `requireAdmin()` (`src/server/auth/current-user.ts`) itself; `src/proxy.ts`
  is only a convenience redirect. Services that act on behalf of a user take the acting user
  as an argument and check it.
- Server Actions return `FormState` (`src/lib/form-state.ts`) with error/notice codes that the
  UI translates (`errors.*`, `notices.*` in the messages file). A page streamed behind
  `<Suspense>` answers 200 even when it renders "not found", so e2e tests assert on the UI.
- With Cache Components the previous page stays in the DOM, hidden. In Playwright use
  `getByRole`, or `field()` from `e2e/helpers/ui.ts` instead of a bare `getByLabel`.
- Prisma stays on the stable 7.x line (npm's `latest` tag currently points at an 8.0 release candidate).

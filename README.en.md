# ourFund

[![CI](https://github.com/ZielaM/ourFund/actions/workflows/ci.yml/badge.svg)](https://github.com/ZielaM/ourFund/actions/workflows/ci.yml)

A free, open-source investment portfolio tracker for the Polish market that you run yourself in Docker.

[Wersja polska](README.md)

> **Work in progress.** What works today: user accounts, portfolios, accounts (standard, IKE, IKZE, OKI), transactions entered by hand with positions computed FIFO, downloaded quotes and exchange rates, and valuation in złoty: portfolio value, results split into price and currency effects, returns (TWR and XIRR), comparison with a benchmark, portfolio structure and a value chart, retail treasury bonds valued from their issue terms, dividend and interest history, figures for the PIT-38 tax return, data export, and import of account history from XTB.

The user interface is in Polish. Every text lives in one translation file (`src/i18n/messages/pl.json`), so another language can be added without touching the code.

## What it is

- A web application (Next.js + TypeScript) with a PostgreSQL database, started with `docker compose`.
- Local accounts only: your data stays on your server. There is no password reset by e-mail; the administrator sets a new password.
- Built for Polish investors: the Warsaw Stock Exchange (GPW), retail treasury bonds, IKE / IKZE / OKI accounts, PIT-38.
- A light and a dark theme. It follows the system setting by default; the button in the header or the "Ustawienia" (settings) page switches it.

## Running it

You need Docker with the Compose plugin.

```bash
git clone https://github.com/ZielaM/ourFund.git
cd ourFund
docker compose up -d --build
```

The application is then available at <http://localhost:3000>. On the first visit you create the administrator account; the administrator adds further people on the "Użytkownicy" (Users) page. Database migrations run on their own when the container starts, and the data is kept in the `ourfund_db-data` volume.

### Published image

Starting with the first release, every version is published as the image `ghcr.io/zielam/ourfund` (amd64). To skip building the application yourself, pull the image and start the stack without a build:

```bash
docker compose pull app
docker compose up -d --no-build
```

The variable `OURFUND_VERSION` picks a version (for example `0.2.0`); the newest one is pulled by default. On other architectures, such as a Raspberry Pi, build the image locally with `docker compose up -d --build`.

To update, run `docker compose pull app` and `docker compose up -d --no-build` again. Migrations run on their own; make a backup first.

Optional settings (a `.env` file next to `docker-compose.yml`):

| Variable             | Default   | Meaning                                                                                |
| -------------------- | --------- | -------------------------------------------------------------------------------------- |
| `APP_PORT`           | `3000`    | Port the application is published on                                                   |
| `ALLOW_REGISTRATION` | `false`   | `true` lets anyone who can reach the application create an account                     |
| `OURFUND_VERSION`    | `latest`  | Version of the published image, for example `0.2.0`                                    |
| `MARKET_DATA`        | `live`    | `off` never downloads quotes or exchange rates; prices are then entered by hand        |
| `POSTGRES_PASSWORD`  | `ourfund` | Database password (letters and digits only); the database is not published to the host |

## Data sources

Every instance downloads data on its own, for its own users. Only instruments that appear in transactions are downloaded.

- **Exchange rates**: the official API of the National Bank of Poland (table A, average rates).
- **Quotes**: Yahoo Finance. This is an unofficial interface: it may stop working or change without notice, and Yahoo's terms allow personal use only. The quote symbol is derived automatically (for example `CDR.WA` for GPW) and can be changed on the instrument's page.
- **Benchmark**: any instrument of the catalogue. Yahoo Finance has no history for GPW indices (WIG, WIG20), so for the Polish market the benchmark should be an ETF tracking the index, for example `ETFBW20TR` (WIG20TR). Foreign indices work by symbol, for example `^GSPC` for the S&P 500.
- **Prices entered by hand** always win over downloaded ones. An instrument can also be switched to manual prices entirely.
- **Retail treasury bonds** (OTS, ROR, DOR, TOS, COI, EDO, ROS, ROD) have no quotes. Their value is computed from the issue terms, separately for every purchase: interest accrued since the purchase day, yearly capitalisation or payout. When adding a series you give its symbol (for example `EDO1135`), the rate of the first period and the margin from the issue letter. For floating-rate bonds the rate of each later period is worked out by the rules of the issue letters: for COI, EDO, ROS and ROD it is the inflation announced by GUS in the month before the period starts plus the margin; for ROR and DOR it is the NBP reference rate of the tenth business day before the month starts plus the margin. Inflation comes from the GUS API and the reference rate from an NBP file; both refresh together with the quotes. The calculation needs the margin, and a rate entered by hand always wins (enter it when the one announced by the Ministry of Finance differs). Until the rate of the current period is known, the valuation uses the last known one and is marked as an estimate.

**Dividends and splits** are fetched together with the quotes. The app never adds anything by itself: the portfolio page links to a list of events missing from its accounts, and each one is either recorded from a prefilled form or dismissed. A dividend amount follows from the units held the day before the ex-dividend day; the payment day and the tax have to be checked against the broker's confirmation. Yahoo reports historical prices adjusted for splits, so the app converts them back to the prices that were actually traded. Renamed companies, rights issues and mergers are not handled.

Quotes refresh every day at 18:30 and 23:15 Polish time, and on demand (the "Odśwież notowania" button). `MARKET_DATA=off` switches off all connections to the internet.

`pnpm exec tsx scripts/check-market-data.mts` checks the live sources.

## Import from XTB

At the top of the portfolio page, next to "Dodaj transakcję", there is a button "Importuj z XTB" (shown once the portfolio has an account). It reads the account history report downloaded from xStation (an `.xlsx` file, one per account: PLN, EUR, USD, IKE):

- it first shows a preview: how many operations would be added, which instruments would join the catalogue, which rows were left out and why; nothing is saved until you confirm,
- it understands purchases and sales (fractional ones too), dividends with withholding tax, interest on idle cash, deposits, withdrawals and transfers to an IKE account,
- importing the same report again, or a longer one, creates no duplicates,
- the files of the currency accounts can go into one ourFund account, because cash is tracked per currency.

Limits: instruments listed on GPW, in the US, on Xetra and on Euronext are supported; operations the importer does not know (currency conversions, for example) are not guessed but shown as left out. Shares received without any cash moving (an allotment, a spin-off) are added as a purchase at price zero if they are still on the account. The cost of a purchase is quantity times the price in the report, so the cash balance may differ from XTB's by fractions of a grosz.

The file is read on your server; it is not sent anywhere and not kept.

## Taxes

The "Podatki" (Taxes) page prepares the figures of the yearly PIT-38 return from all portfolios of the user:

- **Sales of securities**: revenue, costs and income, with cost matched FIFO separately on every account.
- **Dividends and interest from abroad**: 19% tax less the tax withheld abroad.
- **Virtual currencies**: revenue, costs incurred in the year and costs carried over from earlier years.
- IKE, IKZE and OKI accounts are left out. Dividends of Polish companies and redemptions of savings bonds, where the payer withholds the tax, are listed separately as amounts outside the return.

Foreign amounts are converted at the NBP average rate of the last working day before the transaction; when the account paid in złoty, the amount in złoty at the broker's rate is used. The report takes the transaction date as entered, does not deduct losses of earlier years, and does not know treaty rates (it caps the deduction of foreign tax at 19% of each payment).

It is an aid for filling in the return, not tax advice. Compare the figures with the PIT-8C from your broker.

## Backup and data export

All data is in the PostgreSQL database, in the `ourfund_db-data` volume. A backup of the whole instance (all users) is made with the database's own tools:

```bash
# back up to a file
docker compose exec -T db pg_dump -U ourfund --format=custom ourfund > ourfund-backup.dump

# restore from a file (replaces what is in the database now)
docker compose stop app
docker compose exec -T db pg_restore -U ourfund --dbname=ourfund --clean --if-exists < ourfund-backup.dump
docker compose start app
```

Back up regularly and keep the file somewhere other than the server the application runs on. `docker compose down --volumes` deletes the volume together with the data.

Every user can also download their own data on the "Ustawienia" (Settings) page:

- **transactions as CSV**: for Excel or LibreOffice set to Polish (semicolons, decimal comma),
- **a full copy as JSON**: portfolios, accounts, transactions and the instruments in use, with bond terms and prices entered by hand.

The JSON file is for archiving and your own analysis; the application cannot read it back in yet.

## Working on the code

You need Node.js 22, pnpm and Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up        # PostgreSQL for development and tests (localhost:5432)
pnpm db:migrate   # apply the migrations
pnpm dev          # http://localhost:3000
```

| Command                        | What it does                                               |
| ------------------------------ | ---------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` | ESLint and type checking                                   |
| `pnpm format`                  | Formatting with Prettier (`pnpm format:check` only checks) |
| `pnpm test`                    | Unit, component and integration tests with coverage        |
| `pnpm test:unit`               | The tests that do not need a database                      |
| `pnpm e2e`                     | Playwright tests against the built application             |

Before the first `pnpm e2e`, install the browser: `pnpm exec playwright install chromium`.

Changes reach `main` only through pull requests with green CI. Code, comments and commit messages are in English; `CLAUDE.md` describes the architecture and the project's rules.

## License

[AGPL-3.0](LICENSE)

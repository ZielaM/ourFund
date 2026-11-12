# ourFund

[![CI](https://github.com/ZielaM/ourFund/actions/workflows/ci.yml/badge.svg)](https://github.com/ZielaM/ourFund/actions/workflows/ci.yml)

Otwarty, darmowy tracker portfela inwestycyjnego dla rynku polskiego, uruchamiany u siebie w Dockerze.

> **Projekt we wczesnej fazie budowy.** Działa szkielet aplikacji; funkcje portfela powstają etapami.

## Założenia

- Aplikacja webowa (Next.js + TypeScript) z bazą PostgreSQL, uruchamiana przez `docker compose`.
- Tylko konta lokalne — dane zostają na Twoim serwerze.
- Polskie realia: GPW, detaliczne obligacje skarbowe, rachunki IKE / IKZE / OKI, PIT-38.

## Uruchomienie

Wymagany jest Docker z wtyczką Compose.

```bash
git clone https://github.com/ZielaM/ourFund.git
cd ourFund
docker compose up -d --build
```

Aplikacja będzie dostępna pod adresem <http://localhost:3000>. Migracje bazy wykonują się same przy starcie kontenera, a dane są trzymane w wolumenie `ourfund_db-data`.

Opcjonalne ustawienia (plik `.env` obok `docker-compose.yml`):

| Zmienna             | Domyślnie | Opis                                                                             |
| ------------------- | --------- | -------------------------------------------------------------------------------- |
| `APP_PORT`          | `3000`    | Port, pod którym aplikacja jest dostępna                                         |
| `POSTGRES_PASSWORD` | `ourfund` | Hasło bazy (tylko litery i cyfry); baza nie jest wystawiona poza sieć kontenerów |

## Praca nad kodem

Wymagane: Node.js 22, pnpm, Docker.

```bash
pnpm install
cp .env.example .env
pnpm db:up        # PostgreSQL dla developmentu i testów (localhost:5432)
pnpm db:migrate   # zastosowanie migracji
pnpm dev          # http://localhost:3000
```

| Polecenie                      | Co robi                                                      |
| ------------------------------ | ------------------------------------------------------------ |
| `pnpm lint` / `pnpm typecheck` | ESLint i kontrola typów                                      |
| `pnpm format`                  | Formatowanie Prettierem (`pnpm format:check` tylko sprawdza) |
| `pnpm test`                    | Testy jednostkowe, komponentów i integracyjne z pokryciem    |
| `pnpm test:unit`               | Testy, które nie potrzebują bazy                             |
| `pnpm e2e`                     | Testy Playwright na zbudowanej aplikacji                     |

Przed pierwszym `pnpm e2e` zainstaluj przeglądarkę: `pnpm exec playwright install chromium`.

Zmiany trafiają do `main` wyłącznie przez pull requesty z zielonym CI.

## Licencja

[AGPL-3.0](LICENSE)

# ourFund

[![CI](https://github.com/ZielaM/ourFund/actions/workflows/ci.yml/badge.svg)](https://github.com/ZielaM/ourFund/actions/workflows/ci.yml)

Otwarty, darmowy tracker portfela inwestycyjnego dla rynku polskiego, uruchamiany u siebie w Dockerze.

> **Projekt w budowie.** Działają konta użytkowników, portfele, rachunki (zwykłe, IKE, IKZE, OKI), ręcznie wpisywane transakcje z wyliczaniem pozycji metodą FIFO, pobieranie notowań i kursów walut oraz wycena w złotych: wartość portfela, wynik z rozbiciem na zmianę ceny i kursu waluty, stopy zwrotu (TWR i XIRR), porównanie z benchmarkiem, struktura portfela i wykres wartości. Obligacje skarbowe, import z brokerów i podatki powstają w kolejnych etapach.

## Założenia

- Aplikacja webowa (Next.js + TypeScript) z bazą PostgreSQL, uruchamiana przez `docker compose`.
- Tylko konta lokalne — dane zostają na Twoim serwerze. Nie ma odzyskiwania hasła e-mailem: nowe hasło nadaje administrator.
- Polskie realia: GPW, detaliczne obligacje skarbowe, rachunki IKE / IKZE / OKI, PIT-38.

## Uruchomienie

Wymagany jest Docker z wtyczką Compose.

```bash
git clone https://github.com/ZielaM/ourFund.git
cd ourFund
docker compose up -d --build
```

Aplikacja będzie dostępna pod adresem <http://localhost:3000>. Przy pierwszym wejściu utworzysz konto administratora; kolejne osoby dodaje administrator w zakładce „Użytkownicy”. Migracje bazy wykonują się same przy starcie kontenera, a dane są trzymane w wolumenie `ourfund_db-data`.

Opcjonalne ustawienia (plik `.env` obok `docker-compose.yml`):

| Zmienna              | Domyślnie | Opis                                                                                   |
| -------------------- | --------- | -------------------------------------------------------------------------------------- |
| `APP_PORT`           | `3000`    | Port, pod którym aplikacja jest dostępna                                               |
| `ALLOW_REGISTRATION` | `false`   | `true` pozwala każdemu, kto ma dostęp do aplikacji, założyć konto                      |
| `MARKET_DATA`        | `live`    | `off` wyłącza pobieranie notowań i kursów z internetu; kursy wpisuje się wtedy ręcznie |
| `POSTGRES_PASSWORD`  | `ourfund` | Hasło bazy (tylko litery i cyfry); baza nie jest wystawiona poza sieć kontenerów       |

## Źródła danych

Każda instancja pobiera dane samodzielnie, na własny użytek jej użytkowników. Pobierane są tylko instrumenty, na których zapisano transakcje.

- **Kursy walut**: oficjalne API Narodowego Banku Polskiego (tabela A, kursy średnie).
- **Notowania**: Yahoo Finance. To interfejs nieoficjalny: może przestać działać albo zmienić się bez zapowiedzi, a warunki korzystania z serwisu Yahoo dopuszczają go wyłącznie do użytku osobistego. Symbol notowań ustala się automatycznie (np. `CDR.WA` dla GPW) i można go zmienić w szczegółach instrumentu.
- **Benchmark**: dowolny instrument z katalogu. Yahoo Finance nie udostępnia historii indeksów GPW (WIG, WIG20), dlatego dla polskiego rynku benchmarkiem powinien być ETF na indeks, np. `ETFBW20TR` (WIG20TR). Indeksy zagraniczne działają po podaniu symbolu, np. `^GSPC` dla S&P 500.
- **Kursy wpisane ręcznie** mają zawsze pierwszeństwo przed pobranymi. Instrument można też w całości przełączyć na kursy ręczne.

Notowania odświeżają się codziennie o 18:30 i 23:15 czasu polskiego oraz na żądanie (przycisk „Odśwież notowania”). Ustawienie `MARKET_DATA=off` całkowicie wyłącza połączenia z internetem.

Poprawność działania źródeł na żywo sprawdza polecenie `pnpm exec tsx scripts/check-market-data.mts`.

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

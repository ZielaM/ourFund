# ourFund

[![CI](https://github.com/ZielaM/ourFund/actions/workflows/ci.yml/badge.svg)](https://github.com/ZielaM/ourFund/actions/workflows/ci.yml)

Otwarty, darmowy tracker portfela inwestycyjnego dla rynku polskiego, uruchamiany u siebie w Dockerze.

[English version](README.en.md)

> **Projekt w budowie.** Działają konta użytkowników, portfele, rachunki (zwykłe, IKE, IKZE, OKI), ręcznie wpisywane transakcje z wyliczaniem pozycji metodą FIFO, pobieranie notowań i kursów walut oraz wycena w złotych: wartość portfela, wynik z rozbiciem na zmianę ceny i kursu waluty, stopy zwrotu (TWR i XIRR), porównanie z benchmarkiem, struktura portfela i wykres wartości, detaliczne obligacje skarbowe wyceniane z warunków emisji, historia dywidend i odsetek, zestawienie do PIT-38, eksport danych oraz import historii rachunku z XTB.

## Założenia

- Aplikacja webowa (Next.js + TypeScript) z bazą PostgreSQL, uruchamiana przez `docker compose`.
- Tylko konta lokalne — dane zostają na Twoim serwerze. Nie ma odzyskiwania hasła e-mailem: nowe hasło nadaje administrator.
- Polskie realia: GPW, detaliczne obligacje skarbowe, rachunki IKE / IKZE / OKI, PIT-38.
- Interfejs jest po polsku i ma jasny oraz ciemny motyw. Domyślnie idzie za ustawieniami systemu; przełącza go przycisk w nagłówku albo zakładka „Ustawienia”.

## Uruchomienie

Wymagany jest Docker z wtyczką Compose.

```bash
git clone https://github.com/ZielaM/ourFund.git
cd ourFund
docker compose up -d --build
```

Aplikacja będzie dostępna pod adresem <http://localhost:3000>. Przy pierwszym wejściu utworzysz konto administratora; kolejne osoby dodaje administrator w zakładce „Użytkownicy”. Migracje bazy wykonują się same przy starcie kontenera, a dane są trzymane w wolumenie `ourfund_db-data`.

### Gotowy obraz

Od pierwszego wydania każda wersja jest publikowana jako obraz `ghcr.io/zielam/ourfund` (architektura amd64). Żeby nie budować aplikacji samodzielnie, pobierz obraz i uruchom stos bez budowania:

```bash
docker compose pull app
docker compose up -d --no-build
```

Konkretną wersję wybiera zmienna `OURFUND_VERSION` (np. `0.2.0`); domyślnie pobierana jest najnowsza. Na innych architekturach, np. na Raspberry Pi, zbuduj obraz lokalnie poleceniem `docker compose up -d --build`.

Aktualizacja do nowej wersji to ponowne `docker compose pull app` i `docker compose up -d --no-build`. Migracje bazy wykonają się same; przed aktualizacją zrób kopię zapasową.

Opcjonalne ustawienia (plik `.env` obok `docker-compose.yml`):

| Zmienna              | Domyślnie | Opis                                                                                   |
| -------------------- | --------- | -------------------------------------------------------------------------------------- |
| `APP_PORT`           | `3000`    | Port, pod którym aplikacja jest dostępna                                               |
| `ALLOW_REGISTRATION` | `false`   | `true` pozwala każdemu, kto ma dostęp do aplikacji, założyć konto                      |
| `OURFUND_VERSION`    | `latest`  | Wersja gotowego obrazu, np. `0.2.0`                                                    |
| `MARKET_DATA`        | `live`    | `off` wyłącza pobieranie notowań i kursów z internetu; kursy wpisuje się wtedy ręcznie |
| `POSTGRES_PASSWORD`  | `ourfund` | Hasło bazy (tylko litery i cyfry); baza nie jest wystawiona poza sieć kontenerów       |

## Źródła danych

Każda instancja pobiera dane samodzielnie, na własny użytek jej użytkowników. Pobierane są tylko instrumenty, na których zapisano transakcje.

- **Kursy walut**: oficjalne API Narodowego Banku Polskiego (tabela A, kursy średnie).
- **Notowania**: Yahoo Finance. To interfejs nieoficjalny: może przestać działać albo zmienić się bez zapowiedzi, a warunki korzystania z serwisu Yahoo dopuszczają go wyłącznie do użytku osobistego. Symbol notowań ustala się automatycznie (np. `CDR.WA` dla GPW) i można go zmienić w szczegółach instrumentu.
- **Benchmark**: dowolny instrument z katalogu. Yahoo Finance nie udostępnia historii indeksów GPW (WIG, WIG20), dlatego dla polskiego rynku benchmarkiem powinien być ETF na indeks, np. `ETFBW20TR` (WIG20TR). Indeksy zagraniczne działają po podaniu symbolu, np. `^GSPC` dla S&P 500.
- **Złoto**: cena grama złota publikowana przez NBP, w złotych. Dodaj instrument rodzaju „Metal lub surowiec” notowany w PLN i w jego szczegółach wybierz źródło „Cena złota NBP”; liczba sztuk to wtedy gramy czystego złota (uncja to 31,1035 g). Inne metale można śledzić przez symbol kontraktu w Yahoo Finance (np. `SI=F` dla srebra, w dolarach za uncję) albo przez kursy wpisywane ręcznie. Sprzedaż metali nie trafia do zestawienia PIT-38; jest pokazana osobno jako kwota poza zeznaniem.
- **Kursy wpisane ręcznie** mają zawsze pierwszeństwo przed pobranymi. Instrument można też w całości przełączyć na kursy ręczne.
- **Detaliczne obligacje skarbowe** (OTS, ROR, DOR, TOS, COI, EDO, ROS, ROD) nie mają notowań. Ich wartość jest wyliczana z warunków emisji, osobno dla każdego zakupu: odsetki narosłe od dnia zakupu, coroczna kapitalizacja albo wypłata odsetek. Dodając serię, podajesz jej symbol (np. `EDO1135`), oprocentowanie pierwszego okresu i marżę z listu emisyjnego. Dla obligacji o zmiennym oprocentowaniu stopa kolejnych okresów jest wyliczana według reguł z listów emisyjnych: dla COI, EDO, ROS i ROD to inflacja ogłoszona przez GUS w miesiącu przed początkiem okresu plus marża, dla ROR i DOR stopa referencyjna NBP z dziesiątego dnia roboczego przed początkiem miesiąca plus marża. Inflacja pochodzi z API GUS, stopa referencyjna z pliku NBP; oba źródła odświeżają się razem z notowaniami. Wyliczenie wymaga podanej marży, a stopa wpisana ręcznie ma zawsze pierwszeństwo (warto ją wpisać, gdy ogłoszona przez Ministerstwo Finansów różni się od wyliczonej). Dopóki stopy bieżącego okresu brakuje, wycena przyjmuje ostatnią znaną i jest oznaczona jako szacunek.

Razem z notowaniami pobierane są **dywidendy i splity** spółek. Aplikacja niczego nie dopisuje sama: na stronie portfela pojawia się odnośnik do listy zdarzeń, których nie ma na rachunkach, a każde z nich zapisuje się z wypełnionego formularza albo pomija. Kwota dywidendy wynika z liczby sztuk posiadanych dzień przed odcięciem prawa do niej; dzień wypłaty i podatek trzeba sprawdzić w potwierdzeniu od brokera. Yahoo podaje historyczne kursy przeliczone po splicie, więc aplikacja przelicza je z powrotem na kursy, po których faktycznie handlowano. Zmiany nazw spółek, prawa poboru i połączenia nie są obsługiwane.

Notowania odświeżają się codziennie o 18:30 i 23:15 czasu polskiego oraz na żądanie (przycisk „Odśwież notowania”). Ustawienie `MARKET_DATA=off` całkowicie wyłącza połączenia z internetem.

Poprawność działania źródeł na żywo sprawdza polecenie `pnpm exec tsx scripts/check-market-data.mts`.

## Import z XTB

U góry strony portfela, obok „Dodaj transakcję”, jest przycisk „Importuj z XTB” (pojawia się, gdy portfel ma rachunek). Wczytuje on raport historii rachunku pobrany z xStation (plik `.xlsx`, osobny dla każdego rachunku: PLN, EUR, USD, IKE):

- najpierw pokazuje podgląd: ile operacji zostanie dodanych, jakie instrumenty trafią do katalogu, które wiersze pominięto i dlaczego; zapis następuje dopiero po zatwierdzeniu,
- rozpoznaje kupna i sprzedaże (także ułamkowe), dywidendy z podatkiem u źródła, odsetki od wolnych środków, wpłaty, wypłaty i przelewy na IKE,
- ponowny import tego samego albo dłuższego raportu nie tworzy duplikatów,
- pliki rachunków walutowych można wczytać do jednego rachunku w ourFund, bo gotówka jest liczona osobno w każdej walucie.

Ograniczenia: obsługiwane są instrumenty z GPW, USA, Xetry i Euronextu; operacji, których import nie zna (np. przewalutowań), nie zgaduje, tylko pokazuje je jako pominięte. Akcje otrzymane bez przepływu gotówki (przydział, podział spółki) są dodawane jako kupno po cenie zero, jeśli nadal są na rachunku. Koszt zakupu to liczba razy cena z raportu, więc saldo gotówki może różnić się od salda w XTB o ułamki grosza.

Plik jest czytany na Twoim serwerze i nie jest nigdzie wysyłany ani przechowywany.

## Podatki

Zakładka „Podatki” przygotowuje dane do rocznego zeznania PIT-38 ze wszystkich portfeli użytkownika:

- **Sprzedaż papierów wartościowych**: przychód, koszty i dochód, z kosztem ustalanym metodą FIFO osobno na każdym rachunku.
- **Dywidendy i odsetki z zagranicy**: podatek 19% pomniejszony o podatek pobrany za granicą.
- **Kryptowaluty**: przychód, koszty poniesione w roku i koszty przenoszone z lat ubiegłych.
- Rachunki IKE, IKZE i OKI są pomijane. Dywidendy od polskich spółek i wykup obligacji oszczędnościowych, od których podatek pobiera płatnik, są pokazane osobno jako kwoty poza zeznaniem.

Kwoty w walutach obcych są przeliczane po średnim kursie NBP z ostatniego dnia roboczego przed transakcją; gdy rachunek płacił w złotych, liczy się kwota w złotych po kursie brokera. Zestawienie przyjmuje datę transakcji taką, jaką wpisano, nie odlicza strat z lat ubiegłych i nie zna stawek z umów o unikaniu podwójnego opodatkowania (odliczenie podatku zagranicznego ogranicza do 19% każdej wypłaty).

To pomoc w wypełnieniu zeznania, a nie porada podatkowa. Kwoty warto porównać z PIT-8C od brokera.

## Kopia zapasowa i eksport danych

Wszystkie dane są w bazie PostgreSQL, w wolumenie `ourfund_db-data`. Kopię całej instancji (wszystkich użytkowników) robi się narzędziami bazy:

```bash
# kopia do pliku
docker compose exec -T db pg_dump -U ourfund --format=custom ourfund > ourfund-kopia.dump

# odtworzenie z pliku (zastępuje obecną zawartość bazy)
docker compose stop app
docker compose exec -T db pg_restore -U ourfund --dbname=ourfund --clean --if-exists < ourfund-kopia.dump
docker compose start app
```

Kopię warto robić regularnie i trzymać poza serwerem, na którym działa aplikacja. Polecenie `docker compose down --volumes` usuwa wolumen razem z danymi.

Każdy użytkownik może też sam pobrać swoje dane w zakładce „Ustawienia”:

- **transakcje jako CSV**: do otwarcia w Excelu lub LibreOffice ustawionych na język polski (średniki, przecinek dziesiętny),
- **pełną kopię jako JSON**: portfele, rachunki, transakcje oraz użyte instrumenty z warunkami obligacji i kursami wpisanymi ręcznie.

Plik JSON służy do archiwizacji i własnych analiz; aplikacja nie potrafi go jeszcze wczytać z powrotem.

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

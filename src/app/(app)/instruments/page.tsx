import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, TextField } from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import { DataTable } from "@/components/layout/data-table";
import { PageTitle } from "@/components/layout/page-title";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CURRENCIES } from "@/domain/portfolio/currencies";
import { MARKETS, type Market } from "@/domain/portfolio/markets";
import { INSTRUMENT_TYPES } from "@/domain/portfolio/naming";
import { formatDate, formatPrice } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { getLatestPrices } from "@/server/market-data/prices";
import { getLastRefresh } from "@/server/market-data/refresh";
import { listInstruments } from "@/server/portfolio/instruments";
import { createInstrumentAction, refreshMarketDataAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instruments");
  return { title: t("title") };
}

export default async function InstrumentsPage() {
  await requireUser();
  const db = getDb();
  const instruments = await listInstruments(db);
  const [latestPrices, lastRefresh, t, tTypes, tMarkets, format] = await Promise.all([
    getLatestPrices(
      db,
      instruments.map((instrument) => instrument.id),
    ),
    getLastRefresh(db),
    getTranslations("instruments"),
    getTranslations("instrumentTypes"),
    getTranslations("markets"),
    getFormatter(),
  ]);
  const marketDataOff = getEnv().MARKET_DATA === "off";

  return (
    <>
      <PageTitle>{t("title")}</PageTitle>
      <p className="mt-6 max-w-prose text-sm text-muted-foreground">{t("intro")}</p>

      <div className="mt-8">
        {instruments.length === 0 ? (
          <p className="max-w-prose text-muted-foreground">{t("empty")}</p>
        ) : (
          <DataTable>
            <Table>
              <TableCaption className="sr-only">{t("table.caption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("table.symbol")}</TableHead>
                  <TableHead>{t("table.name")}</TableHead>
                  <TableHead>{t("table.type")}</TableHead>
                  <TableHead>{t("table.market")}</TableHead>
                  <TableHead>{t("table.currency")}</TableHead>
                  <TableHead className="text-right">{t("table.lastPrice")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("table.details")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {instruments.map((instrument) => {
                  const price = latestPrices.get(instrument.id);

                  return (
                    <TableRow key={instrument.id}>
                      <TableCell className="font-medium">{instrument.symbol}</TableCell>
                      <TableCell>{instrument.name}</TableCell>
                      <TableCell>{tTypes(instrument.type)}</TableCell>
                      <TableCell>{tMarkets(instrument.market as Market)}</TableCell>
                      <TableCell>{instrument.currency}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {price ? (
                          <>
                            {formatPrice(price.close)}{" "}
                            <span className="text-muted-foreground">
                              ({formatDate(price.date)})
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{t("table.noPrice")}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link
                          href={`/instruments/${instrument.id}`}
                          aria-label={t("table.detailsOf", { symbol: instrument.symbol })}
                          className="underline underline-offset-4"
                        >
                          {t("table.details")}
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </DataTable>
        )}
      </div>

      <section aria-labelledby="quotes-title" className="mt-12 flex max-w-prose flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="quotes-title" className="text-xl font-semibold">
            {t("quotes.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {marketDataOff ? t("quotes.off") : t("quotes.sources")}
          </p>
        </div>
        {marketDataOff ? null : (
          <>
            <p className="text-sm">
              {lastRefresh
                ? t("quotes.lastRefresh", {
                    when: format.dateTime(new Date(lastRefresh.finishedAt), {
                      dateStyle: "long",
                      timeStyle: "short",
                    }),
                  })
                : t("quotes.never")}
            </p>
            {lastRefresh &&
            lastRefresh.instruments.failed.length + lastRefresh.currencies.failed.length > 0 ? (
              <div className="flex flex-col gap-1 text-sm">
                <h3 className="font-sans font-medium">{t("quotes.failedTitle")}</h3>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {lastRefresh.instruments.failed.map((failure) => (
                    <li key={failure.symbol}>
                      {t(`quotes.reasons.${failure.reason}`, {
                        symbol: failure.symbol,
                        quoteSymbol: failure.quoteSymbol ?? "",
                      })}
                    </li>
                  ))}
                  {lastRefresh.currencies.failed.length > 0 ? (
                    <li>
                      {t("quotes.fxFailed", {
                        currencies: lastRefresh.currencies.failed.join(", "),
                      })}
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
            <ActionForm action={refreshMarketDataAction}>
              <SubmitButton variant="outline" className="self-start">
                {t("quotes.refresh")}
              </SubmitButton>
            </ActionForm>
          </>
        )}
      </section>

      <section aria-labelledby="create-title" className="mt-12 flex max-w-sm flex-col gap-5">
        <h2 id="create-title" className="text-xl font-semibold">
          {t("create.title")}
        </h2>
        <ActionForm action={createInstrumentAction}>
          <TextField
            name="symbol"
            label={t("create.symbol")}
            hint={t("create.symbolHint")}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            required
          />
          <TextField name="name" label={t("create.name")} autoComplete="off" required />
          <SelectField name="type" label={t("create.type")} defaultValue="STOCK">
            {INSTRUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {tTypes(type)}
              </option>
            ))}
          </SelectField>
          <SelectField name="market" label={t("create.market")} defaultValue="GPW">
            {MARKETS.map((market) => (
              <option key={market} value={market}>
                {tMarkets(market)}
              </option>
            ))}
          </SelectField>
          <SelectField name="currency" label={t("create.currency")} defaultValue="PLN">
            {CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </SelectField>
          <SubmitButton className="self-start">{t("create.submit")}</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}

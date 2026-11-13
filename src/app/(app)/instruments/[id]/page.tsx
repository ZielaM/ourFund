import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
import { PRICE_SOURCES } from "@/domain/market-data/inputs";
import { defaultQuoteSymbol } from "@/domain/market-data/quote-symbol";
import { todayInWarsaw } from "@/domain/portfolio/dates";
import type { Market } from "@/domain/portfolio/markets";
import type { InstrumentType } from "@/domain/portfolio/naming";
import { formatDate, formatPrice } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getInstrument, listPrices } from "@/server/market-data/prices";
import {
  deleteManualPriceAction,
  setManualPriceAction,
  updateQuoteSettingsAction,
} from "../actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instruments");
  return { title: t("title") };
}

export default async function InstrumentPage({ params }: PageProps<"/instruments/[id]">) {
  await requireUser();
  const { id } = await params;
  const db = getDb();
  const instrument = await getInstrument(db, id);

  if (!instrument) {
    notFound();
  }

  const [prices, t, tTypes, tMarkets] = await Promise.all([
    listPrices(db, instrument.id),
    getTranslations("instrument"),
    getTranslations("instrumentTypes"),
    getTranslations("markets"),
  ]);
  const derivedSymbol = defaultQuoteSymbol(instrument);

  return (
    <>
      <Link
        href="/instruments"
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        {t("back")}
      </Link>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <PageTitle>{instrument.symbol}</PageTitle>
        <p className="pb-2 text-sm text-muted-foreground">
          {instrument.name}, {tTypes(instrument.type as InstrumentType)},{" "}
          {tMarkets(instrument.market as Market)}, {instrument.currency}
        </p>
      </div>

      <section aria-labelledby="source-title" className="mt-10 flex max-w-sm flex-col gap-5">
        <h2 id="source-title" className="text-xl font-semibold">
          {t("source.title")}
        </h2>
        <ActionForm action={updateQuoteSettingsAction.bind(null, instrument.id)}>
          <SelectField
            name="priceSource"
            label={t("source.label")}
            defaultValue={instrument.priceSource}
          >
            {PRICE_SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`source.options.${source}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            name="quoteSymbol"
            label={t("source.quoteSymbol")}
            hint={
              derivedSymbol
                ? t("source.hintDefault", { symbol: derivedSymbol })
                : t("source.hintRequired")
            }
            defaultValue={instrument.quoteSymbol ?? undefined}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <SubmitButton className="self-start">{t("source.save")}</SubmitButton>
        </ActionForm>
      </section>

      <section aria-labelledby="manual-title" className="mt-12 flex max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 id="manual-title" className="text-xl font-semibold">
            {t("manual.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("manual.intro")}</p>
        </div>
        <ActionForm action={setManualPriceAction.bind(null, instrument.id)}>
          <TextField
            name="date"
            type="date"
            label={t("manual.date")}
            defaultValue={todayInWarsaw(new Date())}
            required
          />
          <TextField
            name="close"
            label={t("manual.close", { currency: instrument.currency })}
            inputMode="decimal"
            autoComplete="off"
            required
          />
          <SubmitButton className="self-start">{t("manual.submit")}</SubmitButton>
        </ActionForm>
      </section>

      <section aria-labelledby="prices-title" className="mt-12 flex flex-col gap-4">
        <h2 id="prices-title" className="text-xl font-semibold">
          {t("prices.title")}
        </h2>
        {prices.length === 0 ? (
          <p className="text-muted-foreground">{t("prices.empty")}</p>
        ) : (
          <DataTable className="max-w-xl">
            <Table>
              <TableCaption className="sr-only">{t("prices.caption")}</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("prices.date")}</TableHead>
                  <TableHead className="text-right">{t("prices.close")}</TableHead>
                  <TableHead>{t("prices.source")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("prices.delete")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map((price) => (
                  <TableRow key={price.date}>
                    <TableCell className="tabular-nums">{formatDate(price.date)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPrice(price.close)} {instrument.currency}
                    </TableCell>
                    <TableCell>{t(`prices.sources.${price.source}`)}</TableCell>
                    <TableCell className="text-right">
                      {price.source === "MANUAL" ? (
                        <ActionForm
                          action={deleteManualPriceAction.bind(null, instrument.id, price.date)}
                          className="items-end gap-1"
                        >
                          <button
                            type="submit"
                            aria-label={t("prices.deleteLabel", { date: formatDate(price.date) })}
                            className="cursor-pointer underline underline-offset-4"
                          >
                            {t("prices.delete")}
                          </button>
                        </ActionForm>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )}
      </section>
    </>
  );
}

import type { Metadata } from "next";
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
import { CURRENCIES } from "@/domain/portfolio/currencies";
import { MARKETS, type Market } from "@/domain/portfolio/markets";
import { INSTRUMENT_TYPES } from "@/domain/portfolio/naming";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listInstruments } from "@/server/portfolio/instruments";
import { createInstrumentAction } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("instruments");
  return { title: t("title") };
}

export default async function InstrumentsPage() {
  await requireUser();
  const instruments = await listInstruments(getDb());
  const t = await getTranslations("instruments");
  const tTypes = await getTranslations("instrumentTypes");
  const tMarkets = await getTranslations("markets");

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
                </TableRow>
              </TableHeader>
              <TableBody>
                {instruments.map((instrument) => (
                  <TableRow key={instrument.id}>
                    <TableCell className="font-medium">{instrument.symbol}</TableCell>
                    <TableCell>{instrument.name}</TableCell>
                    <TableCell>{tTypes(instrument.type)}</TableCell>
                    <TableCell>{tMarkets(instrument.market as Market)}</TableCell>
                    <TableCell>{instrument.currency}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
        )}
      </div>

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

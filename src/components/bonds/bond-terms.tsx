import { useTranslations } from "next-intl";
import { deleteBondRateAction, setBondRateAction } from "@/app/(app)/instruments/actions";
import { ActionForm } from "@/components/form/action-form";
import { SelectField, TextField } from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import { DataTable } from "@/components/layout/data-table";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BOND_RULES, earlyRedemptionFee, periodCount } from "@/domain/bonds/kinds";
import type { Decimal } from "@/domain/decimal";
import { todayInWarsaw } from "@/domain/portfolio/dates";
import type { BondDetail } from "@/server/bonds/bonds";

/** A rate in percent the way it is written in Poland: "5,35%". */
function percent(value: Decimal): string {
  return `${value.toFixed(2).replace(".", ",")}%`;
}

/** The terms of a retail treasury bond series and the rates entered for its later periods. */
export function BondTerms({ bond }: { bond: BondDetail }) {
  const t = useTranslations("bonds.detail");
  const rules = BOND_RULES[bond.kind];
  const periods = periodCount(bond.kind);
  const interest =
    rules.interest === "capitalize"
      ? "capitalize"
      : periods === 1
        ? "payoutAtMaturity"
        : rules.periodMonths === 1
          ? "payoutMonthly"
          : "payoutYearly";
  const fee = earlyRedemptionFee(bond.kind, todayInWarsaw(new Date())).replace(".", ",");

  return (
    <>
      <section aria-labelledby="terms-title" className="mt-10 flex flex-col gap-4">
        <h2 id="terms-title" className="text-xl font-semibold">
          {t("termsTitle")}
        </h2>
        <dl className="grid max-w-xl grid-cols-1 gap-x-8 text-sm sm:grid-cols-[auto_1fr] sm:gap-y-2 [&_dd]:mb-2 sm:[&_dd]:mb-0">
          <dt className="text-muted-foreground">{t("term")}</dt>
          <dd>{t("termValue", { months: rules.termMonths })}</dd>
          <dt className="text-muted-foreground">{t("interest")}</dt>
          <dd>{t(`interestOptions.${interest}`)}</dd>
          <dt className="text-muted-foreground">{t("firstRate")}</dt>
          <dd className="tabular-nums">{percent(bond.firstRate)}</dd>
          {bond.margin ? (
            <>
              <dt className="text-muted-foreground">{t("margin")}</dt>
              <dd className="tabular-nums">{percent(bond.margin)}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">{t("fee")}</dt>
          <dd>{t("feeValue", { fee })}</dd>
        </dl>
      </section>

      <section aria-labelledby="rates-title" className="mt-12 flex flex-col gap-5">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 id="rates-title" className="text-xl font-semibold">
            {t("ratesTitle")}
          </h2>
          {rules.rate === "fixed" || rules.follows === "none" ? (
            <p className="text-sm text-muted-foreground">{t("fixedRate")}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{t(`ratesIntro.${rules.follows}`)}</p>
              <p className="text-sm text-muted-foreground">{t("ratesEstimate")}</p>
            </>
          )}
        </div>

        {rules.rate === "floating" ? (
          <>
            {bond.rates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noRates")}</p>
            ) : (
              <DataTable className="max-w-md">
                <Table>
                  <TableCaption className="sr-only">{t("ratesCaption")}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("period")}</TableHead>
                      <TableHead className="text-right">{t("rate")}</TableHead>
                      <TableHead>
                        <span className="sr-only">{t("deleteRate")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bond.rates.map(({ period, rate }) => (
                      <TableRow key={period}>
                        <TableCell>{t("periodOption", { number: period })}</TableCell>
                        <TableCell className="text-right tabular-nums">{percent(rate)}</TableCell>
                        <TableCell className="text-right">
                          <ActionForm
                            action={deleteBondRateAction.bind(null, bond.instrumentId, period)}
                            className="items-end gap-1"
                          >
                            <button
                              type="submit"
                              aria-label={t("deleteRateLabel", { number: period })}
                              className="cursor-pointer underline underline-offset-4"
                            >
                              {t("deleteRate")}
                            </button>
                          </ActionForm>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTable>
            )}

            <div className="max-w-sm">
              <ActionForm action={setBondRateAction.bind(null, bond.instrumentId, bond.series)}>
                <SelectField name="period" label={t("period")} defaultValue="2">
                  {Array.from({ length: periods - 1 }, (_, index) => index + 2).map((number) => (
                    <option key={number} value={number}>
                      {t("periodOption", { number })}
                    </option>
                  ))}
                </SelectField>
                <TextField
                  name="rate"
                  label={t("rate")}
                  inputMode="decimal"
                  autoComplete="off"
                  required
                />
                <SubmitButton className="self-start">{t("saveRate")}</SubmitButton>
              </ActionForm>
            </div>
          </>
        ) : null}
      </section>
    </>
  );
}

import { useTranslations } from "next-intl";
import { formatDate, formatMoney, formatSignedPercent } from "@/lib/format";
import type { PortfolioValuationView } from "@/server/valuation/portfolio-valuation";
import { SignedMoney } from "./signed-money";

const PLN = "PLN";

/** The headline figures of a portfolio: what it is worth and how it has done. */
export function PortfolioSummary({ valuation }: { valuation: PortfolioValuationView }) {
  const t = useTranslations("portfolio.summary");
  const { totals, performance } = valuation;
  const unknown = <span className="text-base text-muted-foreground">{t("unknown")}</span>;

  return (
    <section aria-label={t("title")} className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{t("value")}</p>
        <p className="font-display text-5xl font-semibold tracking-tight tabular-nums">
          {formatMoney(totals.value, PLN)}
        </p>
        <p className="text-sm text-muted-foreground">
          {t("breakdown", {
            holdings: formatMoney(totals.holdingsValue, PLN),
            cash: formatMoney(totals.cashValue, PLN),
            date: formatDate(valuation.date),
          })}
        </p>
        {totals.incomplete ? <p className="text-sm text-destructive">{t("incomplete")}</p> : null}
      </div>

      <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{t("gain")}</dt>
          <dd className="text-2xl font-medium tabular-nums">
            <SignedMoney value={totals.gain} currency={PLN} />
          </dd>
          <dd className="text-sm text-muted-foreground">
            {t("gainParts", {
              unrealized: formatMoney(totals.unrealized, PLN),
              realized: formatMoney(totals.realized, PLN),
              income: formatMoney(totals.income, PLN),
            })}
          </dd>
          {totals.fxEffect.isZero() ? null : (
            <dd className="text-sm text-muted-foreground">
              {t("fxEffect")}: {formatMoney(totals.fxEffect, PLN)}
            </dd>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{t("twr")}</dt>
          <dd className="text-2xl font-medium tabular-nums">
            {performance.twr === null ? unknown : formatSignedPercent(performance.twr)}
          </dd>
          {performance.since ? (
            <dd className="text-sm text-muted-foreground">
              {t("twrHint", { date: formatDate(performance.since) })}
            </dd>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">{t("xirr")}</dt>
          <dd className="text-2xl font-medium tabular-nums">
            {performance.xirr === null ? unknown : formatSignedPercent(performance.xirr)}
          </dd>
          <dd className="text-sm text-muted-foreground">{t("xirrHint")}</dd>
        </div>
      </dl>
    </section>
  );
}

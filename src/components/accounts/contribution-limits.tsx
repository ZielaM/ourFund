import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/format";
import type { ContributionLimitView } from "@/server/accounts/contribution-limits";

const PLN = "PLN";

/** This year's IKE and IKZE contribution limits and how much of them is used. */
export async function ContributionLimits({ limits }: { limits: ContributionLimitView[] }) {
  const t = await getTranslations("limits");
  if (limits.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="limits-title" className="mt-12 flex flex-col gap-4">
      <div className="flex max-w-prose flex-col gap-1">
        <h2 id="limits-title" className="text-xl font-semibold">
          {t("title", { year: limits[0].year })}
        </h2>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {limits.map(({ type, limit, selfEmployedLimit, usage, accounts, noDeposits, next }) => {
          const used = Math.min(
            100,
            Math.round(usage.contributed.div(limit).times(100).toNumber()),
          );

          return (
            <li key={type} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <h3 className="font-sans font-medium">{type}</h3>
              <p className="text-2xl font-semibold tabular-nums">
                {formatMoney(usage.contributed, PLN)}{" "}
                <span className="text-base font-normal text-muted-foreground">
                  {t("of", { limit: formatMoney(limit, PLN) })}
                </span>
              </p>
              <div
                role="meter"
                aria-label={t("meter", { type })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={used}
                aria-valuetext={t("meterValue", { percent: used })}
                className="h-2 overflow-hidden rounded-full bg-muted"
              >
                <div className="h-full rounded-full bg-primary" style={{ width: `${used}%` }} />
              </div>
              {usage.exceeded ? (
                <p className="text-sm font-medium text-destructive">
                  {t("exceeded", {
                    amount: formatMoney(usage.contributed.minus(limit), PLN),
                  })}
                </p>
              ) : (
                <p className="text-sm">
                  {t("remaining", { amount: formatMoney(usage.remaining, PLN) })}
                </p>
              )}
              <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                {selfEmployedLimit ? (
                  <p>{t("selfEmployed", { limit: formatMoney(selfEmployedLimit, PLN) })}</p>
                ) : null}
                {noDeposits ? <p>{t("noDeposits")}</p> : null}
                {usage.incomplete ? <p>{t("incomplete")}</p> : null}
                {accounts.length > 1 ? (
                  <p>
                    {t("accounts", {
                      accounts: accounts
                        .map((account) => `${account.name} (${account.portfolioName})`)
                        .join(", "),
                    })}
                  </p>
                ) : null}
                {next ? (
                  <p>{t("next", { year: next.year, limit: formatMoney(next.limit, PLN) })}</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

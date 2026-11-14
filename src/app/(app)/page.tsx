import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/components/form/action-form";
import { TextField } from "@/components/form/fields";
import { SubmitButton } from "@/components/form/submit-button";
import { PageTitle } from "@/components/layout/page-title";
import { SignedMoney } from "@/components/portfolio/signed-money";
import { Decimal } from "@/domain/decimal";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { listPortfolios } from "@/server/portfolio/portfolios";
import { getPortfolioValuation } from "@/server/valuation/portfolio-valuation";
import { createPortfolioAction } from "./portfolios/actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const db = getDb();
  const portfolios = await listPortfolios(db, user);
  const valuations = await Promise.all(
    portfolios.map((portfolio) => getPortfolioValuation(db, user, portfolio.id)),
  );
  const t = await getTranslations("dashboard");

  const totalValue = valuations.reduce(
    (sum, valuation) => sum.plus(valuation?.totals.value ?? 0),
    new Decimal(0),
  );
  const incomplete = valuations.some((valuation) => valuation?.totals.incomplete);
  const valuationDate = valuations.find((valuation) => valuation)?.date;

  return (
    <>
      <PageTitle>{t("title")}</PageTitle>

      {portfolios.length > 0 && valuationDate ? (
        <section aria-label={t("total.label")} className="mt-10 flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">{t("total.label")}</p>
          <p className="font-display text-5xl font-semibold tracking-tight tabular-nums">
            {formatMoney(totalValue, "PLN")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("total.date", { date: formatDate(valuationDate) })}
          </p>
          {incomplete ? <p className="text-sm text-destructive">{t("total.incomplete")}</p> : null}
        </section>
      ) : null}

      <section aria-labelledby="portfolios-title" className="mt-10 flex flex-col gap-4">
        {portfolios.length === 0 ? (
          <div className="flex max-w-prose flex-col gap-2">
            <h2 id="portfolios-title" className="text-xl font-semibold">
              {t("empty.title")}
            </h2>
            <p className="text-muted-foreground">{t("empty.body")}</p>
          </div>
        ) : (
          <>
            <h2 id="portfolios-title" className="text-xl font-semibold">
              {t("portfolios.title")}
            </h2>
            <ul className="divide-y rounded-lg border bg-card">
              {portfolios.map((portfolio, index) => {
                const totals = valuations[index]?.totals;

                return (
                  <li key={portfolio.id}>
                    <Link
                      href={`/portfolios/${portfolio.id}`}
                      aria-label={t("portfolios.open", { name: portfolio.name })}
                      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-4 transition-colors hover:bg-accent/50"
                    >
                      <span className="flex flex-col gap-0.5">
                        <span className="font-display text-lg font-semibold">{portfolio.name}</span>
                        <span className="text-sm text-muted-foreground">
                          {t("portfolios.accounts", { count: portfolio.accountCount })},{" "}
                          {t("portfolios.transactions", { count: portfolio.transactionCount })}
                        </span>
                      </span>
                      {totals ? (
                        <span className="flex flex-col items-end gap-0.5 tabular-nums">
                          <span className="text-lg font-medium">
                            {formatMoney(totals.value, "PLN")}
                          </span>
                          <span className="text-sm">
                            <SignedMoney value={totals.gain} currency="PLN" />
                          </span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="create-title" className="mt-12 flex max-w-sm flex-col gap-5">
        <h2 id="create-title" className="text-xl font-semibold">
          {t("create.title")}
        </h2>
        <ActionForm action={createPortfolioAction}>
          <TextField name="name" label={t("create.name")} hint={t("create.nameHint")} required />
          <SubmitButton className="self-start">{t("create.submit")}</SubmitButton>
        </ActionForm>
      </section>
    </>
  );
}

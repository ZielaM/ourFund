import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DataTable } from "@/components/layout/data-table";
import { PageTitle } from "@/components/layout/page-title";
import { AllocationList } from "@/components/portfolio/allocation-list";
import { ClosedHoldingsTable, HoldingsTable } from "@/components/portfolio/holdings-table";
import { PortfolioSummary } from "@/components/portfolio/portfolio-summary";
import { TransactionsTable } from "@/components/portfolio/transactions-table";
import { ValueChart } from "@/components/portfolio/value-chart";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { InstrumentType } from "@/domain/portfolio/naming";
import { formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getPortfolio } from "@/server/portfolio/portfolios";
import { listTransactions } from "@/server/portfolio/transactions";
import { getPortfolioValuation } from "@/server/valuation/portfolio-valuation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard.portfolios");
  return { title: t("title") };
}

export default async function PortfolioPage({ params }: PageProps<"/portfolios/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const db = getDb();
  const portfolio = await getPortfolio(db, user, id);

  if (!portfolio) {
    notFound();
  }

  const [valuation, transactions, t, tClasses] = await Promise.all([
    getPortfolioValuation(db, user, id),
    listTransactions(db, user, id),
    getTranslations("portfolio"),
    getTranslations("assetClasses"),
  ]);

  if (!valuation) {
    notFound();
  }

  const open = valuation.holdings.filter((holding) => !holding.quantity.isZero());
  const closed = valuation.holdings.filter((holding) => holding.quantity.isZero());
  const settingsHref = `/portfolios/${portfolio.id}/settings`;
  const hasHistory = valuation.performance.chart.some((point) => point.cost !== 0);
  const classLabel = (key: string) => tClasses(key as InstrumentType | "CASH");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageTitle>{portfolio.name}</PageTitle>
        <Link href={settingsHref} className="text-sm underline underline-offset-4">
          {t("settings")}
        </Link>
      </div>

      {portfolio.accounts.length === 0 ? (
        <section className="mt-10 flex max-w-prose flex-col items-start gap-3">
          <h2 className="text-xl font-semibold">{t("noAccounts.title")}</h2>
          <p className="text-muted-foreground">{t("noAccounts.body")}</p>
          <Link href={settingsHref} className={buttonVariants({ className: "h-10 px-4" })}>
            {t("noAccounts.action")}
          </Link>
        </section>
      ) : (
        <>
          <div className="mt-10">
            <PortfolioSummary valuation={valuation} />
          </div>

          {valuation.missing.rates.length > 0 || valuation.missing.marketPrices.length > 0 ? (
            <div className="mt-6 flex max-w-prose flex-col gap-1 text-sm text-muted-foreground">
              {valuation.missing.rates.length > 0 ? (
                <p>
                  {t("summary.missingRates", { currencies: valuation.missing.rates.join(", ") })}
                </p>
              ) : null}
              {valuation.missing.marketPrices.length > 0 ? (
                <p>
                  {t("summary.missingPrices", {
                    symbols: valuation.missing.marketPrices.join(", "),
                  })}
                </p>
              ) : null}
              <Link
                href="/instruments"
                className="w-fit text-foreground underline underline-offset-4"
              >
                {t("summary.refreshLink")}
              </Link>
            </div>
          ) : null}

          <section aria-labelledby="chart-title" className="mt-12 flex flex-col gap-4">
            <h2 id="chart-title" className="text-xl font-semibold">
              {t("chart.title")}
            </h2>
            {hasHistory ? (
              <div className="rounded-lg border bg-card p-4 sm:p-5">
                <ValueChart points={valuation.performance.chart} />
              </div>
            ) : (
              <p className="text-muted-foreground">{t("chart.empty")}</p>
            )}
          </section>

          <section aria-labelledby="holdings-title" className="mt-12 flex flex-col gap-4">
            <h2 id="holdings-title" className="text-xl font-semibold">
              {t("holdings.title")}
            </h2>
            {open.length === 0 ? (
              <p className="text-muted-foreground">{t("holdings.empty")}</p>
            ) : (
              <HoldingsTable holdings={open} />
            )}
            {closed.length > 0 ? (
              <details className="group">
                <summary className="w-fit cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  {t("holdings.closedTitle", { count: closed.length })}
                </summary>
                <div className="mt-3">
                  <ClosedHoldingsTable holdings={closed} />
                </div>
              </details>
            ) : null}
          </section>

          {valuation.allocation.byClass.length > 0 ? (
            <section aria-labelledby="allocation-title" className="mt-12 flex flex-col gap-5">
              <h2 id="allocation-title" className="text-xl font-semibold">
                {t("allocation.title")}
              </h2>
              <div className="grid gap-x-10 gap-y-8 md:grid-cols-3">
                <AllocationList
                  title={t("allocation.byClass")}
                  slices={valuation.allocation.byClass}
                  label={classLabel}
                />
                <AllocationList
                  title={t("allocation.byCurrency")}
                  slices={valuation.allocation.byCurrency}
                  label={(key) => key}
                />
                <AllocationList
                  title={t("allocation.byAccount")}
                  slices={valuation.allocation.byAccount}
                  label={(key) => key}
                />
              </div>
            </section>
          ) : null}

          {valuation.cash.length > 0 ? (
            <section aria-labelledby="cash-title" className="mt-12 flex flex-col gap-4">
              <h2 id="cash-title" className="text-xl font-semibold">
                {t("cash.title")}
              </h2>
              <DataTable className="max-w-xl">
                <Table>
                  <TableCaption className="sr-only">{t("cash.caption")}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("cash.account")}</TableHead>
                      <TableHead className="text-right">{t("cash.balance")}</TableHead>
                      <TableHead className="text-right">{t("cash.value")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {valuation.cash.map((balance) => (
                      <TableRow key={`${balance.accountId}-${balance.currency}`}>
                        <TableCell>{balance.accountName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={balance.balance.lt(0) ? "text-loss" : undefined}>
                            {formatMoney(balance.balance, balance.currency)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {balance.value ? (
                            formatMoney(balance.value, "PLN")
                          ) : (
                            <span className="text-muted-foreground">{t("holdings.unknown")}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTable>
              {valuation.cash.some((balance) => balance.balance.lt(0)) ? (
                <p className="text-sm text-muted-foreground">{t("cash.negativeHint")}</p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="transactions-title" className="mt-12 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 id="transactions-title" className="text-xl font-semibold">
                {t("transactions.title")}
              </h2>
              <Link
                href={`/portfolios/${portfolio.id}/transactions/new`}
                className={buttonVariants({ className: "h-10 px-4" })}
              >
                {t("transactions.add")}
              </Link>
            </div>
            {transactions && transactions.length > 0 ? (
              <TransactionsTable transactions={transactions} />
            ) : (
              <p className="text-muted-foreground">{t("transactions.empty")}</p>
            )}
          </section>
        </>
      )}
    </>
  );
}

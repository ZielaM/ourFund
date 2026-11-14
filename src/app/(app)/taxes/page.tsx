import { cn } from "cn";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { DataTable } from "@/components/layout/data-table";
import { PageTitle } from "@/components/layout/page-title";
import { SignedMoney } from "@/components/portfolio/signed-money";
import { IncomeTable } from "@/components/tax/income-table";
import { SalesTable } from "@/components/tax/sales-table";
import { Statement, TaxAmount } from "@/components/tax/statement";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getTaxReport } from "@/server/tax/tax-report";

const PLN = "PLN";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("tax");
  return { title: t("title") };
}

export default async function TaxesPage({ searchParams }: PageProps<"/taxes">) {
  const user = await requireUser();
  const { year: yearParam } = await searchParams;
  const requested =
    typeof yearParam === "string" && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  const [view, t, tTypes] = await Promise.all([
    getTaxReport(getDb(), user, requested),
    getTranslations("tax"),
    getTranslations("accountTypes"),
  ]);
  const { report, year } = view;
  const money = (value: Parameters<typeof formatMoney>[0] | null) =>
    value ? formatMoney(value, PLN) : t("unknown");

  const hasCrypto =
    report !== null && (report.crypto.lines.length > 0 || !report.crypto.carriedCosts?.isZero());
  const hasDomestic = report !== null && report.domesticIncome.lines.length > 0;
  const hasBonds = report !== null && report.savingsBonds.sales.length > 0;
  const loss = report?.securities.income?.isNegative() ?? false;

  return (
    <>
      <PageTitle>{t("title")}</PageTitle>

      {report === null ? (
        <section className="mt-10 flex max-w-prose flex-col gap-3">
          <h2 className="text-xl font-semibold">{t("empty.title")}</h2>
          <p className="text-muted-foreground">{t("empty.body")}</p>
        </section>
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-4">
            <nav aria-label={t("years")} className="flex flex-wrap gap-1.5">
              {view.years.map((candidate) => (
                <Link
                  key={candidate}
                  href={{ pathname: "/taxes", query: { year: candidate } }}
                  aria-current={candidate === year ? "page" : undefined}
                  aria-label={t("yearLabel", { year: candidate })}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-sm font-medium tabular-nums transition-colors",
                    candidate === year
                      ? "border-primary bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:text-foreground",
                  )}
                >
                  {candidate}
                </Link>
              ))}
            </nav>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              {t("heading", { year })}
            </h2>
            <div className="flex max-w-prose flex-col gap-2 text-sm text-muted-foreground">
              <p>{t("intro")}</p>
              <p>{t("method")}</p>
            </div>
          </div>

          {report.missingRates.length > 0 ? (
            <div className="mt-6 flex max-w-prose flex-col gap-1 text-sm">
              <p className="text-destructive">
                {t("missingRates", { currencies: report.missingRates.join(", ") })}
              </p>
              <Link href="/instruments" className="w-fit underline underline-offset-4">
                {t("refreshLink")}
              </Link>
            </div>
          ) : null}

          {report.empty ? <p className="mt-8 max-w-prose">{t("nothing", { year })}</p> : null}

          <section aria-labelledby="securities-title" className="mt-12 flex flex-col gap-4">
            <h2 id="securities-title" className="text-xl font-semibold">
              {t("securities.title")}
            </h2>
            <p className="max-w-prose text-sm text-muted-foreground">{t("securities.intro")}</p>
            {report.securities.sales.length > 0 ? (
              <>
                <Statement
                  rows={[
                    { label: t("securities.revenue"), value: report.securities.revenue },
                    { label: t("securities.costs"), value: report.securities.costs },
                    {
                      label: loss ? t("securities.loss") : t("securities.income"),
                      value: report.securities.income?.abs() ?? null,
                    },
                    { label: t("securities.tax"), value: report.securities.tax, total: true },
                  ]}
                />
                <SalesTable
                  sales={report.securities.sales}
                  year={year}
                  instruments={view.instruments}
                  accounts={view.accounts}
                />
              </>
            ) : (
              <p className="text-sm">{t("securities.none")}</p>
            )}

            {view.earlierYears.length > 0 ? (
              <div className="mt-2 flex max-w-md flex-col gap-2">
                <h3 className="font-medium">{t("securities.earlier")}</h3>
                <DataTable>
                  <Table>
                    <TableCaption className="sr-only">
                      {t("securities.earlierCaption")}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("securities.year")}</TableHead>
                        <TableHead className="text-right">{t("securities.result")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.earlierYears.map((earlier) => (
                        <TableRow key={earlier.year}>
                          <TableCell className="tabular-nums">{earlier.year}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {earlier.income ? (
                              <SignedMoney value={earlier.income} currency={PLN} />
                            ) : (
                              <TaxAmount value={null} />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </DataTable>
                <p className="text-sm text-muted-foreground">{t("securities.earlierHint")}</p>
              </div>
            ) : null}
          </section>

          {report.foreignIncome.lines.length > 0 ? (
            <section aria-labelledby="foreign-title" className="mt-12 flex flex-col gap-4">
              <h2 id="foreign-title" className="text-xl font-semibold">
                {t("foreign.title")}
              </h2>
              <p className="max-w-prose text-sm text-muted-foreground">{t("foreign.intro")}</p>
              <Statement
                rows={[
                  { label: t("foreign.gross"), value: report.foreignIncome.gross },
                  { label: t("foreign.taxDue"), value: report.foreignIncome.taxDue },
                  { label: t("foreign.paidAbroad"), value: report.foreignIncome.paidAbroad },
                  {
                    label: t("foreign.deductible"),
                    value: report.foreignIncome.deductible,
                    part: true,
                  },
                  { label: t("foreign.toPay"), value: report.foreignIncome.toPay, total: true },
                ]}
              >
                <p className="text-sm text-muted-foreground">{t("foreign.deductibleHint")}</p>
              </Statement>
              <IncomeTable
                lines={report.foreignIncome.lines}
                year={year}
                instruments={view.instruments}
              />
            </section>
          ) : null}

          {hasCrypto ? (
            <section aria-labelledby="crypto-title" className="mt-12 flex flex-col gap-4">
              <h2 id="crypto-title" className="text-xl font-semibold">
                {t("crypto.title")}
              </h2>
              <p className="max-w-prose text-sm text-muted-foreground">{t("crypto.intro")}</p>
              <Statement
                rows={[
                  { label: t("crypto.revenue"), value: report.crypto.revenue },
                  { label: t("crypto.costs"), value: report.crypto.costs },
                  { label: t("crypto.carried"), value: report.crypto.carriedCosts },
                  { label: t("crypto.income"), value: report.crypto.income },
                  { label: t("crypto.carryForward"), value: report.crypto.carryForward },
                  { label: t("crypto.tax"), value: report.crypto.tax, total: true },
                ]}
              />
            </section>
          ) : null}

          {hasDomestic || hasBonds || view.excludedAccounts.length > 0 ? (
            <section aria-labelledby="outside-title" className="mt-12 flex flex-col gap-4">
              <h2 id="outside-title" className="text-xl font-semibold">
                {t("outside.title")}
              </h2>
              <p className="max-w-prose text-sm text-muted-foreground">{t("outside.intro")}</p>
              <dl className="flex max-w-prose flex-col gap-4 text-sm">
                {hasDomestic ? (
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium">{t("outside.domestic")}</dt>
                    <dd className="text-muted-foreground">
                      {t("outside.domesticBody", {
                        gross: money(report.domesticIncome.gross),
                        withheld: money(report.domesticIncome.withheld),
                      })}
                    </dd>
                  </div>
                ) : null}
                {hasBonds ? (
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium">{t("outside.bonds")}</dt>
                    <dd className="text-muted-foreground">
                      {t("outside.bondsBody", { income: money(report.savingsBonds.income) })}
                    </dd>
                  </div>
                ) : null}
                {view.excludedAccounts.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <dt className="font-medium">{t("outside.accounts")}</dt>
                    <dd className="text-muted-foreground">
                      {t("outside.accountsBody", {
                        accounts: view.excludedAccounts
                          .map((account) =>
                            t("outside.accountEntry", {
                              name: account.name,
                              type: tTypes(account.type),
                              portfolio: account.portfolioName,
                            }),
                          )
                          .join(", "),
                      })}
                    </dd>
                    {view.excludedAccounts.some((account) => account.type === "OKI") ? (
                      <dd className="text-muted-foreground">{t("outside.oki")}</dd>
                    ) : null}
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

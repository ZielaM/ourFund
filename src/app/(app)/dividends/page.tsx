import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MonthBars } from "@/components/income/month-bars";
import { DataTable } from "@/components/layout/data-table";
import { PageTitle } from "@/components/layout/page-title";
import { YearNav } from "@/components/layout/year-nav";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Decimal } from "@/domain/decimal";
import { formatDate, formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getIncomeHistory } from "@/server/income/income-history";

const PLN = "PLN";
const monthName = (month: number, width: "short" | "long") =>
  new Intl.DateTimeFormat("pl-PL", { month: width, timeZone: "UTC" }).format(
    new Date(Date.UTC(2024, month - 1, 1)),
  );

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("income");
  return { title: t("title") };
}

export default async function DividendsPage({ searchParams }: PageProps<"/dividends">) {
  const user = await requireUser();
  const { year: yearParam } = await searchParams;
  const requested =
    typeof yearParam === "string" && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  const [view, t, tTypes] = await Promise.all([
    getIncomeHistory(getDb(), user, requested),
    getTranslations("income"),
    getTranslations("transactionTypes"),
  ]);
  const { year } = view;
  const unknown = <span className="text-muted-foreground">{t("unknown")}</span>;
  const pln = (value: Decimal | null) => (value ? formatMoney(value, PLN) : unknown);
  const sourceOf = (instrumentId: string | null) =>
    instrumentId ? view.instruments[instrumentId] : null;

  return (
    <>
      <PageTitle>{t("title")}</PageTitle>

      {view.years.length === 0 ? (
        <section className="mt-10 flex max-w-prose flex-col gap-3">
          <h2 className="text-xl font-semibold">{t("empty.title")}</h2>
          <p className="text-muted-foreground">{t("empty.body")}</p>
        </section>
      ) : (
        <>
          <div className="mt-8">
            <YearNav
              pathname="/dividends"
              years={view.years}
              current={year}
              label={t("years")}
              yearLabel={(candidate) => t("yearLabel", { year: candidate })}
            />
          </div>

          <section aria-label={t("summary.title")} className="mt-8 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">{t("summary.received", { year })}</p>
            <p className="font-display text-5xl font-semibold tracking-tight tabular-nums">
              {view.total ? (
                formatMoney(view.total, PLN)
              ) : (
                <span className="text-base font-normal text-muted-foreground">{t("unknown")}</span>
              )}
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              {t("summary.hint", {
                allTime: view.allTime ? formatMoney(view.allTime, PLN) : t("unknown"),
              })}
            </p>
          </section>

          {view.missingRates.length > 0 ? (
            <div className="mt-6 flex max-w-prose flex-col gap-1 text-sm">
              <p className="text-destructive">
                {t("missingRates", { currencies: view.missingRates.join(", ") })}
              </p>
              <Link href="/instruments" className="w-fit underline underline-offset-4">
                {t("refreshLink")}
              </Link>
            </div>
          ) : null}

          <section aria-labelledby="months-title" className="mt-12 flex flex-col gap-4">
            <h2 id="months-title" className="text-xl font-semibold">
              {t("months.title")}
            </h2>
            <div className="rounded-lg border bg-card p-4 sm:p-5">
              <MonthBars
                bars={view.months.map(({ month, net }) => ({
                  label: monthName(month, "short"),
                  name: monthName(month, "long"),
                  value: net ? net.toNumber() : null,
                }))}
                description={t("months.description", { year })}
                valueLabel={t("net")}
                periodLabel={t("months.month")}
                tableLabel={t("months.table")}
                unknownLabel={t("unknown")}
              />
            </div>
          </section>

          {view.payments.length === 0 ? (
            <p className="mt-8 max-w-prose">{t("nothing", { year })}</p>
          ) : (
            <>
              <section aria-labelledby="sources-title" className="mt-12 flex flex-col gap-4">
                <h2 id="sources-title" className="text-xl font-semibold">
                  {t("sources.title")}
                </h2>
                <DataTable className="max-w-2xl">
                  <Table>
                    <TableCaption className="sr-only">
                      {t("sources.caption", { year })}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("source")}</TableHead>
                        <TableHead className="text-right">{t("sources.count")}</TableHead>
                        <TableHead className="text-right">{t("net")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.byInstrument.map((group) => {
                        const source = sourceOf(group.instrumentId);
                        return (
                          <TableRow key={group.instrumentId ?? "cash"}>
                            <TableCell>
                              {source ? (
                                <>
                                  <span className="font-medium">{source.symbol}</span>{" "}
                                  <span className="hidden text-muted-foreground sm:inline">
                                    {source.name}
                                  </span>
                                </>
                              ) : (
                                <span className="font-medium">{t("cashInterest")}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{group.count}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {pln(group.net)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </DataTable>
              </section>

              <section aria-labelledby="payments-title" className="mt-12 flex flex-col gap-4">
                <h2 id="payments-title" className="text-xl font-semibold">
                  {t("payments.title")}
                </h2>
                <DataTable>
                  <Table>
                    <TableCaption className="sr-only">
                      {t("payments.caption", { year })}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("payments.date")}</TableHead>
                        <TableHead>{t("source")}</TableHead>
                        <TableHead>{t("payments.account")}</TableHead>
                        <TableHead className="text-right">{t("payments.gross")}</TableHead>
                        <TableHead className="text-right">{t("payments.tax")}</TableHead>
                        <TableHead className="text-right">{t("net")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {view.payments.map((payment) => (
                        <TableRow key={payment.transactionId}>
                          <TableCell className="tabular-nums">{formatDate(payment.date)}</TableCell>
                          <TableCell>
                            <span className="font-medium">
                              {sourceOf(payment.instrumentId)?.symbol ?? t("cashInterest")}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {tTypes(payment.kind)}
                            </span>
                          </TableCell>
                          <TableCell>{view.accounts[payment.accountId].name}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(payment.gross, payment.currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(payment.tax, payment.currency)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {pln(payment.netPln)}
                            {payment.currency !== PLN ? (
                              <span className="block text-xs text-muted-foreground">
                                {formatMoney(payment.net, payment.currency)}
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </DataTable>
              </section>
            </>
          )}

          {view.byYear.length > 1 ? (
            <section aria-labelledby="years-title" className="mt-12 flex flex-col gap-4">
              <h2 id="years-title" className="text-xl font-semibold">
                {t("byYear.title")}
              </h2>
              <DataTable className="max-w-md">
                <Table>
                  <TableCaption className="sr-only">{t("byYear.caption")}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("byYear.year")}</TableHead>
                      <TableHead className="text-right">{t("net")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...view.byYear].reverse().map((entry) => (
                      <TableRow key={entry.year}>
                        <TableCell className="tabular-nums">{entry.year}</TableCell>
                        <TableCell className="text-right tabular-nums">{pln(entry.net)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTable>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

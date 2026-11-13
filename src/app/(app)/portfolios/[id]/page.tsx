import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { DataTable } from "@/components/layout/data-table";
import { PageTitle } from "@/components/layout/page-title";
import { HoldingsTable } from "@/components/portfolio/holdings-table";
import { TransactionsTable } from "@/components/portfolio/transactions-table";
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
import { formatMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db/client";
import { getPortfolioHoldings } from "@/server/portfolio/holdings";
import { getPortfolio } from "@/server/portfolio/portfolios";
import { listTransactions } from "@/server/portfolio/transactions";

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

  const [holdings, transactions, t] = await Promise.all([
    getPortfolioHoldings(db, user, id),
    listTransactions(db, user, id),
    getTranslations("portfolio"),
  ]);
  const open = holdings?.holdings.filter((holding) => !holding.quantity.isZero()) ?? [];
  const closed = holdings?.holdings.filter((holding) => holding.quantity.isZero()) ?? [];
  const cash = holdings?.cash ?? [];
  const settingsHref = `/portfolios/${portfolio.id}/settings`;

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
          <section aria-labelledby="holdings-title" className="mt-10 flex flex-col gap-4">
            <h2 id="holdings-title" className="text-xl font-semibold">
              {t("holdings.title")}
            </h2>
            {open.length === 0 ? (
              <p className="text-muted-foreground">{t("holdings.empty")}</p>
            ) : (
              <HoldingsTable holdings={open} caption={t("holdings.caption")} />
            )}
            {closed.length > 0 ? (
              <details className="group">
                <summary className="w-fit cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  {t("holdings.closedTitle", { count: closed.length })}
                </summary>
                <div className="mt-3">
                  <HoldingsTable holdings={closed} caption={t("holdings.closedCaption")} closed />
                </div>
              </details>
            ) : null}
          </section>

          {cash.length > 0 ? (
            <section aria-labelledby="cash-title" className="mt-12 flex flex-col gap-4">
              <h2 id="cash-title" className="text-xl font-semibold">
                {t("cash.title")}
              </h2>
              <DataTable className="max-w-md">
                <Table>
                  <TableCaption className="sr-only">{t("cash.caption")}</TableCaption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("cash.account")}</TableHead>
                      <TableHead className="text-right">{t("cash.balance")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cash.map((balance) => (
                      <TableRow key={`${balance.accountId}-${balance.currency}`}>
                        <TableCell>{balance.accountName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={balance.balance.lt(0) ? "text-loss" : undefined}>
                            {formatMoney(balance.balance, balance.currency)}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DataTable>
              {cash.some((balance) => balance.balance.lt(0)) ? (
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

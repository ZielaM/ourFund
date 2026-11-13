import Link from "next/link";
import { useTranslations } from "next-intl";
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
import { formatDate, formatPrice, formatQuantity } from "@/lib/format";
import type { TransactionView } from "@/server/portfolio/transactions";
import { SignedMoney } from "./signed-money";

export function TransactionsTable({ transactions }: { transactions: TransactionView[] }) {
  const t = useTranslations("portfolio.transactions");
  const tTypes = useTranslations("transactionTypes");

  return (
    <DataTable>
      <Table>
        <TableCaption className="sr-only">{t("caption")}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("date")}</TableHead>
            <TableHead>{t("account")}</TableHead>
            <TableHead>{t("type")}</TableHead>
            <TableHead>{t("instrument")}</TableHead>
            <TableHead className="text-right">{t("quantity")}</TableHead>
            <TableHead className="text-right">{t("price")}</TableHead>
            <TableHead className="text-right">{t("cash")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("edit")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {transactions.map((transaction) => (
            <TableRow key={transaction.id}>
              <TableCell className="tabular-nums">{formatDate(transaction.date)}</TableCell>
              <TableCell>{transaction.accountName}</TableCell>
              <TableCell>{tTypes(transaction.type)}</TableCell>
              <TableCell className="font-medium">{transaction.instrument?.symbol ?? "–"}</TableCell>
              <TableCell className="text-right tabular-nums">
                {transaction.quantity ? formatQuantity(transaction.quantity) : "–"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {transaction.price && transaction.instrument
                  ? `${formatPrice(transaction.price)} ${transaction.instrument.currency}`
                  : "–"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {transaction.cash ? (
                  <SignedMoney
                    value={transaction.cash.amount}
                    currency={transaction.cash.currency}
                  />
                ) : (
                  "–"
                )}
              </TableCell>
              <TableCell className="text-right">
                <Link
                  href={`/portfolios/${transaction.portfolioId}/transactions/${transaction.id}`}
                  aria-label={t("editTransaction", {
                    type: tTypes(transaction.type),
                    date: formatDate(transaction.date),
                  })}
                  className="underline underline-offset-4"
                >
                  {t("edit")}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
}

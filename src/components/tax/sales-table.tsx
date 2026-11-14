import { useTranslations } from "next-intl";
import { DataTable } from "@/components/layout/data-table";
import { SignedMoney } from "@/components/portfolio/signed-money";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SaleLine } from "@/domain/tax/pit38";
import { formatDate, formatQuantity } from "@/lib/format";
import type { TaxReportView } from "@/server/tax/tax-report";
import { TaxAmount } from "./statement";

type SalesTableProps = {
  sales: SaleLine[];
  year: number;
  instruments: TaxReportView["instruments"];
  accounts: TaxReportView["accounts"];
};

/** Every sale of the year with its revenue and the cost of the units sold. */
export function SalesTable({ sales, year, instruments, accounts }: SalesTableProps) {
  const t = useTranslations("tax.securities");

  return (
    <DataTable>
      <Table>
        <TableCaption className="sr-only">{t("caption", { year })}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("date")}</TableHead>
            <TableHead>{t("instrument")}</TableHead>
            <TableHead>{t("account")}</TableHead>
            <TableHead className="text-right">{t("quantity")}</TableHead>
            <TableHead className="text-right">{t("revenue")}</TableHead>
            <TableHead className="text-right">{t("costsShort")}</TableHead>
            <TableHead className="text-right">{t("result")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.map((sale) => (
            <TableRow key={sale.transactionId}>
              <TableCell className="tabular-nums">{formatDate(sale.date)}</TableCell>
              <TableCell>
                <span className="font-medium">{instruments[sale.instrumentId].symbol}</span>
                <span className="block text-xs text-muted-foreground">
                  {t("acquired", { date: formatDate(sale.acquiredFrom) })}
                </span>
              </TableCell>
              <TableCell>{accounts[sale.accountId].name}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatQuantity(sale.quantity)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <TaxAmount value={sale.revenue} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <TaxAmount value={sale.costs} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {sale.income ? (
                  <SignedMoney value={sale.income} currency="PLN" />
                ) : (
                  <TaxAmount value={null} />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
}

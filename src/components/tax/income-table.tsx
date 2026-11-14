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
import type { IncomeLine } from "@/domain/tax/pit38";
import { formatDate, formatMoney, formatPrice } from "@/lib/format";
import type { TaxReportView } from "@/server/tax/tax-report";
import { TaxAmount } from "./statement";

type IncomeTableProps = {
  lines: IncomeLine[];
  year: number;
  instruments: TaxReportView["instruments"];
};

/** Dividends and interest from abroad, each with the NBP rate it was converted at. */
export function IncomeTable({ lines, year, instruments }: IncomeTableProps) {
  const t = useTranslations("tax.foreign");

  return (
    <DataTable>
      <Table>
        <TableCaption className="sr-only">{t("caption", { year })}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("date")}</TableHead>
            <TableHead>{t("source")}</TableHead>
            <TableHead className="text-right">{t("amount")}</TableHead>
            <TableHead className="text-right">{t("rate")}</TableHead>
            <TableHead className="text-right">{t("grossPln")}</TableHead>
            <TableHead className="text-right">{t("withheld")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.transactionId}>
              <TableCell className="tabular-nums">{formatDate(line.date)}</TableCell>
              <TableCell className="font-medium">
                {line.instrumentId ? instruments[line.instrumentId].symbol : t("cashInterest")}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(line.grossOriginal, line.currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {line.rate ? (
                  <>
                    {formatPrice(line.rate.value)}
                    <span className="block text-xs text-muted-foreground">
                      {t("rateFrom", { date: formatDate(line.rate.date) })}
                    </span>
                  </>
                ) : line.gross ? null : (
                  <TaxAmount value={null} />
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <TaxAmount value={line.gross} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <TaxAmount value={line.withheld} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
}

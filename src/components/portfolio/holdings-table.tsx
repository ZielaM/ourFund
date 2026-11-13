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
import { formatMoney, formatPrice, formatQuantity } from "@/lib/format";
import type { HoldingView } from "@/server/portfolio/holdings";
import { SignedMoney } from "./signed-money";

type HoldingsTableProps = {
  holdings: HoldingView[];
  caption: string;
  /** Closed positions have no quantity or cost left to show. */
  closed?: boolean;
};

export function HoldingsTable({ holdings, caption, closed = false }: HoldingsTableProps) {
  const t = useTranslations("portfolio.holdings");

  return (
    <DataTable>
      <Table>
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("instrument")}</TableHead>
            {closed ? null : (
              <>
                <TableHead className="text-right">{t("quantity")}</TableHead>
                <TableHead className="text-right">{t("averageCost")}</TableHead>
                <TableHead className="text-right">{t("costBasis")}</TableHead>
              </>
            )}
            <TableHead className="text-right">{t("realizedGain")}</TableHead>
            <TableHead className="text-right">{t("income")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((holding) => {
            const { instrument } = holding;
            const income = Object.entries(holding.income);

            return (
              <TableRow key={instrument.id}>
                <TableCell>
                  <span className="font-medium">{instrument.symbol}</span>{" "}
                  <span className="text-muted-foreground">{instrument.name}</span>
                </TableCell>
                {closed ? null : (
                  <>
                    <TableCell className="text-right tabular-nums">
                      {formatQuantity(holding.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {holding.averageCost
                        ? `${formatPrice(holding.averageCost)} ${instrument.currency}`
                        : "–"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(holding.costBasis, instrument.currency)}
                    </TableCell>
                  </>
                )}
                <TableCell className="text-right tabular-nums">
                  <SignedMoney value={holding.realizedGain} currency={instrument.currency} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {income.length === 0
                    ? "–"
                    : income.map(([currency, amount]) => formatMoney(amount, currency)).join(", ")}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTable>
  );
}

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
import {
  formatDate,
  formatMoney,
  formatPrice,
  formatQuantity,
  formatSignedPercent,
} from "@/lib/format";
import type { ValuedHolding } from "@/server/valuation/portfolio-valuation";
import { SignedMoney } from "./signed-money";

const PLN = "PLN";

function Instrument({ holding }: { holding: ValuedHolding }) {
  return (
    <>
      <span className="font-medium">{holding.instrument.symbol}</span>{" "}
      <span className="text-muted-foreground">{holding.instrument.name}</span>
    </>
  );
}

/** Open positions valued in PLN. */
export function HoldingsTable({ holdings }: { holdings: ValuedHolding[] }) {
  const t = useTranslations("portfolio.holdings");
  const hasForeign = holdings.some((holding) => holding.instrument.currency !== PLN);
  const hasIncome = holdings.some((holding) => holding.income && !holding.income.isZero());
  const unknown = <span className="text-muted-foreground">{t("unknown")}</span>;

  return (
    <DataTable>
      <Table>
        <TableCaption className="sr-only">{t("caption")}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("instrument")}</TableHead>
            <TableHead className="text-right">{t("quantity")}</TableHead>
            <TableHead className="text-right">{t("price")}</TableHead>
            <TableHead className="text-right">{t("value")}</TableHead>
            <TableHead className="text-right">{t("cost")}</TableHead>
            <TableHead className="text-right">{t("unrealized")}</TableHead>
            {hasForeign ? <TableHead className="text-right">{t("fxEffect")}</TableHead> : null}
            {hasIncome ? <TableHead className="text-right">{t("income")}</TableHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((holding) => {
            const { instrument, price } = holding;
            const returnOnCost =
              holding.unrealized && holding.cost?.gt(0)
                ? holding.unrealized.div(holding.cost).toNumber()
                : null;

            return (
              <TableRow key={instrument.id} className="align-top">
                <TableCell>
                  <Instrument holding={holding} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatQuantity(holding.quantity)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {price ? (
                    <>
                      {formatPrice(price.close)} {instrument.currency}
                      <span className="block text-xs text-muted-foreground">
                        {price.fromTrade ? t("priceFromTrade") : formatDate(price.date)}
                      </span>
                    </>
                  ) : (
                    unknown
                  )}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {holding.value ? formatMoney(holding.value, PLN) : unknown}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {holding.cost ? formatMoney(holding.cost, PLN) : unknown}
                  {holding.averageCost ? (
                    <span className="block text-xs text-muted-foreground">
                      {t("averageCost", {
                        price: `${formatPrice(holding.averageCost)} ${instrument.currency}`,
                      })}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {holding.unrealized ? (
                    <>
                      <SignedMoney value={holding.unrealized} currency={PLN} />
                      {returnOnCost !== null ? (
                        <span className="block text-xs text-muted-foreground">
                          {formatSignedPercent(returnOnCost)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    unknown
                  )}
                </TableCell>
                {hasForeign ? (
                  <TableCell className="text-right tabular-nums">
                    {instrument.currency === PLN ? (
                      "–"
                    ) : holding.fxEffect ? (
                      <SignedMoney value={holding.fxEffect} currency={PLN} />
                    ) : (
                      unknown
                    )}
                  </TableCell>
                ) : null}
                {hasIncome ? (
                  <TableCell className="text-right tabular-nums">
                    {holding.income ? formatMoney(holding.income, PLN) : unknown}
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </DataTable>
  );
}

/** Positions that were sold out: only their results remain. */
export function ClosedHoldingsTable({ holdings }: { holdings: ValuedHolding[] }) {
  const t = useTranslations("portfolio.holdings");
  const unknown = <span className="text-muted-foreground">{t("unknown")}</span>;

  return (
    <DataTable className="max-w-2xl">
      <Table>
        <TableCaption className="sr-only">{t("closedCaption")}</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("instrument")}</TableHead>
            <TableHead className="text-right">{t("realized")}</TableHead>
            <TableHead className="text-right">{t("income")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {holdings.map((holding) => (
            <TableRow key={holding.instrument.id}>
              <TableCell>
                <Instrument holding={holding} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {holding.realized ? (
                  <SignedMoney value={holding.realized} currency={PLN} />
                ) : (
                  unknown
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {holding.income ? formatMoney(holding.income, PLN) : unknown}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </DataTable>
  );
}

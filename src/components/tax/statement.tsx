import { cn } from "cn";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Decimal } from "@/domain/decimal";
import { formatMoney } from "@/lib/format";

const PLN = "PLN";

/** An amount in PLN, or a note that it could not be converted for lack of an NBP rate. */
export function TaxAmount({ value }: { value: Decimal | null }) {
  const t = useTranslations("tax");

  return value ? (
    formatMoney(value, PLN)
  ) : (
    <span className="font-normal text-muted-foreground">{t("unknown")}</span>
  );
}

export type StatementRow = {
  label: string;
  value: Decimal | null;
  /** A component of the row above it. */
  part?: boolean;
  /** The figure the section leads to; set apart by a double rule, as a total in a ledger. */
  total?: boolean;
};

/** A column of figures the way a return lists them: label on the left, amount on the right. */
export function Statement({ rows, children }: { rows: StatementRow[]; children?: ReactNode }) {
  return (
    <div className="flex max-w-md flex-col gap-3">
      <dl className="rounded-lg border bg-card text-sm">
        {rows.map((row) => (
          <div
            key={row.label}
            className={cn(
              "flex items-baseline justify-between gap-6 px-4 py-2.5",
              row.total
                ? "border-t-[3px] border-double border-primary text-base font-semibold"
                : "not-first:border-t",
            )}
          >
            <dt className={cn(row.part && "pl-4 text-muted-foreground")}>{row.label}</dt>
            <dd className="text-right tabular-nums">
              <TaxAmount value={row.value} />
            </dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}

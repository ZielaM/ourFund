import { cn } from "cn";
import type { Decimal } from "@/domain/decimal";
import { formatMoney } from "@/lib/format";

/** A gain or loss: coloured, and with an explicit sign so colour is not the only cue. */
export function SignedMoney({ value, currency }: { value: Decimal; currency: string }) {
  const sign = value.gt(0) ? "+" : "";

  return (
    <span className={cn(value.gt(0) && "text-gain", value.lt(0) && "text-loss")}>
      {sign}
      {formatMoney(value, currency)}
    </span>
  );
}

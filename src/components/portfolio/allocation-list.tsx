import type { AllocationSlice } from "@/domain/valuation/valuation";
import { formatMoney, formatShare } from "@/lib/format";

type AllocationListProps = {
  title: string;
  slices: AllocationSlice[];
  /** Turns a slice key (e.g. "STOCK") into the name shown to the user. */
  label: (key: string) => string;
};

/** One split of the portfolio: a name, an aligned bar and the share for each part. */
export function AllocationList({ title, slices, label }: AllocationListProps) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="font-sans text-sm font-medium">{title}</h3>
      <ul className="flex flex-col gap-3">
        {slices.map((slice) => (
          <li key={slice.key} className="flex flex-col gap-1 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span>{label(slice.key)}</span>
              <span className="tabular-nums">
                <span className="font-medium">{formatShare(slice.share)}</span>{" "}
                <span className="text-muted-foreground">{formatMoney(slice.value, "PLN")}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
              <div
                className="h-full rounded-full bg-[var(--chart-value)]"
                style={{ width: `${Math.max(slice.share * 100, 1)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

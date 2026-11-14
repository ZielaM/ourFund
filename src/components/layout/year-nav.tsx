import { cn } from "cn";
import Link from "next/link";

type YearNavProps = {
  /** The page the links lead to; the year goes into its `year` query parameter. */
  pathname: string;
  years: number[];
  current: number;
  /** Accessible name of the list of years. */
  label: string;
  /** Accessible name of one link, e.g. "Rok 2026". */
  yearLabel: (year: number) => string;
};

/** Switches a yearly report between years. */
export function YearNav({ pathname, years, current, label, yearLabel }: YearNavProps) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {years.map((year) => (
        <Link
          key={year}
          href={{ pathname, query: { year } }}
          aria-current={year === current ? "page" : undefined}
          aria-label={yearLabel(year)}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm font-medium tabular-nums transition-colors",
            year === current
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {year}
        </Link>
      ))}
    </nav>
  );
}

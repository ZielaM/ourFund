"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompact, formatPln } from "@/lib/format";

export type MonthBar = {
  /** Short name for the axis, e.g. "mar". */
  label: string;
  /** Full name for the tooltip and the table, e.g. "marzec". */
  name: string;
  /** Amount in PLN; null when it could not be computed. */
  value: number | null;
};

type MonthBarsProps = {
  bars: MonthBar[];
  /** What the chart shows, in one sentence; also its accessible name. */
  description: string;
  /** What a bar measures, e.g. "Kwota netto". */
  valueLabel: string;
  periodLabel: string;
  /** Label of the control that reveals the same data as a table. */
  tableLabel: string;
  /** Shown instead of an amount that could not be computed. */
  unknownLabel: string;
};

const BAR_COLOR = "var(--chart-value)";

/**
 * Amounts of the twelve months of a year as bars. One series, so the caption names it
 * and there is no legend; a tooltip and a table view of the same data come with it.
 */
export function MonthBars({
  bars,
  description,
  valueLabel,
  periodLabel,
  tableLabel,
  unknownLabel,
}: MonthBarsProps) {
  const full = (value: number | null) => (value === null ? unknownLabel : formatPln(value));

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm text-muted-foreground">{description}</figcaption>

      <div className="h-64 w-full" role="img" aria-label={description}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={bars}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barCategoryGap="22%"
          >
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              // On a narrow screen every other month is labelled instead of letting names collide.
              interval="equidistantPreserveStart"
              minTickGap={6}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <YAxis
              tickFormatter={formatCompact}
              width={56}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ fill: "var(--chart-grid)", fillOpacity: 0.5 }}
              isAnimationActive={false}
              content={({ active, payload }) => {
                const bar = payload?.[0]?.payload as MonthBar | undefined;
                if (!active || !bar) {
                  return null;
                }

                return (
                  <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-sm">
                    <p className="mb-1 text-muted-foreground">{bar.name}</p>
                    <p className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="inline-block size-2.5 rounded-sm"
                        style={{ background: BAR_COLOR }}
                      />
                      <span className="font-medium tabular-nums">{full(bar.value)}</span>
                      <span className="text-muted-foreground">{valueLabel}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar
              dataKey="value"
              fill={BAR_COLOR}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
          {tableLabel}
        </summary>
        <table className="mt-3 w-full max-w-xs tabular-nums">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 font-medium">{periodLabel}</th>
              <th className="py-1.5 text-right font-medium">{valueLabel}</th>
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.name} className="border-b last:border-b-0">
                <td className="py-1.5">{bar.name}</td>
                <td className="py-1.5 text-right">{full(bar.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompact, formatDate, formatPln, formatSignedPercent } from "@/lib/format";

export type TimeChartPoint = {
  date: string;
  /** The series the chart is about. */
  primary: number | null;
  /** The series it is compared with. */
  context: number | null;
};

type TimeChartProps = {
  points: TimeChartPoint[];
  /** What the chart shows, in one sentence; also its accessible name. */
  description: string;
  primaryLabel: string;
  contextLabel: string;
  /** Label of the control that reveals the same data as a table. */
  tableLabel: string;
  dateLabel: string;
  /** Amounts in PLN, or returns as percentages. */
  format: "pln" | "percent";
  /** Draw the context series as steps (for values that change only on certain days). */
  contextSteps?: boolean;
};

const PRIMARY_COLOR = "var(--chart-value)";
const CONTEXT_COLOR = "var(--chart-context)";

const percentAxis = new Intl.NumberFormat("pl-PL", { style: "percent", maximumFractionDigits: 0 });

/** A short stroke in the series colour, used in the legend and the tooltip. */
function LineKey({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-0.5 w-4 rounded-full align-middle"
      style={{ background: color }}
    />
  );
}

/** The last point of every month, newest first: the chart's data as a table. */
function monthEnds(points: TimeChartPoint[]): TimeChartPoint[] {
  const byMonth = new Map<string, TimeChartPoint>();
  for (const point of points) {
    byMonth.set(point.date.slice(0, 7), point);
  }
  return [...byMonth.values()].reverse();
}

/**
 * Two series over time on one axis. The primary series is the point of the chart (accent
 * line, with a light wash for amounts); the other is context (gray). A legend, a tooltip
 * that lists both, and a table view of the same data come with it.
 */
export function TimeChart({
  points,
  description,
  primaryLabel,
  contextLabel,
  tableLabel,
  dateLabel,
  format,
  contextSteps = false,
}: TimeChartProps) {
  const series = [
    { key: "primary", label: primaryLabel, color: PRIMARY_COLOR },
    { key: "context", label: contextLabel, color: CONTEXT_COLOR },
  ] as const;
  const full = (value: number | null) =>
    value === null ? "–" : format === "pln" ? formatPln(value) : formatSignedPercent(value);
  const short = (value: number) =>
    format === "pln" ? formatCompact(value) : percentAxis.format(value);

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm text-muted-foreground">{description}</figcaption>

      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {series.map(({ key, label, color }) => (
          <li key={key} className="flex items-center gap-2">
            <LineKey color={color} />
            {label}
          </li>
        ))}
      </ul>

      <div className="h-72 w-full" role="img" aria-label={description}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={(date: string) => `${date.slice(5, 7)}.${date.slice(0, 4)}`}
              minTickGap={56}
              tickLine={false}
              axisLine={{ stroke: "var(--chart-grid)" }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <YAxis
              tickFormatter={short}
              width={56}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <Tooltip
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
              isAnimationActive={false}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) {
                  return null;
                }

                return (
                  <div className="rounded-md border bg-card px-3 py-2 text-sm shadow-sm">
                    <p className="mb-1 text-muted-foreground tabular-nums">
                      {formatDate(String(label))}
                    </p>
                    {series.map(({ key, label: name, color }) => {
                      const entry = payload.find((item) => item.dataKey === key);
                      return (
                        <p key={key} className="flex items-center gap-2">
                          <LineKey color={color} />
                          <span className="font-medium tabular-nums">
                            {full(typeof entry?.value === "number" ? entry.value : null)}
                          </span>
                          <span className="text-muted-foreground">{name}</span>
                        </p>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Line
              type={contextSteps ? "stepAfter" : "linear"}
              dataKey="context"
              stroke={CONTEXT_COLOR}
              strokeWidth={1.5}
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Area
              type="linear"
              dataKey="primary"
              stroke={PRIMARY_COLOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill={PRIMARY_COLOR}
              // A wash under amounts, which grow from zero; none under returns, which do not.
              fillOpacity={format === "pln" ? 0.1 : 0}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <details className="text-sm">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">
          {tableLabel}
        </summary>
        <table className="mt-3 w-full max-w-md tabular-nums">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 font-medium">{dateLabel}</th>
              <th className="py-1.5 text-right font-medium">{primaryLabel}</th>
              <th className="py-1.5 text-right font-medium">{contextLabel}</th>
            </tr>
          </thead>
          <tbody>
            {monthEnds(points).map((point) => (
              <tr key={point.date} className="border-b last:border-b-0">
                <td className="py-1.5">{formatDate(point.date)}</td>
                <td className="py-1.5 text-right">{full(point.primary)}</td>
                <td className="py-1.5 text-right">{full(point.context)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

"use client";

import { useTranslations } from "next-intl";
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
import { formatCompact, formatDate, formatPln } from "@/lib/format";

export type ValueChartPoint = {
  date: string;
  value: number | null;
  cost: number | null;
};

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

const VALUE_COLOR = "var(--chart-value)";
const CONTEXT_COLOR = "var(--chart-context)";

/** The last point of every month, newest first: the chart's data as a table. */
function monthEnds(points: ValueChartPoint[]): ValueChartPoint[] {
  const byMonth = new Map<string, ValueChartPoint>();
  for (const point of points) {
    byMonth.set(point.date.slice(0, 7), point);
  }
  return [...byMonth.values()].reverse();
}

/**
 * Value of the securities over time against what they cost. The value is the point of the
 * chart (accent line with a light wash); the cost is context (gray steps). The gap between
 * the two is the unrealized result.
 */
export function ValueChart({ points }: { points: ValueChartPoint[] }) {
  const t = useTranslations("portfolio.chart");

  const labels: Record<string, string> = { value: t("value"), cost: t("cost") };
  const colors: Record<string, string> = { value: VALUE_COLOR, cost: CONTEXT_COLOR };
  const amount = (value: number | null) => (value === null ? "–" : formatPln(value));

  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-sm text-muted-foreground">{t("description")}</figcaption>

      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <li className="flex items-center gap-2">
          <LineKey color={VALUE_COLOR} />
          {t("value")}
        </li>
        <li className="flex items-center gap-2">
          <LineKey color={CONTEXT_COLOR} />
          {t("cost")}
        </li>
      </ul>

      <div className="h-72 w-full" role="img" aria-label={t("description")}>
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
              tickFormatter={(value: number) => formatCompact(value)}
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
                    {["value", "cost"].map((key) => {
                      const entry = payload.find((item) => item.dataKey === key);
                      if (!entry) {
                        return null;
                      }
                      return (
                        <p key={key} className="flex items-center gap-2">
                          <LineKey color={colors[key]} />
                          <span className="font-medium tabular-nums">
                            {typeof entry.value === "number" ? formatPln(entry.value) : "–"}
                          </span>
                          <span className="text-muted-foreground">{labels[key]}</span>
                        </p>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Line
              type="stepAfter"
              dataKey="cost"
              stroke={CONTEXT_COLOR}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
              isAnimationActive={false}
            />
            <Area
              type="linear"
              dataKey="value"
              stroke={VALUE_COLOR}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              fill={VALUE_COLOR}
              fillOpacity={0.1}
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
          {t("table")}
        </summary>
        <table className="mt-3 w-full max-w-md tabular-nums">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 font-medium">{t("date")}</th>
              <th className="py-1.5 text-right font-medium">{t("value")}</th>
              <th className="py-1.5 text-right font-medium">{t("cost")}</th>
            </tr>
          </thead>
          <tbody>
            {monthEnds(points).map((point) => (
              <tr key={point.date} className="border-b last:border-b-0">
                <td className="py-1.5">{formatDate(point.date)}</td>
                <td className="py-1.5 text-right">{amount(point.value)}</td>
                <td className="py-1.5 text-right">{amount(point.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

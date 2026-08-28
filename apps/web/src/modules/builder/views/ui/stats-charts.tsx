"use client";

// Recharts is a dependency of MEERO'S OWN dashboard frontend only — see the
// same note in conversion-charts.tsx. Never add this to the generated-app
// allowlist (ALLOWED_PACKAGES/VENDORED_PACKAGE_VERSIONS in
// orchestrator/app/agent/codegen.py).
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type StatsSection = { label: string; count: number };

/**
 * Single-series line chart of real sessions per day — no legend needed (one
 * series, the chart's own heading already says what's plotted).
 */
export function SessionsTimelineChart({ data }: { data: StatsSection[] }) {
  if (data.length < 2) return null;
  const chartData = data.map((d) => ({
    day: new Date(d.label).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    sessions: d.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
        />
        <YAxis hide domain={[0, (max: number) => Math.max(max * 1.2, 5)]} />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        />
        <Line
          type="monotone"
          dataKey="sessions"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/**
 * A ranked horizontal bar-list — the right form for "top N" data with long,
 * variable-length labels (page paths, CSS selectors) where a true bar chart
 * would either clip labels or force sideways text. Single accent hue, bar
 * width proportional to the section's own max so the biggest row always
 * reads as "full."
 */
export function RankedBarList({
  rows,
  emptyLabel,
}: {
  rows: { label: string; count: number; extra?: string | null }[];
  emptyLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-[11.5px] text-muted-foreground">{emptyLabel}</p>;
  }
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} className="relative">
          <div
            className="absolute inset-y-0 left-0 rounded-md bg-primary/10"
            style={{ width: `${Math.max((r.count / max) * 100, 4)}%` }}
            aria-hidden
          />
          <div className="relative flex items-baseline justify-between gap-3 px-2 py-1.5">
            <span className="min-w-0 truncate text-[12px] text-foreground">
              {r.label}
              {r.extra && (
                <span className="ml-1.5 text-[11px] text-muted-foreground">{r.extra}</span>
              )}
            </span>
            <span className="shrink-0 text-[12px] font-medium tabular-nums text-secondary-foreground">
              {r.count}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

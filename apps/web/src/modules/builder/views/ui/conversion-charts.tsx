"use client";

// Recharts is a dependency of MEERO'S OWN dashboard frontend only — a
// completely separate dependency set from the strictly-allowlisted,
// mechanically-enforced toolchain generated apps are permitted to import
// (see ALLOWED_PACKAGES/VENDORED_PACKAGE_VERSIONS in
// orchestrator/app/agent/codegen.py). Never add this to that allowlist.
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ConversionResult } from "@/lib/types";

// Fixed two-slot semantic pair, not an open categorical set: variant A is
// deliberately neutral/muted (the existing UI, the control) and variant B
// is the accent (the proposed fix being tested) — the same "before/after"
// meaning everywhere it appears in this panel.
const COLOR_A = "var(--secondary-foreground)";
const COLOR_B = "var(--primary)";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Grouped bar: variant A vs B conversion rate. Direct value labels at each
 * bar's tip (never color alone) plus a text legend naming both variants —
 * the raw lift/significance numbers are shown as text above the chart by
 * the caller, not baked into the marks themselves.
 */
export function ExperimentLiftChart({
  exposuresA,
  conversionsA,
  exposuresB,
  conversionsB,
}: {
  exposuresA: number;
  conversionsA: number;
  exposuresB: number;
  conversionsB: number;
}) {
  const rateA = exposuresA > 0 ? conversionsA / exposuresA : 0;
  const rateB = exposuresB > 0 ? conversionsB / exposuresB : 0;
  const data = [
    { variant: "Original (A)", rate: rateA, fill: COLOR_A },
    { variant: "Proposed fix (B)", rate: rateB, fill: COLOR_B },
  ];

  return (
    <div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="variant"
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
          <YAxis hide domain={[0, (max: number) => Math.max(max * 1.3, 0.05)]} />
          <Tooltip
            formatter={(value) => pct(Number(value) || 0)}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          />
          <Bar dataKey="rate" radius={[4, 4, 0, 0]} maxBarSize={24}>
            {data.map((d) => (
              <Cell key={d.variant} fill={d.fill} />
            ))}
            <LabelList
              dataKey="rate"
              position="top"
              formatter={(value) => pct(Number(value) || 0)}
              style={{ fill: "var(--foreground)", fontSize: 12, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: COLOR_A }} aria-hidden />
          Original (A) — {exposuresA} visitors
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: COLOR_B }} aria-hidden />
          Proposed fix (B) — {exposuresB} visitors
        </span>
      </div>
    </div>
  );
}

/**
 * Line chart of lift_pct across evaluation passes over time — a single
 * series, so no legend box (the chart's own label already says what's
 * plotted); direct end-label carries the latest value.
 */
export function ConversionResultsTimeline({ results }: { results: ConversionResult[] }) {
  const data = [...results]
    .filter((r) => r.lift_pct !== null)
    .sort((a, b) => a.evaluated_at.localeCompare(b.evaluated_at))
    .map((r) => ({
      evaluated_at: new Date(r.evaluated_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      lift: r.lift_pct as number,
    }));

  if (data.length < 2) return null;

  return (
    <ResponsiveContainer width="100%" height={120}>
      <LineChart data={data} margin={{ top: 8, right: 24, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="evaluated_at"
          tickLine={false}
          axisLine={{ stroke: "var(--border)" }}
          tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
        />
        <YAxis hide>
          <Label value="Lift %" position="insideTopLeft" />
        </YAxis>
        <Tooltip
          formatter={(value) => `${(Number(value) || 0).toFixed(1)}%`}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid var(--border)",
          }}
        />
        <Line
          type="monotone"
          dataKey="lift"
          stroke={COLOR_B}
          strokeWidth={2}
          dot={{ r: 3, fill: COLOR_B, stroke: "var(--background)", strokeWidth: 2 }}
        >
          <LabelList
            dataKey="lift"
            position="right"
            formatter={(value) => `${(Number(value) || 0).toFixed(1)}%`}
            style={{ fill: "var(--foreground)", fontSize: 11, fontWeight: 600 }}
          />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

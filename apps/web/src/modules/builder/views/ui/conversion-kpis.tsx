"use client";

import { useEffect, useState } from "react";
import { RankedBarList } from "@/modules/builder/views/ui/stats-charts";
import { BarChartIcon, CursorClickIcon, FunnelIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

type PageBreakdownRow = { page_path: string; sessions: number; bounce_rate: number };
type ExitPageRow = { page_path: string; sessions: number };
type DeviceConversionRow = { device_type: string; sessions: number; conversion_rate: number };
type FunnelStep = { label: string; count: number };

type KpiData = {
  total_sessions: number;
  total_page_views: number;
  bounce_rate: number;
  avg_session_duration_s: number;
  pages_per_session: number;
  page_breakdown: PageBreakdownRow[];
  exit_pages: ExitPageRow[];
  device_breakdown: DeviceConversionRow[];
  funnel_steps: FunnelStep[];
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3">
      <p className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-[19px] font-bold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/**
 * Real KPI overview for the Improvements tab — every number here comes
 * straight from GET /projects/{id}/conversion/kpis (orchestrator/app/main.py),
 * itself computed from the same required behavior-tracker events every
 * other conversion feature reads (see supabase_connect.py's
 * fetch_conversion_kpis/fetch_page_breakdown/fetch_exit_pages/
 * fetch_device_conversion). No new tracked fields needed, so this works for
 * every already-built app immediately.
 *
 * A 30-day rolling window (fixed server-side, not user-adjustable yet) —
 * enough real time to average out day-to-day noise without going stale.
 */
export function ConversionKpiDashboard({ projectId }: { projectId: string }) {
  const [data, setData] = useState<KpiData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!base || !session) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const res = await fetch(`${base}/projects/${projectId}/conversion/kpis`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok && !cancelled) setData(await res.json());
      } catch {
        // Best-effort — the rest of the tab still works without KPIs.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [projectId]);

  if (loading) return null;
  if (!data || data.total_sessions === 0) return null;

  const deviceRows = data.device_breakdown
    .slice()
    .sort((a, b) => b.sessions - a.sessions)
    .map((d) => ({
      label: d.device_type,
      count: d.sessions,
      extra: `${Math.round(d.conversion_rate * 100)}% convert`,
    }));

  const pageRows = data.page_breakdown.map((p) => ({
    label: p.page_path,
    count: p.sessions,
    extra: `${Math.round(p.bounce_rate * 100)}% bounce`,
  }));

  const exitRows = data.exit_pages.map((p) => ({
    label: p.page_path,
    count: p.sessions,
  }));

  const funnelRows = data.funnel_steps.map((s) => ({
    label: s.label,
    count: s.count,
  }));

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
        <BarChartIcon size={12} />
        Key metrics · last 30 days
      </h3>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Sessions" value={data.total_sessions.toLocaleString()} />
        <StatTile label="Bounce rate" value={`${Math.round(data.bounce_rate * 100)}%`} />
        <StatTile label="Avg session" value={formatDuration(data.avg_session_duration_s)} />
        <StatTile label="Pages / session" value={data.pages_per_session.toFixed(1)} />
      </div>

      {pageRows.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 text-[11.5px] font-medium text-secondary-foreground">
            Top pages by traffic (with bounce rate)
          </h4>
          <RankedBarList rows={pageRows} emptyLabel="No page views recorded yet." />
        </div>
      )}

      {exitRows.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-secondary-foreground">
            <CursorClickIcon size={11} />
            Where sessions end
          </h4>
          <RankedBarList rows={exitRows} emptyLabel="Not enough data yet." />
        </div>
      )}

      {deviceRows.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 text-[11.5px] font-medium text-secondary-foreground">
            Sessions by device (with conversion rate)
          </h4>
          <RankedBarList rows={deviceRows} emptyLabel="Not enough data yet." />
        </div>
      )}

      {funnelRows.length > 0 && (
        <div className="mt-4">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-secondary-foreground">
            <FunnelIcon size={11} />
            Funnel
          </h4>
          <RankedBarList rows={funnelRows} emptyLabel="No named funnel milestones recorded yet." />
        </div>
      )}
    </section>
  );
}

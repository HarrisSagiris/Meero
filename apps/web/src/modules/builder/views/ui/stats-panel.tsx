"use client";

import { useEffect, useState } from "react";
import { RankedBarList, SessionsTimelineChart } from "@/modules/builder/views/ui/stats-charts";
import { createClient } from "@/lib/supabase/client";

type StatsSection = { label: string; count: number; extra?: string | null };

type StatsResponse = {
  total_sessions: number;
  sessions_by_day: StatsSection[];
  views_by_page: StatsSection[];
  device_breakdown: StatsSection[];
  scroll_depth_distribution: StatsSection[];
  top_clicked_elements: StatsSection[];
  dead_rage_counts: StatsSection[];
  funnel_steps: StatsSection[];
};

const EMPTY_STATS: StatsResponse = {
  total_sessions: 0,
  sessions_by_day: [],
  views_by_page: [],
  device_breakdown: [],
  scroll_depth_distribution: [],
  top_clicked_elements: [],
  dead_rage_counts: [],
  funnel_steps: [],
};

// Module-level, keyed by project — BuilderCanvas remounts each tab's content
// on every switch (so its entrance animation can replay), which would
// otherwise reset real, already-loaded stats back to zero every time someone
// revisits this tab. Seeding from this cache means a revisit shows the last
// known real numbers instantly while a fresh fetch quietly runs behind it.
const statsCache = new Map<string, StatsResponse>();

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 text-[22px] font-bold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

/**
 * Real visitor analytics for this app, unconditional — every generated app
 * ships a required behavior tracker (components/meero-behavior-tracker.tsx)
 * that always records, regardless of the Conversion tab's "Autonomous
 * optimization" toggle. This tab just reads that data back, aggregated
 * server-side (GET /projects/{id}/stats — orchestrator/app/supabase_connect.py's
 * fetch_behavior_stats), with no AI analysis layered on top.
 */
export function StatsPanel({
  projectId,
  supabaseLinked,
}: {
  projectId: string;
  supabaseLinked: boolean;
}) {
  const [stats, setStats] = useState<StatsResponse>(() => statsCache.get(projectId) ?? EMPTY_STATS);
  // Only meaningful while supabaseLinked — the render below never reads
  // this flag otherwise, so there's no state to synchronize for that case.
  // Skipped when a cached value already exists, so a revisit never shows a
  // loading state over real numbers it already has.
  const [loading, setLoading] = useState(() => supabaseLinked && !statsCache.has(projectId));

  useEffect(() => {
    if (!supabaseLinked) return;
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
        const res = await fetch(`${base}/projects/${projectId}/stats`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (res.ok && !cancelled) {
          const body: StatsResponse = await res.json();
          statsCache.set(projectId, body);
          setStats(body);
        }
      } catch {
        // Telemetry read is best-effort — never disrupt the builder.
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
  }, [projectId, supabaseLinked]);

  const totalPageViews = stats.views_by_page.reduce((sum, r) => sum + r.count, 0);
  const totalDeadClicks = stats.dead_rage_counts
    .filter((r) => r.extra?.includes("dead_click"))
    .reduce((sum, r) => sum + r.count, 0);

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">Stats</h2>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Real visitor activity from your live app, all-time since it first went live.
          </p>
        </div>

        {!supabaseLinked && (
          <p className="rounded-xl border border-border bg-muted/60 px-4 py-3 text-[12.5px] text-secondary-foreground">
            Link a Supabase project to this app to start tracking real visitor activity.
          </p>
        )}

        {supabaseLinked && loading && <p className="text-[12px] text-muted-foreground">Loading…</p>}

        {supabaseLinked && !loading && (
          <>
            <div className="grid grid-cols-3 gap-2.5">
              <StatTile label="Sessions" value={stats.total_sessions} />
              <StatTile label="Page views" value={totalPageViews} />
              <StatTile label="Dead clicks" value={totalDeadClicks} />
            </div>

            {stats.sessions_by_day.length >= 2 && (
              <section>
                <h3 className="mb-2 text-[12.5px] font-semibold text-secondary-foreground">
                  Sessions over time
                </h3>
                <SessionsTimelineChart data={stats.sessions_by_day} />
              </section>
            )}

            <section>
              <h3 className="mb-2 text-[12.5px] font-semibold text-secondary-foreground">
                Top pages
              </h3>
              <RankedBarList rows={stats.views_by_page} emptyLabel="No page views recorded yet." />
            </section>

            <section>
              <h3 className="mb-2 text-[12.5px] font-semibold text-secondary-foreground">
                Devices
              </h3>
              <RankedBarList rows={stats.device_breakdown} emptyLabel="No sessions recorded yet." />
            </section>

            <section>
              <h3 className="mb-2 text-[12.5px] font-semibold text-secondary-foreground">
                Scroll depth
              </h3>
              <RankedBarList
                rows={stats.scroll_depth_distribution}
                emptyLabel="No scroll activity recorded yet."
              />
            </section>

            <section>
              <h3 className="mb-2 text-[12.5px] font-semibold text-secondary-foreground">
                Top clicked elements
              </h3>
              <RankedBarList
                rows={stats.top_clicked_elements}
                emptyLabel="No clicks recorded yet."
              />
            </section>

            <section>
              <h3 className="mb-2 text-[12.5px] font-semibold text-secondary-foreground">
                Dead &amp; rage clicks
              </h3>
              <RankedBarList
                rows={stats.dead_rage_counts}
                emptyLabel="Nothing flagged — visitors aren't clicking on anything unresponsive."
              />
            </section>

            {stats.funnel_steps.length > 0 && (
              <section>
                <h3 className="mb-2 text-[12.5px] font-semibold text-secondary-foreground">
                  Funnel
                </h3>
                <RankedBarList
                  rows={stats.funnel_steps}
                  emptyLabel="No named funnel milestones recorded yet."
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

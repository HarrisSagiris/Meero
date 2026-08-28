"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type HeatmapPoint = { x: number; y: number; event_type: string };

type HeatmapResponse = {
  page_path: string;
  screenshot_url: string | null;
  points: HeatmapPoint[];
  dead_clicks: HeatmapPoint[];
};

/**
 * Real click-density overlay on top of a real screenshot of the app's own
 * live page (GET /projects/{id}/conversion/heatmap — a headless-Chromium
 * capture plus real recorded x/y points from the required behavior
 * tracker). Coordinates are normalized 0–1 fractions of the visitor's own
 * viewport (see components/meero-behavior-tracker.tsx) so points from
 * different real visitor screen sizes are still comparable — this overlay
 * just multiplies them back out against the screenshot's own rendered box.
 */
export function ConversionHeatmap({
  projectId,
  pagePaths,
}: {
  projectId: string;
  pagePaths: string[];
}) {
  const paths = pagePaths.length > 0 ? pagePaths : ["/"];
  const [pagePath, setPagePath] = useState(paths[0]);
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDeadClicks, setShowDeadClicks] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setData(null);
      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!base || !session) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(
          `${base}/projects/${projectId}/conversion/heatmap?page_path=${encodeURIComponent(pagePath)}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as HeatmapResponse;
        if (!cancelled) setData(body);
      } catch {
        // Telemetry read is best-effort — never disrupt the builder.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, pagePath]);

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {paths.length > 1 ? (
          <select
            value={pagePath}
            onChange={(e) => setPagePath(e.target.value)}
            className="rounded-lg border border-border bg-white px-2 py-1 text-[12px] text-foreground"
          >
            {paths.map((p) => (
              <option key={p} value={p}>
                {p || "/"}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[12px] font-medium text-secondary-foreground">
            {pagePath || "/"}
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={showDeadClicks}
            onChange={(e) => setShowDeadClicks(e.target.checked)}
          />
          Dead clicks
        </label>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-border bg-muted/60">
        {loading && (
          <div className="flex h-64 items-center justify-center text-[12px] text-muted-foreground">
            Loading…
          </div>
        )}
        {!loading && data?.screenshot_url && (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element -- a real Supabase Storage screenshot, not an optimizable static asset */}
            <img
              src={data.screenshot_url}
              alt={`Screenshot of ${data.page_path || "/"}`}
              className="block w-full"
            />
            {/* Plain percentage-positioned dots, not an SVG viewBox — the
                screenshot's real aspect ratio varies per page (full_page
                capture, not a fixed size), and a square viewBox stretched
                non-uniformly (preserveAspectRatio="none") to fit a
                non-square box would render these as ellipses, not circles.
                Percentage left/top plus a fixed pixel dot size sidesteps
                that entirely. */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {data.points.map((p, i) => (
                <span
                  key={`click-${i}`}
                  className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/35"
                  style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                />
              ))}
              {showDeadClicks &&
                data.dead_clicks.map((p, i) => (
                  <span
                    key={`dead-${i}`}
                    className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-600/45"
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                  />
                ))}
            </div>
          </div>
        )}
        {!loading && data && !data.screenshot_url && (
          <div className="flex h-64 items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
            No screenshot of this page yet — it&apos;s captured during a build, so the next
            successful build will add it. The click positions above are real either way.
          </div>
        )}
      </div>
      {!loading && data && data.points.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          No recorded clicks on this page yet.
        </p>
      )}
    </div>
  );
}

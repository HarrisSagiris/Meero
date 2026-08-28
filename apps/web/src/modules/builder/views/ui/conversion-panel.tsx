"use client";

import { useEffect, useState } from "react";
import { ConversionAgentToggle } from "@/modules/builder/views/ui/conversion-agent-toggle";
import {
  ConversionResultsTimeline,
  ExperimentLiftChart,
} from "@/modules/builder/views/ui/conversion-charts";
import { ConversionHeatmap } from "@/modules/builder/views/ui/conversion-heatmap";
import { ConversionKpiDashboard } from "@/modules/builder/views/ui/conversion-kpis";
import {
  ArrowRightIcon,
  BarChartIcon,
  CursorClickIcon,
  FlaskIcon,
  FormIcon,
  FunnelIcon,
  TargetIcon,
  TrendingUpIcon,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { createClient } from "@/lib/supabase/client";
import type { ConversionExperiment, ConversionHypothesis, ConversionResult } from "@/lib/types";

type ExperimentWithResults = ConversionExperiment & {
  conversion_results: ConversionResult[];
};

type DeviceSegmentCounts = {
  device_type: string;
  exposures_a: number;
  exposures_b: number;
  conversions_a: number;
  conversions_b: number;
};

type LiveCounts = {
  exposures_a: number;
  exposures_b: number;
  conversions_a: number;
  conversions_b: number;
  by_device: DeviceSegmentCounts[];
};

// Mirrors orchestrator/app/config.py's
// Settings.conversion_agent_min_exposures_per_variant — the real minimum
// per-variant sample size before Meero's evaluation pass will run the
// significance test at all. Display-only, same "keep in sync" convention as
// CONVERSION_MIN_RUNTIME_DAYS below.
const CONVERSION_MIN_EXPOSURES_PER_VARIANT = 100;

function segmentRate(exposures: number, conversions: number): number | null {
  return exposures > 0 ? conversions / exposures : null;
}

const ISSUE_LABELS: Record<ConversionHypothesis["issue_type"], string> = {
  cta_below_fold: "CTA below the fold",
  low_ctr: "Low click-through",
  dead_click: "Dead click",
  rage_click: "Rage click",
  form_abandonment: "Form abandonment",
  pricing_drop_off: "Pricing drop-off",
  signup_drop_off: "Signup drop-off",
  device_gap: "Device conversion gap",
  high_bounce: "High-bounce page",
  exit_page: "Common exit page",
};

// One icon per real detector in orchestrator/app/conversion_agent.py's
// _DETECTORS, so a glance at the list tells you what KIND of friction each
// row is without reading the description first.
const ISSUE_ICONS: Record<ConversionHypothesis["issue_type"], typeof TargetIcon> = {
  cta_below_fold: TargetIcon,
  low_ctr: TargetIcon,
  dead_click: CursorClickIcon,
  rage_click: CursorClickIcon,
  form_abandonment: FormIcon,
  pricing_drop_off: FunnelIcon,
  signup_drop_off: FunnelIcon,
  device_gap: BarChartIcon,
  high_bounce: TargetIcon,
  exit_page: ArrowRightIcon,
};

// Mirrors orchestrator/app/config.py's Settings.conversion_agent_min_runtime_days
// — the real minimum a launched experiment runs before Meero's evaluation
// pass (app/conversion_agent.py's _evaluate_running_experiments) will ever
// decide a winner, no matter how much traffic comes in. Display-only, same
// "keep in sync" convention as PLAN_CREDIT_LIMITS in src/lib/types.ts.
const CONVERSION_MIN_RUNTIME_DAYS = 7;

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  winner_b: "Fix won",
  winner_a: "Original won",
  inconclusive: "Inconclusive",
};

/** Best-effort, robust to whichever numeric fields a given issue_type's
 *  detector actually populated (see orchestrator/app/conversion_agent.py's
 *  _DETECTORS) — unknown/missing keys are silently skipped, never a
 *  fabricated stat. One short line, not a row of separate pills. */
function evidenceLine(evidence: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const num = (k: string) => (typeof evidence[k] === "number" ? (evidence[k] as number) : null);
  const occurrences = num("occurrences");
  const sessions =
    num("sessions") ?? num("fully_scrolled_sessions") ?? num("earlier_sessions") ?? num("starts");
  if (occurrences != null) parts.push(`${occurrences} occurrences`);
  if (sessions != null) parts.push(`${sessions} sessions`);
  const completion = num("completion_rate");
  if (completion != null) parts.push(`${Math.round(completion * 100)}% completion`);
  const ctr = num("click_through_rate");
  if (ctr != null) parts.push(`${Math.round(ctr * 100)}% click-through`);
  const dropOff = num("drop_off");
  if (dropOff != null) parts.push(`${Math.round(dropOff * 100)}% drop-off`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

async function authHeaders() {
  const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!base || !session) return null;
  return { base, headers: { Authorization: `Bearer ${session.access_token}` } };
}

/**
 * The Improvements tab (user-facing name for what's internally the
 * "conversion" feature throughout the codebase — DB tables, API routes,
 * orchestrator/app/conversion_agent.py — kept as-is; only the label users
 * see changed): what the autonomous agent has detected in real visitor
 * behavior and done about it. Off by default (00042_conversion_agent.sql)
 * — the toggle here gates only the AGENT's analysis/experiment loop; the
 * required behavior tracker every generated app ships always records
 * regardless.
 *
 * Deliberately minimal: plain text and a couple of dividers, not a
 * dashboard of cards — this is a short, occasional-glance list, not a
 * primary work surface.
 *
 * Hypotheses/experiments/results come as server-fetched props from
 * page.tsx (same pattern as builds/specs/messages) — a conversion.*
 * WebSocket event triggers build-status-listener.tsx's router.refresh(),
 * which re-fetches them for free. Heatmap imagery and live experiment
 * counts come from the orchestrator directly (they need the Management
 * API), fetched client-side here.
 */
export function ConversionPanel({
  projectId,
  isOwner,
  supabaseLinked,
  conversionAgentEnabled,
  autonomyMode,
  hypotheses,
  experiments,
}: {
  projectId: string;
  isOwner: boolean;
  supabaseLinked: boolean;
  conversionAgentEnabled: boolean;
  autonomyMode: "solo" | "manual";
  hypotheses: ConversionHypothesis[];
  experiments: ExperimentWithResults[];
}) {
  // Optimistic local overlays, not a copy of props — real WS events
  // (build-status-listener.tsx) already router.refresh() fresh
  // hypotheses/experiments props in shortly after any of these actions
  // succeed, at which point these overlays become redundant no-ops
  // (props already reflect the change). Plain event-handler-driven state,
  // never synced FROM props via an effect.
  const [justLaunched, setJustLaunched] = useState<Set<string>>(new Set());
  const [justApplied, setJustApplied] = useState<Set<string>>(new Set());

  const [launching, setLaunching] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [liveCounts, setLiveCounts] = useState<Record<string, LiveCounts>>({});

  const effectiveHypotheses = hypotheses.map((h) =>
    justLaunched.has(h.id) && h.status === "open" ? { ...h, status: "experimenting" as const } : h,
  );
  const activeExperiments = experiments.filter((e) => e.status !== "reverted");

  useEffect(() => {
    if (activeExperiments.length === 0) return;
    let cancelled = false;
    async function loadCounts() {
      const auth = await authHeaders();
      if (!auth) return;
      for (const exp of activeExperiments) {
        try {
          const res = await fetch(
            `${auth.base}/projects/${projectId}/conversion/experiments/${exp.id}/counts`,
            { headers: auth.headers },
          );
          if (!res.ok || cancelled) continue;
          const body = (await res.json()) as LiveCounts;
          if (!cancelled) {
            setLiveCounts((prev) => ({ ...prev, [exp.id]: body }));
          }
        } catch {
          // Live counts are best-effort — the last conversion_results row
          // (already in props) is a fine fallback.
        }
      }
    }
    void loadCounts();
    const id = setInterval(() => void loadCounts(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [projectId, activeExperiments]);

  async function launchExperiment(hypothesisId: string) {
    setActionError(null);
    setLaunching(hypothesisId);
    const auth = await authHeaders();
    if (!auth) {
      setActionError("Session expired — reload and sign in again.");
      setLaunching(null);
      return;
    }
    try {
      const res = await fetch(
        `${auth.base}/projects/${projectId}/conversion/hypotheses/${hypothesisId}/launch`,
        { method: "POST", headers: auth.headers },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setJustLaunched((prev) => new Set(prev).add(hypothesisId));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not launch the experiment.");
    } finally {
      setLaunching(null);
    }
  }

  async function applyDecision(experimentId: string) {
    setActionError(null);
    setApplying(experimentId);
    const auth = await authHeaders();
    if (!auth) {
      setActionError("Session expired — reload and sign in again.");
      setApplying(null);
      return;
    }
    try {
      const res = await fetch(
        `${auth.base}/projects/${projectId}/conversion/experiments/${experimentId}/apply-decision`,
        { method: "POST", headers: auth.headers },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Failed (${res.status})`);
      }
      // A real build was just queued — its progress shows up in the normal
      // live build activity feed.
      setJustApplied((prev) => new Set(prev).add(experimentId));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not apply the decision.");
    } finally {
      setApplying(null);
    }
  }

  const openHypotheses = effectiveHypotheses.filter((h) => h.status === "open");
  const experimentingHypotheses = effectiveHypotheses.filter((h) => h.status === "experimenting");
  // Grouped by page so a multi-page app shows where issues actually
  // cluster, instead of one flat list mixing pages together. Device-gap
  // hypotheses carry no single page_path (they're app-wide), so they get
  // their own "Across the app" group rather than a misleading "/" bucket.
  const hypothesesByPage = new Map<string, ConversionHypothesis[]>();
  for (const h of openHypotheses) {
    const key = h.page_path || "Across the app";
    const list = hypothesesByPage.get(key) ?? [];
    list.push(h);
    hypothesesByPage.set(key, list);
  }
  const pageGroups = Array.from(hypothesesByPage.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );
  const heatmapPaths = Array.from(
    new Set(["/", ...effectiveHypotheses.map((h) => h.page_path).filter((p) => !!p)]),
  );
  const nothingYet =
    openHypotheses.length === 0 &&
    experimentingHypotheses.length === 0 &&
    activeExperiments.length === 0;

  const resolvedCount = experiments.filter((e) => e.status === "winner_b").length;

  return (
    <div className="h-full overflow-auto p-4 sm:p-6">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <TrendingUpIcon size={17} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-foreground">Improvements</h2>
                {conversionAgentEnabled && (
                  <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10.5px] font-medium text-secondary-foreground">
                    <StatusDot tone="live" />
                    Watching
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                What Meero found in your visitors&apos; real behavior, and what it&apos;s testing to
                make your app convert better.
              </p>
            </div>
          </div>
          {isOwner && (
            <ConversionAgentToggle projectId={projectId} enabled={conversionAgentEnabled} />
          )}
        </div>

        {resolvedCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 text-[12.5px] text-emerald-800">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
              <svg
                width="10"
                height="10"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="m4 10.5 4 4 8-9" />
              </svg>
            </span>
            {resolvedCount === 1
              ? "1 real fix has already shipped from a winning experiment."
              : `${resolvedCount} real fixes have already shipped from winning experiments.`}
          </div>
        )}

        {supabaseLinked && <ConversionKpiDashboard projectId={projectId} />}

        {!supabaseLinked && (
          <EmptyState
            icon={<TrendingUpIcon size={22} />}
            title="Link Supabase to get started"
            body="Link a Supabase project to this app to start tracking real visitor behavior."
          />
        )}

        {supabaseLinked && !conversionAgentEnabled && (
          <EmptyState
            icon={<TrendingUpIcon size={22} />}
            title="Optimization is off"
            body="Your app is already tracking real visitor behavior. Turn on the toggle above to have Meero find issues and test fixes automatically."
          />
        )}

        {actionError && (
          <p role="alert" className="text-[12px] text-red-600">
            {actionError}
          </p>
        )}

        {supabaseLinked && conversionAgentEnabled && nothingYet && (
          <EmptyState
            icon={<FlaskIcon size={20} />}
            title="Nothing to report yet"
            body={`This takes real time, not just a page refresh: Meero only flags a genuine pattern once enough real visitors have hit the same friction — that can be a few hours or a couple of weeks, depending on how much traffic your app gets. Once something's running, it also waits at least ${CONVERSION_MIN_RUNTIME_DAYS} real days before deciding a winner, so a result is never rushed.`}
          />
        )}

        {openHypotheses.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              <TargetIcon size={12} />
              Found ({openHypotheses.length})
            </h3>
            <div className="flex flex-col gap-4">
              {pageGroups.map(([page, items]) => (
                <div key={page}>
                  {pageGroups.length > 1 && (
                    <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-secondary-foreground">
                      <Badge variant="outline">{page}</Badge>
                      <span className="text-muted-foreground">
                        {items.length} issue{items.length === 1 ? "" : "s"}
                      </span>
                    </p>
                  )}
                  <div className="flex flex-col gap-2.5">
                    {items.map((h) => {
                      const evidence = evidenceLine(h.evidence);
                      const IssueIcon = ISSUE_ICONS[h.issue_type] ?? TargetIcon;
                      return (
                        <div
                          key={h.id}
                          className="rounded-xl border border-border bg-white p-3.5 shadow-primary/10"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                              <IssueIcon size={13} />
                            </span>
                            <span className="text-[13px] font-medium text-foreground">
                              {ISSUE_LABELS[h.issue_type]}
                            </span>
                            {pageGroups.length <= 1 && (
                              <Badge variant="outline">{h.page_path || "/"}</Badge>
                            )}
                          </div>
                          <p className="mt-2 text-[12.5px] leading-relaxed text-secondary-foreground">
                            {h.description}
                          </p>
                          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-muted/60 px-2.5 py-2">
                            <FlaskIcon
                              size={12}
                              className="mt-0.5 shrink-0 text-muted-foreground"
                            />
                            <p className="text-[12px] leading-relaxed text-secondary-foreground">
                              {h.proposed_fix}
                            </p>
                          </div>
                          {evidence && (
                            <p className="mt-1.5 text-[11px] text-muted-foreground">{evidence}</p>
                          )}
                          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                            {autonomyMode === "manual" ? (
                              <button
                                type="button"
                                onClick={() => void launchExperiment(h.id)}
                                disabled={launching === h.id}
                                className="rounded-full bg-foreground px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
                              >
                                {launching === h.id ? "Starting…" : "Test this fix"}
                              </button>
                            ) : (
                              <span className="text-[11.5px] text-muted-foreground">
                                Meero will test this automatically once there&apos;s enough traffic.
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                window.dispatchEvent(
                                  new CustomEvent("meero:chat-prefill", {
                                    detail: `Let's discuss this: ${h.description} Proposed fix: ${h.proposed_fix}`,
                                  }),
                                )
                              }
                              className="text-[12px] text-muted-foreground underline underline-offset-2 transition hover:text-foreground"
                            >
                              Discuss in chat
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {experimentingHypotheses.length > 0 && (
          <p className="-mt-3 text-[11.5px] text-muted-foreground">
            {experimentingHypotheses.length === 1
              ? "1 more is already being tested — see below."
              : `${experimentingHypotheses.length} more are already being tested — see below.`}
          </p>
        )}

        {activeExperiments.length > 0 && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              <FlaskIcon size={12} />
              Testing ({activeExperiments.length})
            </h3>
            <div className="flex flex-col gap-4">
              {activeExperiments.map((exp) => {
                const counts = liveCounts[exp.id];
                // Defensive, not just trusting the query's embedded order:
                // this is the number shown as the headline lift badge, so a
                // stale/wrong "latest" result would show an incorrect
                // figure rather than just a cosmetic glitch.
                const latestResult = [...exp.conversion_results].sort((a, b) =>
                  b.evaluated_at.localeCompare(a.evaluated_at),
                )[0];
                const decided = ["winner_a", "winner_b", "inconclusive"].includes(exp.status);
                // graduation_build_id (real, from props) or justApplied
                // (optimistic, from this click) — either means the
                // decision has already been turned into a real build; the
                // orchestrator itself also rejects a second apply, but
                // hiding the button avoids a pointless 409 in the first
                // place.
                const alreadyApplied = !!exp.graduation_build_id || justApplied.has(exp.id);
                const statusLabel = STATUS_LABELS[exp.status] ?? exp.status;
                const lift = latestResult?.lift_pct;
                const statusTone: "live" | "neutral" | "accent" =
                  exp.status === "winner_b"
                    ? "live"
                    : exp.status === "running"
                      ? "accent"
                      : "neutral";
                return (
                  <div
                    key={exp.id}
                    className="rounded-xl border border-border bg-white p-3.5 shadow-primary/10"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-foreground">
                        <StatusDot
                          tone={statusTone}
                          className={exp.status === "running" ? "motion-safe:animate-pulse" : ""}
                        />
                        {statusLabel}
                      </span>
                      <Badge variant="outline">{exp.experiment_key}</Badge>
                      {lift != null && (
                        <span
                          className={`ml-auto text-[13px] font-semibold tabular-nums ${
                            lift >= 0 ? "text-emerald-600" : "text-muted-foreground"
                          }`}
                        >
                          {lift >= 0 ? "+" : ""}
                          {lift.toFixed(1)}%
                        </span>
                      )}
                    </div>

                    {lift != null &&
                      latestResult?.ci_low_pct != null &&
                      latestResult?.ci_high_pct != null && (
                        <p className="mt-0.5 text-right text-[10.5px] text-muted-foreground">
                          95% confidence: {latestResult.ci_low_pct >= 0 ? "+" : ""}
                          {latestResult.ci_low_pct.toFixed(1)}% to{" "}
                          {latestResult.ci_high_pct >= 0 ? "+" : ""}
                          {latestResult.ci_high_pct.toFixed(1)}%
                        </p>
                      )}

                    {exp.status === "running" && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {(() => {
                          const running = daysSince(exp.started_at);
                          const remaining = CONVERSION_MIN_RUNTIME_DAYS - running;
                          return remaining > 0
                            ? `Started ${running === 0 ? "today" : `${running} day${running === 1 ? "" : "s"} ago`} — Meero won't decide a winner before day ${CONVERSION_MIN_RUNTIME_DAYS}, so it needs at least ${remaining} more day${remaining === 1 ? "" : "s"} of real data.`
                            : "Old enough to decide — Meero checks for a statistically significant result on its next pass.";
                        })()}
                      </p>
                    )}

                    {exp.status === "running" && counts && <SignificanceProgress counts={counts} />}

                    {counts && (
                      <div className="mt-3">
                        <ExperimentLiftChart
                          exposuresA={counts.exposures_a}
                          conversionsA={counts.conversions_a}
                          exposuresB={counts.exposures_b}
                          conversionsB={counts.conversions_b}
                        />
                      </div>
                    )}

                    {counts && counts.by_device.length >= 2 && (
                      <DeviceSegmentBreakdown segments={counts.by_device} />
                    )}

                    {exp.conversion_results.length >= 2 && (
                      <ConversionResultsTimeline results={exp.conversion_results} />
                    )}

                    {decided && autonomyMode === "manual" && (
                      <div className="mt-2.5">
                        {alreadyApplied ? (
                          <span className="text-[11.5px] text-muted-foreground">
                            Applied — see the build activity for progress.
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void applyDecision(exp.id)}
                            disabled={applying === exp.id}
                            className="rounded-full bg-foreground px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
                          >
                            {applying === exp.id
                              ? "Applying…"
                              : exp.status === "winner_b"
                                ? "Keep this fix"
                                : "Revert"}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {supabaseLinked && (
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground">
              <CursorClickIcon size={12} />
              Where visitors click
            </h3>
            <ConversionHeatmap projectId={projectId} pagePaths={heatmapPaths} />
          </section>
        )}
      </div>
    </div>
  );
}

/** Real progress toward having enough data to run the significance test at
 *  all — min(exposures_a, exposures_b) / the real configured minimum
 *  (CONVERSION_MIN_EXPOSURES_PER_VARIANT). Capped visually at 100%; the
 *  underlying count can exceed the minimum while still waiting on
 *  conversion_agent_min_runtime_days, which the paragraph above already
 *  explains. */
function SignificanceProgress({ counts }: { counts: LiveCounts }) {
  const minExposures = Math.min(counts.exposures_a, counts.exposures_b);
  const pct = Math.min(
    100,
    Math.round((minExposures / CONVERSION_MIN_EXPOSURES_PER_VARIANT) * 100),
  );
  return (
    <div className="mt-2">
      <div className="flex items-center justify-between text-[10.5px] text-muted-foreground">
        <span>Sample size</span>
        <span className="tabular-nums">
          {minExposures} / {CONVERSION_MIN_EXPOSURES_PER_VARIANT} per variant
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Real per-device_type exposure/conversion rates for this experiment —
 *  lets you see whether a fix that's winning overall is actually winning on
 *  every device, or just carried by one (e.g. desktop) while doing nothing
 *  or even hurting mobile. Only shown once there are 2+ real device
 *  segments with data — a single segment has nothing to compare against. */
function DeviceSegmentBreakdown({ segments }: { segments: DeviceSegmentCounts[] }) {
  return (
    <div className="mt-3 space-y-1.5 rounded-lg bg-muted/60 px-2.5 py-2">
      <p className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
        By device
      </p>
      {segments.map((s) => {
        const rateA = segmentRate(s.exposures_a, s.conversions_a);
        const rateB = segmentRate(s.exposures_b, s.conversions_b);
        return (
          <div
            key={s.device_type}
            className="flex items-center justify-between gap-3 text-[11.5px]"
          >
            <span className="text-secondary-foreground capitalize">{s.device_type}</span>
            <span className="tabular-nums text-muted-foreground">
              A: {rateA != null ? `${(rateA * 100).toFixed(1)}%` : "—"} · B:{" "}
              {rateB != null ? `${(rateB * 100).toFixed(1)}%` : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="max-w-[320px] text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

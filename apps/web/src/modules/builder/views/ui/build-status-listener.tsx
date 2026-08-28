"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  useProjectActivity,
  type WsEvent,
} from "@/modules/builder/providers/project-activity-context";
import { createClient } from "@/lib/supabase/client";
import type { Build } from "@/lib/types";

const POLL_MS = 5000;

/**
 * Subscribes to the orchestrator's WebSocket for this project and refreshes
 * the (server-rendered) builder whenever a real build changes state.
 *
 * Also polls while any build is queued/running — a fallback for the rare
 * case a worker host can't reach a locally-hosted Redis for the WebSocket
 * push. Supabase is still updated correctly either way; this just makes sure
 * the UI catches up even when the instant push doesn't arrive.
 */
export function BuildStatusListener({
  projectId,
  builds,
  autonomyMode = "solo",
}: {
  projectId: string;
  builds: Build[];
  /** Manual mode (00028_autonomy_mode.sql): never auto-fire the AI fix —
   *  the user gets a real "Auto-fix" button on the failed build instead
   *  (see AutoFixButton), same real /auto-fix call, just user-triggered. */
  autonomyMode?: "solo" | "manual";
}) {
  const router = useRouter();
  const { applyEvent } = useProjectActivity();
  const inFlight = builds.some((b) => b.status === "queued" || b.status === "running");

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    if (!base) return;

    let ws: WebSocket | null = null;
    let closed = false;

    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session || closed) return;

      const wsBase = base.replace(/^http/, "ws");
      ws = new WebSocket(
        `${wsBase}/ws/projects/${projectId}?token=${encodeURIComponent(session.access_token)}`,
      );
      ws.onmessage = (msg) => {
        let event: WsEvent | null = null;
        try {
          event = JSON.parse(msg.data);
        } catch {
          return; // non-JSON payload — ignore
        }
        if (!event) return;

        // Every event updates the live pipeline the chat renders.
        applyEvent(event);

        // Only events that actually change server-persisted data
        // (build rows, generated files, preview URL) warrant a refetch.
        // build.phase / build.coding_file / runtime_monitor.detected are
        // live-only, no refresh needed.
        if (
          event.type === "build.status" ||
          event.type === "build.code" ||
          event.type === "build.preview" ||
          event.type === "runtime_monitor.verified" ||
          event.type === "runtime_monitor.regression" ||
          // conversion.* (00042_conversion_agent.sql) — every one of these
          // reflects a real change to conversion_hypotheses/experiments/
          // results, which the Conversion tab reads as server-fetched props
          // (page.tsx). Unlike build events these are inherently low-
          // frequency (poll-cycle-derived, never per-raw-tracked-event), so
          // there's no live-only variant to exclude here the way
          // build.coding_file is excluded above.
          event.type === "conversion.hypothesis_detected" ||
          event.type === "conversion.experiment_launched" ||
          event.type === "conversion.experiment_live" ||
          event.type === "conversion.experiment_launch_failed" ||
          event.type === "conversion.experiment_decided" ||
          event.type === "conversion.experiment_graduated" ||
          event.type === "conversion.experiment_reverted"
        ) {
          router.refresh();
        }
      };
    })();

    return () => {
      closed = true;
      ws?.close();
    };
  }, [projectId, router, applyEvent]);

  useEffect(() => {
    if (!inFlight) return;
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [inFlight, router]);

  // Auto-fix: the moment an *original* build (never itself a fix attempt)
  // shows a real failure with no fix already queued, ask the orchestrator
  // for the one automatic AI retry. This is a genuine second codegen call
  // fed the real compiler error, then a genuine second compile — never a
  // mock — and it spends a real credit like any build. Capped to one hop:
  // the orchestrator refuses to chain a fix onto a fix.
  const attempted = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (autonomyMode === "manual") return;
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    if (!base) return;

    const candidate = builds.find(
      (b) =>
        b.status === "failed" && !b.retry_of && !builds.some((other) => other.retry_of === b.id),
    );
    if (!candidate || attempted.current.has(candidate.id)) return;
    attempted.current.add(candidate.id);

    (async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch(`${base}/builds/${candidate.id}/auto-fix`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      // 402 (no credits left) / 409 (a fix already exists — another tab won
      // the race) both mean "leave the real failure as-is"; no retry storm.
      if (res.ok) router.refresh();
    })();
  }, [builds, router, autonomyMode]);

  return null;
}

"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * A real, working Stop — POSTs to the orchestrator's /builds/{id}/cancel,
 * which raises the actual cancel signal the workers poll (killing an
 * in-progress `next build` subprocess, or breaking out of a streaming LLM
 * call), marks the build "canceled", and fully refunds the flat build cost.
 * No manual refresh needed: the DB write pushes a real `build.status`
 * WebSocket event, which BuildStatusListener already reacts to.
 */
export function StopBuildButton({ buildId }: { buildId: string | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    if (!buildId || pending) return;
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      if (!base || !session) throw new Error("Session expired — reload and sign in again.");
      const res = await fetch(`${base}/builds/${buildId}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Stop failed (${res.status}).`);
      }
      // Build status flips via the real WS event; nothing else to do here.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't stop the build.");
      setPending(false);
    }
  }

  if (!buildId) return null;

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => void stop()}
        disabled={pending}
        title="Stop this build — fully refunds its cost"
        className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-secondary-foreground transition hover:border-red-300 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        <span className="size-1.5 rounded-sm bg-current" aria-hidden />
        {pending ? "Stopping…" : "Stop"}
      </button>
      {error && <span className="text-[10.5px] text-red-600">{error}</span>}
    </span>
  );
}

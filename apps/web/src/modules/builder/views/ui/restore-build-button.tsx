"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Real version-control rollback: copies an earlier succeeded build's exact
 * stored source onto a brand-new build and runs it through the normal
 * pipeline (schema re-applied, a real `next build`, a real commit to
 * main) — see POST /builds/{id}/restore. The version being restored TO is
 * never touched or deleted, so it can always be restored to again later.
 */
export function RestoreBuildButton({ buildId }: { buildId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function restore() {
    if (pending) return;
    if (
      !window.confirm(
        "Roll back to this version? This runs a real rebuild from this version's exact code — your current version stays in history and you can restore forward to it again anytime.",
      )
    ) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!base || !session) {
        setError("Session expired — reload and sign in again.");
        return;
      }
      const res = await fetch(`${base}/builds/${buildId}/restore`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body.detail === "string" ? body.detail : `Restore failed (${res.status}).`,
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore this version.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void restore()}
        disabled={pending}
        className="shrink-0 rounded-lg border border-border bg-white px-2.5 py-1 text-[12px] font-medium text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error && (
        <p role="alert" className="max-w-[200px] text-right text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

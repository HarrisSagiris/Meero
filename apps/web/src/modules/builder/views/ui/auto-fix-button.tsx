"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Manual-mode counterpart to the automatic auto-fix trigger in
 * build-status-listener.tsx: same real endpoint (a genuine second codegen
 * call fed the actual compiler error, then a genuine second compile), just
 * user-triggered instead of firing the moment a build fails — Manual mode
 * (00028_autonomy_mode.sql) means Meero waits for a real click before
 * spending a credit on an AI fix attempt.
 */
export function AutoFixButton({ buildId }: { buildId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fix() {
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
      const res = await fetch(`${base}/builds/${buildId}/auto-fix`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body.detail === "string" ? body.detail : `Auto-fix failed (${res.status}).`,
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the auto-fix.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => void fix()}
        disabled={pending}
        className="rounded-lg bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "Starting…" : "Auto-fix with AI"}
      </button>
      {error && (
        <p role="alert" className="max-w-[220px] text-center text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

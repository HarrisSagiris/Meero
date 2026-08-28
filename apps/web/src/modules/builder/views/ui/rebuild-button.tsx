"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

/**
 * Plain re-run of the CURRENT version's exact stored code — no spec change,
 * no codegen call (see POST /projects/{id}/rebuild). Different from asking
 * Meero in chat to "rebuild without changing anything": that still runs a
 * real planning + codegen pass and creates a new spec version even when
 * nothing changes. This just reapplies schema.sql and reruns `next build`
 * against the exact same generated source — useful when the app itself is
 * fine but something in the environment might have drifted (e.g. the linked
 * Supabase schema was hand-edited).
 */
export function RebuildButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rebuild() {
    if (pending) return;
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
      const res = await fetch(`${base}/projects/${projectId}/rebuild`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body.detail === "string" ? body.detail : `Rebuild failed (${res.status}).`,
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rebuild.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void rebuild()}
        disabled={pending}
        title="Re-run the exact same code — no changes, just a fresh build"
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-[12px] font-medium text-foreground transition hover:border-foreground disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshIcon size={12} className={pending ? "animate-spin" : ""} />
        {pending ? "Rebuilding…" : "Rebuild"}
      </button>
      {error && (
        <p role="alert" className="max-w-[200px] text-right text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

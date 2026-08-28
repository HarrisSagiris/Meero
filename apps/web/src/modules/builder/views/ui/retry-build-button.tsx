"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Re-runs a failed build from scratch: same spec, same platform, a fresh
 * codegen call and a fresh real compile — a plain "try again". Distinct from
 * the automatic auto-fix (which feeds the compiler error back into codegen to
 * change the code): this is for when the failure wasn't really about the
 * generated code — a transient install/network hiccup, or an infra bug that's
 * since been fixed — where regenerating from the error would be pointless.
 */
export function RetryBuildButton({ buildId }: { buildId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
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
      const res = await fetch(`${base}/builds/${buildId}/retry`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          typeof body.detail === "string" ? body.detail : `Retry failed (${res.status}).`,
        );
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not retry the build.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => void retry()}
        disabled={pending}
        className="rounded-lg bg-foreground px-3.5 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Retrying…" : "Retry build"}
      </button>
      {error && (
        <p role="alert" className="max-w-[220px] text-center text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

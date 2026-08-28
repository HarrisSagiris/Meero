"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SupabaseIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

type SupabaseProject = {
  ref: string;
  name: string;
  region?: string;
  status?: string;
};

/**
 * Real Supabase connect — no mocks, and no picker in the common case.
 * "Connect" starts an actual OAuth redirect against api.supabase.com
 * (orchestrator-brokered); once the account is connected, the orchestrator
 * auto-provisions a brand-new real Supabase project on the user's behalf
 * and links it once it comes ACTIVE (00045_supabase_auto_provision.sql) —
 * connecting the account is the only step. While that's in flight this
 * polls GET /projects/{id}/supabase/status (same shape as DomainManager's
 * poll) and shows a real "setting up your database" state. If
 * auto-provisioning genuinely fails (e.g. no Supabase organization on the
 * account), the manual picker — listing the user's REAL existing Supabase
 * projects — is offered as a fallback. The linked state links out to the
 * Supabase dashboard.
 */
export function SupabaseButton({
  projectId,
  connected,
  linkedRef,
  provisioningStatus,
  provisioningError,
}: {
  projectId: string;
  /** profiles.supabase_connected — the account-level OAuth connection. */
  connected: boolean;
  /** projects.supabase_project_ref — this project's linked Supabase. */
  linkedRef: string | null;
  /** projects.supabase_provisioning_status — real in-flight auto-setup
   *  state (00045). Null once linked, or if nothing was ever provisioned. */
  provisioningStatus?: "provisioning" | "failed" | null;
  provisioningError?: string | null;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState<SupabaseProject[] | null>(null);

  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  // Real auto-provisioning is in flight — poll its real status until it
  // resolves (linked or failed), then refresh so the server-rendered props
  // pick up the new state. Mirrors DomainManager's 15s poll-while-unverified.
  useEffect(() => {
    if (provisioningStatus !== "provisioning") return;
    let cancelled = false;
    async function tick() {
      const auth = await authHeader();
      if (!auth || cancelled) return;
      try {
        const res = await fetch(`${auth.base}/projects/${projectId}/supabase/status`, {
          headers: auth.headers,
        });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && body.provisioning_status !== "provisioning") {
          router.refresh();
        }
      } catch {
        // transient — next tick tries again
      }
    }
    const id = setInterval(() => void tick(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provisioningStatus, projectId]);

  async function authHeader() {
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!base || !session) {
      setError(
        base
          ? "Session expired — reload and sign in again."
          : "Orchestrator is not configured (NEXT_PUBLIC_ORCHESTRATOR_URL).",
      );
      return null;
    }
    return {
      base,
      headers: { Authorization: `Bearer ${session.access_token}` },
    };
  }

  async function connect() {
    setPending(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setPending(false);
      return;
    }
    try {
      const res = await fetch(
        `${auth.base}/auth/supabase/authorize?project_id=${encodeURIComponent(projectId)}`,
        { headers: auth.headers },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Supabase connect.");
      setPending(false);
    }
  }

  async function openPicker() {
    setPickerOpen(true);
    setError(null);
    if (projects !== null) return;
    const auth = await authHeader();
    if (!auth) return;
    try {
      const res = await fetch(`${auth.base}/supabase/projects`, {
        headers: auth.headers,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setProjects(body.projects as SupabaseProject[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't list your Supabase projects.");
      setPickerOpen(false);
    }
  }

  async function link(ref: string) {
    setPending(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setPending(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/projects/${projectId}/supabase/link`, {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ project_ref: ref }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setPickerOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't link the Supabase project.");
    } finally {
      setPending(false);
    }
  }

  if (linkedRef) {
    return (
      <a
        href={`https://supabase.com/dashboard/project/${linkedRef}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Linked to your Supabase project ${linkedRef} — every build applies its schema there. Open the dashboard.`}
        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition bg-muted text-foreground"
      >
        <SupabaseIcon size={15} className="text-emerald-600" />
        <span className="hidden max-w-[90px] truncate font-mono text-[11px] sm:block">
          {linkedRef}
        </span>
      </a>
    );
  }

  // A real new Supabase project is being created on the user's account
  // right now (00045) — nothing to click, just an honest wait state.
  if (connected && provisioningStatus === "provisioning") {
    return (
      <span
        title="Meero is creating a new Supabase project for this app — this takes a minute."
        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-secondary-foreground"
      >
        <span className="size-3 animate-spin rounded-full border-2 border-input border-t-primary" />
        <span className="hidden sm:block">Setting up your database…</span>
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={connected ? openPicker : connect}
        disabled={pending}
        title={
          connected
            ? provisioningStatus === "failed"
              ? (provisioningError ??
                "Automatic setup failed — pick an existing Supabase project instead.")
              : "Pick which of your Supabase projects this app's database and auth live in"
            : "Connect your Supabase account — Meero creates and links a new database automatically"
        }
        aria-label={connected ? "Link a Supabase project" : "Connect Supabase"}
        className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition bg-secondary hover:bg-foreground/10 disabled:opacity-50 ${
          connected && provisioningStatus === "failed"
            ? "text-red-600 hover:text-red-700"
            : "text-secondary-foreground hover:text-foreground"
        }`}
      >
        <SupabaseIcon size={15} />
        <span className="hidden sm:block">
          {connected
            ? provisioningStatus === "failed"
              ? "Pick a project manually"
              : "Link Supabase"
            : "Connect Supabase"}
        </span>
      </button>

      {pickerOpen && (
        <div className="animate-pop absolute top-full right-0 z-40 mt-2 w-64 rounded-2xl border border-border bg-white p-1.5 shadow-composer">
          <p className="px-3 py-2 text-[11px] font-medium tracking-wide text-muted-foreground">
            YOUR SUPABASE PROJECTS
          </p>
          {projects === null ? (
            <div className="flex justify-center py-4">
              <span className="size-4 animate-spin rounded-full border-2 border-input border-t-primary" />
            </div>
          ) : projects.length === 0 ? (
            <p className="px-3 pb-3 text-[12px] leading-relaxed text-muted-foreground">
              No projects found — create one at database.new, then reopen this picker.
            </p>
          ) : (
            projects.map((p) => (
              <button
                key={p.ref}
                type="button"
                disabled={pending}
                onClick={() => void link(p.ref)}
                className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left transition hover:bg-muted disabled:opacity-50"
              >
                <span className="w-full truncate text-[13px] font-medium text-foreground">
                  {p.name}
                </span>
                <span className="w-full truncate font-mono text-[10.5px] text-muted-foreground">
                  {p.ref}
                  {p.region ? ` · ${p.region}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-56 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] leading-relaxed text-red-700 shadow-primary/10"
        >
          {error}
        </p>
      )}
    </div>
  );
}

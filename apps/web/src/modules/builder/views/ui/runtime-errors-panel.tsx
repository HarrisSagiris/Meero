"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type RuntimeError = {
  id: string;
  message: string;
  stack?: string | null;
  path?: string | null;
  created_at?: string | null;
};

/**
 * Surfaces REAL runtime errors captured from the project's live app. Every
 * generated app ships a client error reporter (a required file, like the
 * badge) that writes runtime errors into a `_meero_runtime_errors` table on
 * the user's own Supabase; the orchestrator reads them back via the
 * Management API (GET /projects/{id}/runtime-errors). "Fix with Meero"
 * triggers a REAL autonomous fix (POST .../runtime-errors/fix — a genuine
 * codegen call fed the real error, then a real build that ships as a
 * reviewable GitHub PR); the build's own progress shows up in the normal
 * live build activity feed. "Discuss in chat" is the manual fallback —
 * nothing fabricated either way, only errors that actually happened in
 * production.
 */
export function RuntimeErrorsPanel({ projectId }: { projectId: string }) {
  const [errors, setErrors] = useState<RuntimeError[]>([]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  // True while Meero's 24/7 monitoring agent (app/runtime_monitor.py) already
  // has an autonomous fix queued/running/being verified for this project —
  // avoids a redundant competing manual fix racing the automatic one.
  const [autonomousFixInProgress, setAutonomousFixInProgress] = useState(false);

  async function auth() {
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!base || !session) return null;
    return {
      base,
      headers: { Authorization: `Bearer ${session.access_token}` },
    };
  }

  async function load() {
    const a = await auth();
    if (!a) return;
    try {
      const res = await fetch(`${a.base}/projects/${projectId}/runtime-errors`, {
        headers: a.headers,
      });
      if (!res.ok) return;
      const body = await res.json();
      setErrors(Array.isArray(body?.errors) ? body.errors : []);
      setAutonomousFixInProgress(!!body?.autonomous_fix_in_progress);
    } catch {
      // Telemetry read is best-effort — never disrupt the builder.
    }
  }

  useEffect(() => {
    // load() is async — its setState runs after the fetch resolves, not
    // synchronously — so this is a normal "fetch on mount" effect. Re-check
    // periodically so newly-captured production errors surface on their own.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function dismiss(ids: string[]) {
    setErrors((prev) => prev.filter((e) => !ids.includes(e.id)));
    const a = await auth();
    if (!a) return;
    await fetch(`${a.base}/projects/${projectId}/runtime-errors/resolve`, {
      method: "POST",
      headers: { ...a.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ error_ids: ids }),
    }).catch(() => {});
  }

  function discussInChat(err: RuntimeError) {
    const prompt =
      `A runtime error is happening in the live app` +
      (err.path ? ` on the ${err.path} page` : "") +
      `:\n\n${err.message}` +
      (err.stack ? `\n\n${err.stack.slice(0, 1200)}` : "") +
      `\n\nPlease find the cause and fix it.`;
    window.dispatchEvent(new CustomEvent("meero:chat-prefill", { detail: prompt }));
    void dismiss([err.id]);
  }

  async function fixWithMeero(err: RuntimeError) {
    setFixError(null);
    setFixing(err.id);
    const a = await auth();
    if (!a) {
      setFixError("Session expired — reload and sign in again.");
      setFixing(null);
      return;
    }
    try {
      const res = await fetch(`${a.base}/projects/${projectId}/runtime-errors/fix`, {
        method: "POST",
        headers: { ...a.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: err.message,
          stack: err.stack,
          path: err.path,
          error_id: err.id,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      // A real build was just queued — its progress shows up in the normal
      // live build activity feed, so just drop it from this list.
      setErrors((prev) => prev.filter((e) => e.id !== err.id));
    } catch (e) {
      setFixError(e instanceof Error ? e.message : "Could not start the fix.");
    } finally {
      setFixing(null);
    }
  }

  if (errors.length === 0) return null;

  return (
    <div className="border-t border-red-200 bg-red-50/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white">
          {errors.length}
        </span>
        <span className="text-[12.5px] font-semibold text-red-700">
          {errors.length === 1
            ? "1 runtime error in your live app"
            : `${errors.length} runtime errors in your live app`}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`ml-auto text-red-500 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="m5 8 5 5 5-5" />
        </svg>
      </button>

      {open && (
        <div className="max-h-64 space-y-2 overflow-auto px-3 pb-3">
          {autonomousFixInProgress && (
            <p className="px-1 text-[11px] font-medium text-secondary-foreground">
              Meero is already auto-fixing these — no need to click Fix with Meero.
            </p>
          )}
          {fixError && (
            <p role="alert" className="px-1 text-[11px] text-red-600">
              {fixError}
            </p>
          )}
          {errors.map((err) => (
            <div
              key={err.id}
              className="rounded-xl border border-red-200 bg-white p-3 shadow-primary/10"
            >
              <p className="font-mono text-[12px] leading-relaxed break-words text-red-700">
                {err.message}
              </p>
              {err.path && (
                <p className="mt-1 text-[11px] text-secondary-foreground">
                  at <span className="font-mono">{err.path}</span>
                </p>
              )}
              {err.stack && (
                <button
                  type="button"
                  onClick={() => setExpanded((x) => (x === err.id ? null : err.id))}
                  className="mt-1.5 text-[11px] font-medium text-secondary-foreground underline underline-offset-2 hover:text-foreground"
                >
                  {expanded === err.id ? "Hide" : "Show"} stack trace
                </button>
              )}
              {expanded === err.id && err.stack && (
                <pre className="mt-1.5 max-h-32 overflow-auto rounded-lg bg-muted p-2 font-mono text-[10.5px] leading-relaxed text-secondary-foreground">
                  {err.stack}
                </pre>
              )}
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fixWithMeero(err)}
                  disabled={fixing === err.id || autonomousFixInProgress}
                  title={autonomousFixInProgress ? "Meero is already auto-fixing these" : undefined}
                  className="flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
                >
                  {fixing === err.id && (
                    <span className="size-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  )}
                  {fixing === err.id ? "Starting fix…" : "Fix with Meero"}
                </button>
                <button
                  type="button"
                  onClick={() => discussInChat(err)}
                  className="text-[12px] font-medium text-secondary-foreground underline underline-offset-2 transition hover:text-foreground"
                >
                  Discuss in chat
                </button>
                <button
                  type="button"
                  onClick={() => void dismiss([err.id])}
                  className="ml-auto rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-secondary-foreground transition hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

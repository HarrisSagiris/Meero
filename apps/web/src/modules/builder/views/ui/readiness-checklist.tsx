"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Check = {
  key: string;
  label: string;
  passed: boolean | null;
  detail?: string | null;
};

/**
 * Plain-English "is my app ready?" checklist — for the non-technical owner,
 * not a developer. Every check here is a REAL one, run by the web worker
 * with a headless browser against the actual live app right after each
 * successful build (see orchestrator/app/readiness_check.py): a genuine
 * signup, a genuine login, and a genuine anonymous read confirming private
 * tables are actually blocked — never inferred from the code. A check that
 * can't be run generically and safely (no owner-scoped table yet) shows as
 * "not checked yet" rather than a fake pass.
 */
export function ReadinessChecklist({ projectId }: { projectId: string }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!base || !session) return;
      try {
        const res = await fetch(`${base}/projects/${projectId}/readiness`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || cancelled) return;
        const body = await res.json();
        if (!cancelled) setChecks(Array.isArray(body?.checks) ? body.checks : []);
      } catch {
        // Best-effort read — never disrupt the preview.
      }
    }
    void load();
    const id = setInterval(() => void load(), 45_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [projectId]);

  if (!checks || checks.length === 0) return null;

  const passedCount = checks.filter((c) => c.passed === true).length;
  const failedCount = checks.filter((c) => c.passed === false).length;

  // A compact square-rounded chip, sitting in the preview's address bar
  // (see PreviewAddressBar in preview-pane.tsx) — collapsed by default so
  // it never pushes the app view down. Click to drop the full checklist
  // open beneath it.
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-white/90 py-1 pr-2.5 pl-1 shadow-primary/10 backdrop-blur-sm transition hover:bg-white"
      >
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-full text-white ${
            failedCount > 0 ? "bg-amber-500" : "bg-emerald-500"
          }`}
        >
          {failedCount > 0 ? (
            <span className="text-[11px] font-bold">{failedCount}</span>
          ) : (
            <svg
              width="11"
              height="11"
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
          )}
        </span>
        <span className="text-[11.5px] font-medium text-secondary-foreground">
          {failedCount > 0 ? `${passedCount}/${checks.length} checks` : "Ready"}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-20 mt-2 w-72 rounded-xl border border-border bg-white p-3 shadow-primary/10">
          <p className="mb-2 text-[12.5px] font-semibold text-foreground">
            {failedCount > 0
              ? `Is your app ready? ${passedCount}/${checks.length} checks passed`
              : "Your app passed its readiness checks"}
          </p>
          <ul className="space-y-1.5">
            {checks.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                <span
                  className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-white ${
                    c.passed === true
                      ? "bg-emerald-500"
                      : c.passed === false
                        ? "bg-amber-500"
                        : "bg-input"
                  }`}
                  aria-hidden
                >
                  {c.passed === true && (
                    <svg
                      width="9"
                      height="9"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m4 10.5 4 4 8-9" />
                    </svg>
                  )}
                  {c.passed === false && (
                    <svg
                      width="8"
                      height="8"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                    >
                      <path d="M5 5l10 10M15 5 5 15" />
                    </svg>
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-foreground">
                    {c.passed === null ? `${c.label} — not checked yet` : c.label}
                  </p>
                  {c.passed === false && c.detail && (
                    <p className="mt-0.5 text-[11px] leading-relaxed text-secondary-foreground">
                      {c.detail}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

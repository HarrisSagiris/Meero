"use client";

import { useState } from "react";
import type { Build } from "@/lib/types";

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-2.5 font-mono text-[11px] leading-relaxed">
      {lines.map((line, i) => {
        let cls = "text-secondary-foreground";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          cls = "text-emerald-700 bg-emerald-50";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          cls = "text-red-700 bg-red-50";
        } else if (line.startsWith("@@")) {
          cls = "text-muted-foreground";
        }
        return (
          <div key={i} className={`px-1 whitespace-pre-wrap ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}

/**
 * Shows what Meero's last build actually changed, for the LATEST build
 * only — a real diff per file (codegen.py's diff_files, never a
 * description of one) plus a plain-English explanation. This covers two
 * real cases: an auto-fix (`build.retry_of` set), and a normal chat
 * iteration grounded in the app's previous code (codegen_worker.py's
 * generate_project(..., previous_files=...) path) — both populate the
 * exact same fields, so this card doesn't distinguish the trigger, only
 * what changed. `targeted` means only the implicated file(s) were
 * regenerated; every other file was carried forward byte-for-byte, not
 * rewritten. Disappears the moment a newer build supersedes it (this only
 * ever reads the latest build).
 *
 * Rendered as a compact floating pill (matching PreviewLinkPill /
 * ReadinessChecklist) — collapsed by default so it never pushes the app
 * view down; click it to drop the explanation + diffs open beneath it.
 */
export function FixExplanationCard({ build }: { build: Build }) {
  const [open, setOpen] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  if (build.status !== "succeeded" || !build.fix_explanation || !build.fix_diff) {
    return null;
  }

  const { targeted, changed_paths, diffs } = build.fix_diff;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-white/90 py-1 pr-2.5 pl-1 shadow-primary/10 backdrop-blur-sm transition hover:bg-white"
      >
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
        <span className="text-[11.5px] font-medium text-secondary-foreground">
          {targeted
            ? `${changed_paths.length} file${changed_paths.length === 1 ? "" : "s"} changed`
            : "Updated"}
        </span>
      </button>

      {open && (
        <div className="absolute top-full left-0 z-20 mt-2 w-80 space-y-3 rounded-xl border border-border bg-white p-3 shadow-primary/10">
          <p className="text-[12.5px] font-semibold text-foreground">
            Meero updated it —{" "}
            {targeted
              ? `${changed_paths.length} file${changed_paths.length === 1 ? "" : "s"} changed`
              : "updated the project"}
          </p>
          <p className="text-[13px] leading-relaxed text-secondary-foreground">
            {build.fix_explanation}
          </p>

          {changed_paths.length > 0 && (
            <div className="max-h-64 space-y-1.5 overflow-auto">
              {changed_paths.map((path) => (
                <div key={path} className="rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setExpandedFile((f) => (f === path ? null : path))}
                    className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left font-mono text-[11.5px] font-medium text-foreground"
                  >
                    <span className="text-emerald-600">±</span>
                    {path}
                    <span className="ml-auto text-[10.5px] text-muted-foreground">
                      {expandedFile === path ? "Hide diff" : "Show diff"}
                    </span>
                  </button>
                  {expandedFile === path && diffs[path] && (
                    <div className="border-t border-border p-1.5">
                      <DiffView diff={diffs[path]} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

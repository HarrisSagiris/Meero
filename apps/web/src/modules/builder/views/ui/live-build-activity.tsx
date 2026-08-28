"use client";

import { useEffect, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { ChevronDownIcon, ShieldIcon, SparkleIcon } from "@/components/icons";
import {
  useProjectActivity,
  type AutonomousFix,
  type BuildPhase,
  type LiveFile,
  type LivePlan,
} from "@/modules/builder/providers/project-activity-context";
import { StopBuildButton } from "@/modules/builder/views/ui/stop-build-button";
import ShinyText from "@/components/ui/shiny-text";

/** Which orb animation best matches what the backend is actually doing. */
const PHASE_ORB_STATE: Partial<
  Record<BuildPhase, "working" | "searching" | "solving" | "shaping">
> = {
  queued: "working",
  generating_code: "searching",
  fixing_code: "solving",
  code_ready: "shaping",
  applying_schema: "shaping",
  bundling: "working",
};

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

/**
 * Pipeline milestones in order. Each one is revealed as its own small box the
 * moment the real backend phase reaches it — never all shown upfront. The
 * labels read like the assistant narrating what it just did / is doing now.
 */
const MILESTONES: {
  key: string;
  active: (isFix: boolean) => string;
  done: (fileCount: number | null) => string;
}[] = [
  {
    key: "generate",
    active: (isFix) => (isFix ? "Fixing the code" : "Coding the app"),
    done: (fc) => (fc ? `Wrote ${fc} file${fc === 1 ? "" : "s"}` : "Wrote the code"),
  },
  {
    key: "schema",
    active: () => "Applying the database schema",
    done: () => "Schema is live in your Supabase",
  },
  {
    key: "bundle",
    active: () => "Building with Next.js",
    done: () => "App is live",
  },
];

/** Maps a real backend phase to the milestone index it belongs to. */
const PHASE_STEP: Record<BuildPhase, number> = {
  queued: 0,
  generating_code: 0,
  fixing_code: 0,
  code_ready: 1,
  applying_schema: 1,
  bundling: 2,
  succeeded: 2,
  failed: -1,
  canceled: -1,
};

/** Conversational one-liner for the current phase — the "chat" narration.
 *  Reflects the REAL file currently streaming in when one is available,
 *  rather than a static line that never changes. */
function narrate(
  phase: BuildPhase,
  isFix: boolean,
  currentFile: string | null,
  hasBuiltBefore: boolean,
): string {
  switch (phase) {
    case "queued":
      return "Getting everything ready…";
    case "generating_code":
      if (currentFile) return `Writing ${currentFile}…`;
      if (isFix) return "Reworking the plan to fix the error…";
      return hasBuiltBefore
        ? "Updating the app before writing any code…"
        : "Planning the app before writing any code…";
    case "fixing_code":
      if (currentFile) return `Rewriting ${currentFile} to fix the error…`;
      return "That last build hit an error. I'm rewriting the code to fix it.";
    case "code_ready":
      return "Code's ready. Setting up your database next.";
    case "applying_schema":
      return "Applying the app's schema to your real Supabase database…";
    case "bundling":
      return "Building the real Next.js app — installing components, compiling…";
    case "succeeded":
      return "Done! Your app is live — open the Preview tab to use it.";
    case "failed":
      return isFix
        ? "The fix didn't take — here's the build error."
        : "The build hit an error. I'll take one automatic pass at fixing it.";
    case "canceled":
      return "Build canceled.";
    default:
      return "";
  }
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return (
    <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
      {m > 0 ? `${m}m ` : ""}
      {s}s
    </span>
  );
}

/**
 * One revealed milestone box. In-progress steps are just shiny text — no
 * spinner; done shows a check, error shows an X.
 */
function AchievementBox({ state, label }: { state: "done" | "active" | "error"; label: string }) {
  return (
    <div
      className={`animate-pop flex items-center gap-2.5 rounded-xl border px-3 py-2 shadow-primary/10 ${
        state === "error" ? "border-red-200 bg-red-50/60" : "border-border bg-white"
      }`}
    >
      {state === "done" ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
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
      ) : state === "error" ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
          <svg
            width="10"
            height="10"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M5 5l10 10M15 5 5 15" />
          </svg>
        </span>
      ) : null}
      {state === "active" ? (
        <ShinyText
          text={label}
          speed={1.6}
          color="#8a8a8a"
          shineColor="#0a0a0a"
          className="text-[13px] font-medium"
        />
      ) : (
        <span
          className={`text-[13px] font-medium ${
            state === "error" ? "text-red-600" : "text-foreground"
          }`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * The plan actually streaming in, live, straight from the planner LLM's own
 * structured-output feed — title and summary appear first (in that order,
 * matching the schema), then each view's name as the model commits to it.
 * Only rendered before any file has started coding (see LiveBuildActivity),
 * so "Planning the app…" never sits on a blank screen for 10-20s.
 */
function LivePlanPreview({ plan }: { plan: LivePlan }) {
  const views = (plan.views ?? []).filter((v) => v.name);
  if (!plan.title && !plan.summary && views.length === 0) return null;

  return (
    <div className="animate-pop mt-3 rounded-xl border border-border bg-muted/40 px-3.5 py-3">
      {plan.title && <p className="text-[12.5px] font-semibold text-foreground">{plan.title}</p>}
      {plan.summary && (
        <p className="mt-1 text-[12.5px] leading-relaxed text-secondary-foreground">
          {plan.summary}
        </p>
      )}
      {views.length > 0 && (
        <ul className="mt-2 space-y-1">
          {views.map((v, i) => (
            <li
              key={`${v.name}-${i}`}
              className="animate-pop flex items-center gap-1.5 text-[12px] text-secondary-foreground"
            >
              <span className="size-1 shrink-0 rounded-full bg-secondary-foreground/50" />
              {v.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every plan field worth a human reading, once it's finished streaming —
 *  behind a closed-by-default toggle so it doesn't compete with the live
 *  preview above while planning is still happening, but stays reviewable
 *  afterward (same pattern as the file list's toggle). */
function PlanDetailsToggle({ plan }: { plan: LivePlan }) {
  const [expanded, setExpanded] = useState(false);
  const views = plan.views ?? [];
  const fields: { label: string; value?: string }[] = [
    { label: "Who can do what", value: plan.auth },
    { label: "Data model", value: plan.tables },
    { label: "Design direction", value: plan.design },
    { label: "Security", value: plan.security },
  ].filter((f) => f.value);

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-2 py-1 text-left"
      >
        <span className="shrink-0 text-secondary-foreground">
          <SparkleIcon size={14} />
        </span>
        <span className="text-[13px] font-medium text-foreground">
          {plan.title ? `Plan: ${plan.title}` : "View the plan"}
        </span>
        <ChevronDownIcon
          size={12}
          className={`ml-auto shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="ml-[7px] space-y-3 border-l border-border py-1.5 pl-3.5">
          {plan.summary && (
            <p className="text-[12.5px] leading-relaxed text-secondary-foreground">
              {plan.summary}
            </p>
          )}
          {views.length > 0 && (
            <div>
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Views
              </p>
              <ul className="mt-1 space-y-1.5">
                {views.map((v, i) => (
                  <li key={`${v.name}-${i}`} className="text-[12.5px]">
                    <span className="font-medium text-foreground">{v.name}</span>
                    {v.purpose && <span className="text-secondary-foreground"> — {v.purpose}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {fields.map((f) => (
            <div key={f.label}>
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {f.label}
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-secondary-foreground">
                {f.value}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The reason this particular build exists — Meero's 24/7 monitoring agent
 * (orchestrator's app/runtime_monitor.py) found real production errors and
 * is fixing them with no human click, driven entirely by the real
 * runtime_monitor.* WS events. `verified` is a genuine tri-state: while
 * null the fix's own readiness checks haven't landed yet, true only once
 * they actually passed, false on a real regression — never a fabricated
 * "it worked."
 */
function AutonomousFixBanner({ fix }: { fix: AutonomousFix }) {
  if (fix.verified === true) {
    return (
      <div className="animate-pop mt-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <ShieldIcon size={12} />
        </span>
        <p className="text-[13px] font-medium text-emerald-700">
          Verified — the fix passed all readiness checks. The original error is resolved.
        </p>
      </div>
    );
  }

  if (fix.verified === false) {
    const failedLabel = fix.failedChecks.length
      ? `Failed: ${fix.failedChecks.map((c) => c.label ?? c.key).join(", ")}.`
      : fix.detail;
    return (
      <div className="animate-pop mt-3 rounded-xl border border-red-200 bg-red-50/60 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
            <ShieldIcon size={12} />
          </span>
          <p className="text-[13px] font-medium text-red-600">
            Meero&apos;s fix didn&apos;t pass verification — the original error is still open.
          </p>
        </div>
        <p className="mt-1.5 pl-7 text-[12px] leading-relaxed text-red-700/90">
          {failedLabel} Review the PR before merging.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-pop mt-3 flex items-center gap-2 rounded-xl border border-border bg-primary/5 px-3.5 py-2.5">
      <span className="shrink-0 text-primary">
        <ShieldIcon size={16} />
      </span>
      <ShinyText
        text={`Meero detected ${fix.errorCount} production error${fix.errorCount === 1 ? "" : "s"} and is fixing them automatically.`}
        speed={1.8}
        color="#8a8a8a"
        shineColor="#0a0a0a"
        className="text-[13px] font-medium"
      />
    </div>
  );
}

function countLines(content?: string): number {
  if (!content) return 0;
  return content.replace(/\n+$/, "").split("\n").length;
}

/**
 * One real file streaming in. While it's being written its name shimmers
 * ("Creating app/page.tsx") — no spinner, just the shine — and the moment
 * it's done it settles to a green check with a `+N` line count — like
 * watching a diff land, file by file, straight from the live codegen
 * WebSocket feed.
 */
function FileLine({ file }: { file: LiveFile }) {
  const coding = file.status === "coding";
  const lines = countLines(file.content);
  return (
    <div className="animate-pop flex items-center gap-2">
      {coding ? (
        <span className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
          <svg
            width="9"
            height="9"
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
      )}
      {coding ? (
        <ShinyText
          text={`Creating ${basename(file.path)}`}
          speed={1.4}
          color="#8a8a8a"
          shineColor="#0a0a0a"
          className="min-w-0 truncate font-mono text-[12.5px] font-medium"
        />
      ) : (
        <span className="min-w-0 truncate font-mono text-[12.5px] font-medium text-foreground">
          {basename(file.path)}
        </span>
      )}
      {lines > 0 &&
        (coding ? (
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {lines}
          </span>
        ) : (
          <span
            className="ml-auto shrink-0 font-mono text-[11px] font-semibold tabular-nums text-emerald-600"
            title={`${lines} lines`}
          >
            +{lines}
          </span>
        ))}
    </div>
  );
}

/**
 * Live build feed for the chat. Instead of a static status checklist, the
 * assistant narrates the build conversationally and drops one small
 * "achievement" box at a time as each real pipeline milestone is reached —
 * driven entirely by the orchestrator's WebSocket events. No fakes.
 */
export function LiveBuildActivity({
  hasBuiltBefore,
}: {
  /** Whether this project has ANY prior succeeded build — not just whether
   *  `builds` is non-empty, since a failed first attempt shouldn't make a
   *  retry read as "updating" an app that never actually got created. Drives
   *  the "Planning…" vs "Updating…" narration below. */
  hasBuiltBefore: boolean;
}) {
  const { activity } = useProjectActivity();
  const { phase, error, isFix, fileCount, files, plan, autonomousFix, startedAt, active, buildId } =
    activity;
  const [filesExpanded, setFilesExpanded] = useState(false);

  if (!phase) return null;

  const failed = phase === "failed" || phase === "canceled";
  const succeeded = phase === "succeeded";
  const step = PHASE_STEP[phase];
  const currentFile = files.find((f) => f.status === "coding");
  const currentFileName = currentFile ? basename(currentFile.path) : null;
  const hasFiles = files.length > 0;

  // How many milestones to reveal. Only ever up to (and including) the one the
  // build has actually reached — future steps stay hidden until they happen.
  // On failure we don't know the exact step, but real state tells us: if code
  // was generated, it died bundling; otherwise it died generating.
  const lastIndex = failed
    ? fileCount || files.length > 0
      ? 1
      : 0
    : succeeded
      ? MILESTONES.length - 1
      : step;

  return (
    <div className="pt-0.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-foreground">Meero</span>
        {active && startedAt && <Elapsed since={startedAt} />}
        {active && (
          <span className="ml-auto">
            <StopBuildButton buildId={buildId} />
          </span>
        )}
      </div>

      {/* Why this particular build exists — Meero's 24/7 monitoring agent
          found real production errors and is fixing them on its own. */}
      {autonomousFix && <AutonomousFixBanner fix={autonomousFix} />}

      {/* The plan itself, streaming in live — only while we're genuinely
          still in the "before writing any code" window (a fix never
          re-plans, so this never applies there). Shown above the narration
          line so the plan is visible before "Writing X…" starts appearing. */}
      {!isFix && plan && files.length === 0 && !succeeded && !failed && (
        <LivePlanPreview plan={plan} />
      )}

      {/* Once code has started (or the build's done), the live preview above
          stops applying — but the finished plan stays reviewable behind a
          closed-by-default toggle, same pattern as the file list. */}
      {!isFix && plan?.title && (files.length > 0 || succeeded || failed) && (
        <div className="mb-3">
          <PlanDetailsToggle plan={plan} />
        </div>
      )}

      {/* Conversational narration — the assistant "talking" through the
          build. The dropdown here (instead of a separate milestone box)
          reveals the real per-file list as it lands, once there's anything
          to show. */}
      <div className="flex items-center gap-2">
        {active && !succeeded ? (
          <>
            <ThinkingOrb
              state={PHASE_ORB_STATE[phase] ?? "working"}
              size={20}
              aria-label={narrate(phase, isFix, currentFileName, hasBuiltBefore)}
            />
            <ShinyText
              text={narrate(phase, isFix, currentFileName, hasBuiltBefore)}
              speed={2}
              color="#6b6b6b"
              shineColor="#0a0a0a"
              className="min-w-0 flex-1 text-[14px] leading-relaxed"
            />
          </>
        ) : (
          <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-foreground">
            {narrate(phase, isFix, currentFileName, hasBuiltBefore)}
          </p>
        )}
        {hasFiles && (
          <button
            type="button"
            onClick={() => setFilesExpanded((e) => !e)}
            aria-label={filesExpanded ? "Hide files" : "Show files"}
            className="shrink-0 text-muted-foreground"
          >
            <ChevronDownIcon
              size={12}
              className={`transition-transform ${filesExpanded ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>

      {hasFiles && filesExpanded && (
        <div className="ml-[7px] mt-1.5 space-y-1.5 border-l border-border py-1 pl-3.5">
          {files.map((f) => (
            <FileLine key={f.path} file={f} />
          ))}
        </div>
      )}

      {/* Achievement stream — revealed one box at a time. The "generate"
          milestone has no box of its own — the narration line above already
          covers it, with the file dropdown replacing what used to be a
          separate "Coding the app" entry. */}
      {lastIndex >= 0 && (
        <div className="mt-3 space-y-1.5">
          {MILESTONES.slice(0, lastIndex + 1).map((m, i) => {
            if (m.key === "generate") return null;
            const isLast = i === lastIndex;
            const state: "done" | "active" | "error" = failed
              ? isLast
                ? "error"
                : "done"
              : succeeded || !isLast
                ? "done"
                : "active";
            const label = state === "done" ? m.done(fileCount) : m.active(isFix);
            return <AchievementBox key={m.key} state={state} label={label} />;
          })}
        </div>
      )}

      {/* Real build error */}
      {failed && error && (
        <div className="mt-2.5 rounded-xl border border-red-200 bg-red-50/60 px-3 py-2.5">
          <p className="mb-1 text-[11px] font-semibold text-red-600">Build error</p>
          <pre className="max-h-32 overflow-auto rounded-lg bg-white p-2 font-mono text-[11px] leading-relaxed text-red-700">
            {error.slice(-800)}
          </pre>
          {!isFix && phase !== "canceled" && (
            <p className="mt-2 text-[12px] text-secondary-foreground">
              Watch for the auto-fix retry above.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

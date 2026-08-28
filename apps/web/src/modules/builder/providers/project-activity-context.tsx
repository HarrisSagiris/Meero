"use client";

import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from "react";
import type { DeployPhase } from "@/lib/types";

/**
 * Live pipeline state, driven entirely by REAL orchestrator WebSocket events
 * (build.status / build.phase / build.coding_file / build.code / build.preview
 * / build.deploy_phase). Nothing here is simulated — every field is the last
 * true signal the backend pushed, so the chat can render exactly what's
 * happening.
 */
export type BuildPhase =
  | "queued"
  | "generating_code"
  | "fixing_code"
  | "code_ready"
  | "applying_schema"
  | "bundling"
  | "succeeded"
  | "failed"
  | "canceled";

export type LiveFile = {
  path: string;
  status: "coding" | "done";
  /** Real, still-growing source streamed from codegen — rendered line by line
   *  in the Code tab while the file is being written. */
  content?: string;
};

/** The real, growing partial AppPlan straight from the planner LLM's own
 *  structured-output stream — every field optional since it fills in
 *  progressively (title/summary first, then views, then the rest). Never
 *  synthesized client-side; whatever's here is exactly what the backend
 *  has generated so far. */
export type LivePlanView = {
  name?: string;
  purpose?: string;
  features?: string;
  layout?: string;
};

export type LivePlan = {
  title?: string;
  summary?: string;
  views?: LivePlanView[];
  auth?: string;
  tables?: string;
  design?: string;
  security?: string;
  mood?: string;
};

/** A production error Meero's 24/7 monitoring agent (orchestrator's
 *  app/runtime_monitor.py) caught and is fixing on its own, no human click
 *  involved — driven entirely by the real runtime_monitor.* WS events.
 *  `verified` is a genuine tri-state: null while the fix build (and its own
 *  readiness checks) are still in flight, true only once those checks
 *  actually passed, false if the fix either failed to build or built but
 *  failed verification — never a fabricated success. */
export type AutonomousFix = {
  errorCount: number;
  verified: boolean | null;
  failedChecks: { key?: string; label?: string; detail?: string | null }[];
  detail?: string | null;
};

export type BuildActivity = {
  buildId: string | null;
  phase: BuildPhase | null;
  files: LiveFile[];
  fileCount: number | null;
  plan: LivePlan | null;
  autonomousFix: AutonomousFix | null;
  error: string | null;
  isFix: boolean;
  active: boolean;
  startedAt: number | null;
  // Ultra-only Vercel release — a separate async action per build, never
  // part of the base pipeline, so it's tracked independently of `phase`.
  deployPhase: DeployPhase | null;
  deployUrl: string | null;
  deployError: string | null;
};

const EMPTY: BuildActivity = {
  buildId: null,
  phase: null,
  files: [],
  fileCount: null,
  plan: null,
  autonomousFix: null,
  error: null,
  isFix: false,
  active: false,
  startedAt: null,
  deployPhase: null,
  deployUrl: null,
  deployError: null,
};

export type WsEvent = {
  type?: string;
  build_id?: string;
  status?: string;
  phase?: string;
  path?: string;
  content?: string;
  file_count?: number;
  plan?: LivePlan;
  error?: string | null;
  deploy_url?: string;
  // runtime_monitor.* fields (see AutonomousFix above).
  error_count?: number;
  sample_message?: string;
  passed?: boolean;
  resolved_error_count?: number;
  failed_checks?: { key?: string; label?: string; detail?: string | null }[];
  detail?: string | null;
  // conversion.* fields (app/conversion_agent.py, 00042_conversion_agent.sql)
  // — all low-frequency, one-per-poll-cycle-at-most events. None of these
  // feed the reducer below (nothing here renders live pipeline state for
  // them); build-status-listener.tsx just uses event.type to decide when to
  // router.refresh() so the Conversion tab's server-fetched props
  // (hypotheses/experiments/results, from page.tsx) catch up.
  hypothesis_id?: string;
  issue_type?: string;
  experiment_id?: string;
  experiment_key?: string;
  decision?: string;
  lift_pct?: number | null;
  p_value?: number | null;
};

const PHASE_FROM_BACKEND: Record<string, BuildPhase> = {
  generating_code: "generating_code",
  fixing_code: "fixing_code",
  applying_schema: "applying_schema",
  building_app: "bundling",
};

function reducer(state: BuildActivity, event: WsEvent): BuildActivity {
  const buildId = event.build_id ?? state.buildId;

  switch (event.type) {
    case "build.status": {
      // A different build id means a brand-new run (or the auto-fix retry) —
      // wipe the live slate so two builds never bleed together.
      const fresh = event.build_id && event.build_id !== state.buildId;
      const base = fresh ? { ...EMPTY, startedAt: Date.now() } : state;
      switch (event.status) {
        case "queued":
          return { ...base, buildId, phase: "queued", active: true };
        case "running":
          return {
            ...base,
            buildId,
            active: true,
            phase: base.phase && base.phase !== "queued" ? base.phase : "generating_code",
            startedAt: base.startedAt ?? Date.now(),
          };
        case "succeeded":
          return { ...state, buildId, phase: "succeeded", active: false };
        case "failed":
          return {
            ...state,
            buildId,
            phase: "failed",
            active: false,
            error: event.error ?? state.error,
          };
        case "canceled":
          return { ...state, buildId, phase: "canceled", active: false };
        default:
          return state;
      }
    }

    case "build.phase": {
      const phase = event.phase ? PHASE_FROM_BACKEND[event.phase] : undefined;
      if (!phase) return state;
      return {
        ...state,
        buildId,
        phase,
        active: true,
        isFix: event.phase === "fixing_code" ? true : state.isFix,
        startedAt: state.startedAt ?? Date.now(),
      };
    }

    case "build.planning": {
      if (!event.plan) return state;
      return { ...state, buildId, plan: event.plan, active: true };
    }

    case "runtime_monitor.detected": {
      // The build.status/"queued" event create_runtime_fix_build already
      // fires lands first and resets state for the new build id — this is
      // purely additive narration on top of that normal build lifecycle.
      return {
        ...state,
        buildId,
        autonomousFix: {
          errorCount: event.error_count ?? 0,
          verified: null,
          failedChecks: [],
        },
      };
    }

    case "runtime_monitor.verified": {
      if (!state.autonomousFix) return state;
      return {
        ...state,
        buildId,
        autonomousFix: { ...state.autonomousFix, verified: true, failedChecks: [] },
      };
    }

    case "runtime_monitor.regression": {
      return {
        ...state,
        buildId,
        autonomousFix: {
          errorCount: state.autonomousFix?.errorCount ?? 0,
          verified: false,
          failedChecks: event.failed_checks ?? [],
          detail: event.detail,
        },
      };
    }

    case "build.coding_file": {
      if (!event.path || (event.status !== "coding" && event.status !== "done")) {
        return state;
      }
      const files = [...state.files];
      const idx = files.findIndex((f) => f.path === event.path);
      // Keep the last non-empty content if a later event carries none, so a
      // "done" event with an empty payload never blanks the streamed source.
      const prevContent = idx >= 0 ? files[idx].content : undefined;
      const next: LiveFile = {
        path: event.path,
        status: event.status,
        content: event.content || prevContent,
      };
      if (idx >= 0) files[idx] = next;
      else files.push(next);
      return {
        ...state,
        buildId,
        files,
        active: true,
        phase:
          state.phase === "code_ready" ||
          state.phase === "applying_schema" ||
          state.phase === "bundling"
            ? state.phase
            : state.isFix
              ? "fixing_code"
              : "generating_code",
      };
    }

    case "build.code": {
      // All streamed files are written to the DB now — mark them done.
      const files = state.files.map((f) => ({ ...f, status: "done" as const }));
      return {
        ...state,
        buildId,
        files,
        fileCount: event.file_count ?? state.fileCount,
        phase: "code_ready",
        active: true,
      };
    }

    case "build.preview": {
      return { ...state, buildId, phase: "succeeded", active: false };
    }

    case "build.deploy_phase": {
      const phase = event.phase as DeployPhase | undefined;
      if (!phase) return state;
      return {
        ...state,
        buildId,
        deployPhase: phase,
        deployUrl: event.deploy_url ?? (phase === "succeeded" ? state.deployUrl : null),
        deployError: phase === "failed" ? (event.error ?? "Release failed.") : null,
      };
    }

    default:
      return state;
  }
}

const ProjectActivityContext = createContext<{
  activity: BuildActivity;
  applyEvent: Dispatch<WsEvent>;
} | null>(null);

export function ProjectActivityProvider({
  children,
  initial,
}: {
  children: ReactNode;
  /** Server-derived snapshot of the latest build, so a full page reload
   *  mid-build re-hydrates the live pipeline instead of losing it. Only used
   *  as the reducer's initial state (on mount) — live WS events take over
   *  from there and are never overwritten by a subsequent router.refresh(). */
  initial?: Partial<BuildActivity> | null;
}) {
  const [activity, applyEvent] = useReducer(reducer, { ...EMPTY, ...initial });
  return (
    <ProjectActivityContext.Provider value={{ activity, applyEvent }}>
      {children}
    </ProjectActivityContext.Provider>
  );
}

export function useProjectActivity() {
  const ctx = useContext(ProjectActivityContext);
  if (!ctx) {
    throw new Error("useProjectActivity must be used within a ProjectActivityProvider");
  }
  return ctx;
}

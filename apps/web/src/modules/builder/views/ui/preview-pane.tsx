"use client";

import { useState } from "react";
import { AutoFixButton } from "@/modules/builder/views/ui/auto-fix-button";
import { FixExplanationCard } from "@/modules/builder/views/ui/fix-explanation-card";
import { ReadinessChecklist } from "@/modules/builder/views/ui/readiness-checklist";
import { RetryBuildButton } from "@/modules/builder/views/ui/retry-build-button";
import { useProjectActivity } from "@/modules/builder/providers/project-activity-context";
import {
  ExpandIcon,
  ExternalLinkIcon,
  GlobeIcon,
  RefreshIcon,
  RocketIcon,
} from "@/components/icons";
import { MeeroMark } from "@/components/logo";
import ShinyText from "@/components/ui/shiny-text";
import { createClient } from "@/lib/supabase/client";
import type { Build, Plan } from "@/lib/types";

/**
 * Right-hand pane of the builder — a live, full-bleed app stage. Its real
 * URL + reload/fullscreen/open-in-new-tab controls float as a centered pill
 * over the top of the app itself (PreviewLinkPill below), rather than a
 * fixed browser-chrome header bar.
 *
 * Builds start automatically (no manual button): whenever the spec changes,
 * a real codegen + `next build` run kicks off and this screen tracks its
 * true state. Once a build succeeds, the screen iframes the real, running
 * web app (never a mock) — it's the user's own generated code, running
 * live. Otherwise the screen reports true build state only.
 */
export function PreviewPane({
  builds,
  plan,
  supabaseLinked,
  projectId,
  autonomyMode = "solo",
}: {
  builds: Build[];
  plan: Plan;
  supabaseLinked: boolean;
  projectId: string;
  /** Manual mode (00028_autonomy_mode.sql): the AI fix never fires on its
   *  own — this pane shows a real "Auto-fix with AI" button instead. */
  autonomyMode?: "solo" | "manual";
}) {
  // The newest build overall drives the status/progress UI, but the app
  // shown in the iframe is the newest build that actually SUCCEEDED — so
  // asking for a new change (which queues a fresh build) never blanks out
  // the app that's already running. The old preview keeps rendering right
  // up until the new build succeeds and takes its place.
  const latest = builds[0];
  const shown = builds.find((b) => b.status === "succeeded" && b.preview_url);
  const liveUrl = shown?.preview_url ?? null;

  const isAutoFixing =
    !!latest?.retry_of && (latest.status === "queued" || latest.status === "running");
  const isBuilding = !isAutoFixing && (latest?.status === "queued" || latest?.status === "running");
  const failed = latest?.status === "failed";
  // A newer build than the one currently shown is in flight (or just
  // failed) — surface that as a small badge over the still-live app instead
  // of tearing the app view down.
  const newerInProgress =
    !!shown && latest?.id !== shown.id && (isBuilding || isAutoFixing || failed);
  const iframeId = shown ? `app-${shown.id}` : undefined;
  // Same eligibility as the automatic trigger in build-status-listener.tsx —
  // never offer a fix for a build that's already a fix attempt, or that
  // already has one queued/running/done.
  const canAutoFix =
    failed && !!latest && !latest.retry_of && !builds.some((b) => b.retry_of === latest.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
        <PreviewAddressBar liveUrl={liveUrl} iframeId={iframeId ?? null} projectId={projectId} />

        <div className="relative min-h-0 flex-1 bg-white">
          {liveUrl ? (
            <iframe
              id={iframeId}
              src={liveUrl}
              title="Live web app"
              sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
              className="h-full w-full border-0"
            />
          ) : (
            <StatusScreen
              latest={latest}
              isBuilding={isBuilding}
              isAutoFixing={isAutoFixing}
              failed={failed}
              supabaseLinked={supabaseLinked}
              showAutoFix={autonomyMode === "manual" && canAutoFix}
            />
          )}

          {liveUrl && shown && (
            <div className="absolute top-3 left-3 z-10">
              <FixExplanationCard build={shown} />
            </div>
          )}

          {liveUrl && newerInProgress && (
            <div className="absolute top-3 right-3 z-10">
              <NewerBuildBadge isAutoFixing={isAutoFixing} failed={failed} />
            </div>
          )}
        </div>
      </div>

      {shown && (
        <div className="shrink-0 px-4 pb-3">
          <ReleasePanel buildId={shown.id} plan={plan} deployedUrl={shown.deploy_url} />
        </div>
      )}

      {/* Footer — only surfaces the real build error, on demand */}
      {failed && latest?.error && (
        <div className="shrink-0 px-4 pb-3">
          <details className="group mx-auto w-full max-w-[340px] rounded-lg border border-red-200 bg-red-50">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12px] font-medium text-red-700">
              <span className="flex-1">
                {latest.retry_of
                  ? "Build error — the AI fix didn't resolve it"
                  : "Real build error"}
              </span>
              <span className="text-[11px] text-red-500 group-open:hidden">view</span>
              <span className="hidden text-[11px] text-red-500 group-open:inline">hide</span>
            </summary>
            <pre className="max-h-44 overflow-auto px-3 pb-3 text-left font-mono text-[10.5px] leading-relaxed whitespace-pre-wrap text-red-800">
              {latest.error}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

/**
 * The live app's URL, as a real address-bar row sitting OUTSIDE the app
 * itself — a shrink-0 sibling above the iframe, never overlaid on top of
 * it, so it can never cover any of the generated app's own UI (a floating
 * pill over the top of the page could). Reload reassigns the real iframe's
 * own `src` (a genuine reload — data lives in the linked Supabase database,
 * so it survives exactly like a real browser tab); fullscreen calls the
 * real Fullscreen API on that same element. Both are disabled (not hidden)
 * when there's no live build yet, since the iframe doesn't exist to act on
 * — the bar itself still shows, same as a real browser's address bar does
 * before a page has loaded. Three zones, like a real browser toolbar: the
 * readiness checklist on the left, the URL filling the middle, reload/
 * fullscreen/open-in-new-tab on the right.
 */
function PreviewAddressBar({
  liveUrl,
  iframeId,
  projectId,
}: {
  liveUrl: string | null;
  iframeId: string | null;
  projectId: string;
}) {
  const [busy, setBusy] = useState<"reload" | "expand" | null>(null);
  const canControl = !!liveUrl && !!iframeId;

  function reload() {
    const el = canControl ? (document.getElementById(iframeId!) as HTMLIFrameElement | null) : null;
    if (!el) return;
    setBusy("reload");
    const src = el.src;
    el.src = "about:blank";
    requestAnimationFrame(() => {
      el.src = src;
      setBusy(null);
    });
  }

  async function expand() {
    const el = canControl ? (document.getElementById(iframeId!) as HTMLIFrameElement | null) : null;
    if (!el) return;
    setBusy("expand");
    try {
      await el.requestFullscreen?.();
    } catch {
      // Fullscreen can be denied by the browser — the app is still fully
      // usable inline either way.
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/60 py-1.5 pr-1.5 pl-1">
      {/* Left — readiness checklist, only once there's a real app to check.
          Fixed to its own natural width (never shrinks, never wraps) so a
          narrow pane can't squeeze its text or collide it with the URL. */}
      <div className="flex shrink-0 items-center">
        {liveUrl && <ReadinessChecklist projectId={projectId} />}
      </div>

      {/* Middle — the real URL. The ONLY zone that actually shrinks, so the
          fixed-width side zones (readiness badge, controls) can never get
          squeezed or overlapped at a narrow pane width — same as a real
          browser toolbar, where the address bar is what gives way, never
          the buttons around it. */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <GlobeIcon size={12} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-[12px] text-secondary-foreground">
          {liveUrl ? shortenUrl(liveUrl) : "Your app runs here once it's built"}
        </span>
      </div>

      {/* Right — reload, fullscreen, open in a new tab. Fixed width, same
          reasoning as the left zone. */}
      <div className="flex shrink-0 items-center gap-1">
        <PillIconButton
          label="Reload the app"
          onClick={reload}
          active={busy === "reload"}
          disabled={!canControl}
        >
          <RefreshIcon size={13} />
        </PillIconButton>
        <PillIconButton
          label="Fullscreen"
          onClick={expand}
          active={busy === "expand"}
          disabled={!canControl}
        >
          <ExpandIcon size={12} />
        </PillIconButton>
        {liveUrl ? (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in a new tab"
            aria-label="Open in a new tab"
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-secondary-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ExternalLinkIcon size={12} />
          </a>
        ) : (
          <span
            aria-hidden
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-input"
          >
            <ExternalLinkIcon size={12} />
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A small badge that floats over the still-live app to say a newer build is
 * on the way (or just failed) — never a full takeover, so the working app
 * underneath stays visible and usable the whole time.
 */
function NewerBuildBadge({ isAutoFixing, failed }: { isAutoFixing: boolean; failed: boolean }) {
  if (failed) {
    return (
      <div className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50/95 px-2.5 py-1 text-[11.5px] font-medium text-red-700 shadow-primary/10 backdrop-blur-sm">
        New build failed — showing the last working version
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-border bg-white/90 px-2.5 py-1 shadow-primary/10 backdrop-blur-sm">
      <span className="relative flex size-1.5">
        <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
        <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
      </span>
      <ShinyText
        text={isAutoFixing ? "Auto-fixing…" : "Building new version…"}
        speed={1.6}
        color="#8a8a8a"
        shineColor="#0a0a0a"
        className="text-[11.5px] font-medium"
      />
    </div>
  );
}

function PillIconButton({
  children,
  label,
  disabled,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-secondary-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent ${
        active ? "bg-muted text-foreground" : ""
      }`}
    >
      {children}
    </button>
  );
}

function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

/**
 * Ultra-only production release action — a separate, explicit trigger per
 * build (never automatic). A real Vercel deployment through Vercel's REST
 * API, so it's not instant: this panel tracks the real `build.deploy_phase`
 * events pushed over the same WebSocket as everything else, plus the
 * DB-persisted deploy_url on reload.
 */
function ReleasePanel({
  buildId,
  plan,
  deployedUrl,
}: {
  buildId: string;
  plan: Plan;
  /** builds.deploy_url from the server render — survives a page reload. */
  deployedUrl: string | null;
}) {
  const { activity } = useProjectActivity();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (plan === "free") {
    return (
      <div className="mx-auto flex w-full max-w-[440px] items-center gap-2.5 rounded-xl border border-border bg-white px-3.5 py-2.5 text-[12px] text-muted-foreground">
        <RocketIcon size={15} className="shrink-0 text-input" />
        <span>
          <span className="font-medium text-secondary-foreground">Pro &amp; Ultra</span> unlock a
          one-click production release of this app to Vercel — a real deployment with a real public
          URL.
        </span>
      </div>
    );
  }

  const phase = activity.buildId === buildId ? activity.deployPhase : null;
  const liveDeployUrl = (activity.buildId === buildId ? activity.deployUrl : null) ?? deployedUrl;
  const deployError = activity.buildId === buildId ? activity.deployError : null;
  const busy = phase === "deploying";

  async function start() {
    setStarting(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      if (!base || !session) throw new Error("Session expired — reload and sign in again.");
      const res = await fetch(`${base}/builds/${buildId}/deploy`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Release request failed (${res.status}).`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the release.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[440px] rounded-xl border border-border bg-white px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <RocketIcon size={15} className="shrink-0 text-secondary-foreground" />
        {busy ? (
          <ShinyText
            text="Releasing to Vercel…"
            speed={1.6}
            color="#8a8a8a"
            shineColor="#0a0a0a"
            className="text-[12.5px] font-medium"
          />
        ) : liveDeployUrl ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <a
              href={liveDeployUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-1 text-[12.5px] font-medium text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
            >
              <span className="truncate">{liveDeployUrl.replace(/^https:\/\//, "")}</span>
              <ExternalLinkIcon size={12} className="shrink-0" />
            </a>
            <button
              type="button"
              onClick={start}
              disabled={starting}
              className="ml-auto shrink-0 text-[11.5px] font-medium text-secondary-foreground underline decoration-input underline-offset-2 hover:text-foreground disabled:opacity-40"
            >
              Release again
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={start}
            disabled={starting}
            className="text-[12.5px] font-medium text-foreground underline decoration-input underline-offset-2 hover:text-neutral-700 disabled:opacity-40"
          >
            {starting ? "Starting…" : "Release to production (real Vercel deploy)"}
          </button>
        )}
        {(error || deployError) && (
          <span className="ml-auto truncate text-[11px] text-red-600">{error || deployError}</span>
        )}
      </div>
    </div>
  );
}

function StatusScreen({
  latest,
  isBuilding,
  isAutoFixing,
  failed,
  supabaseLinked,
  showAutoFix,
}: {
  latest?: Build;
  isBuilding: boolean;
  isAutoFixing: boolean;
  failed: boolean;
  supabaseLinked: boolean;
  showAutoFix: boolean;
}) {
  const inProgress = isBuilding || isAutoFixing;

  let title: string;
  let subtitle: string;
  if (isAutoFixing) {
    title = "Auto-fixing with AI…";
    subtitle = "Fixing the error, then running a real second build.";
  } else if (isBuilding) {
    title = "Building…";
    subtitle = "Live the moment it's ready.";
  } else if (failed) {
    title = "Build failed";
    subtitle =
      "Nothing is faked here. See the real error below, ask Meero in chat to fix it, or just try again.";
  } else if (latest?.status === "succeeded") {
    title = "Finishing up…";
    subtitle = "Publishing your live app…";
  } else if (!supabaseLinked) {
    title = "Link Supabase to build";
    subtitle =
      "Your app's database and user accounts live in your own Supabase project — connect one with the Supabase button in the header, then describe your app in chat.";
  } else {
    title = "No app yet";
    subtitle =
      "Describe the web app you want in chat — the real, running app (backed by your own Supabase) loads here.";
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3.5 px-7 text-center">
      {inProgress ? (
        <>
          <MeeroMark size={36} />
          <p className="text-[15px] font-semibold">
            <ShinyText text={title} speed={1.6} color="#8a8a8a" shineColor="#0a0a0a" />
          </p>
        </>
      ) : (
        <>
          <span className={failed ? "text-red-400" : "text-input"}>
            <GlobeIcon size={38} />
          </span>
          <p className={`text-[15px] font-semibold ${failed ? "text-red-500" : "text-foreground"}`}>
            {title}
          </p>
        </>
      )}
      <p className="max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">{subtitle}</p>
      {failed && latest && (
        <div className="flex items-center gap-2">
          <RetryBuildButton buildId={latest.id} />
          {showAutoFix && <AutoFixButton buildId={latest.id} />}
        </div>
      )}
    </div>
  );
}

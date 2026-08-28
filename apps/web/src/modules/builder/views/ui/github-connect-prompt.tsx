"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { GithubIcon, PullRequestIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

/**
 * First-run prompt shown to a project's owner when it isn't yet linked to a
 * GitHub repo. "Connect" either starts the real OAuth flow (if the user has
 * never connected GitHub) or, for an already-connected user, links this
 * project to a fresh repo — after which every successful build and auto-fix
 * commits straight to `main`. Dismissable per-project so it never nags.
 */
export function GithubConnectPrompt({
  projectId,
  githubUsername,
  alreadyLinked,
}: {
  projectId: string;
  githubUsername: string | null;
  alreadyLinked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismissKey = `meero:gh-prompt-dismissed:${projectId}`;

  useEffect(() => {
    if (alreadyLinked) return;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem(dismissKey) === "1";
    } catch {
      // sessionStorage unavailable — just show the prompt.
    }
    if (!dismissed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only storage after mount can't run at SSR time
      setOpen(true);
    }
  }, [alreadyLinked, dismissKey]);

  function dismiss() {
    try {
      sessionStorage.setItem(dismissKey, "1");
    } catch {
      // best-effort — worst case it shows again next visit.
    }
    setOpen(false);
  }

  async function authContext() {
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!base || !session) {
      setError(
        base ? "Session expired — reload and sign in again." : "Orchestrator is not configured.",
      );
      return null;
    }
    return { base, headers: { Authorization: `Bearer ${session.access_token}` } };
  }

  async function connect() {
    setPending(true);
    setError(null);
    const auth = await authContext();
    if (!auth) {
      setPending(false);
      return;
    }
    try {
      if (githubUsername) {
        // Already connected — just create/link the repo for this project.
        const res = await fetch(`${auth.base}/projects/${projectId}/github/publish`, {
          method: "POST",
          headers: auth.headers,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
        // Reload so the linked repo state is reflected everywhere.
        window.location.reload();
      } else {
        // Never connected — start the real OAuth authorize redirect.
        const res = await fetch(
          `${auth.base}/auth/github/authorize?project_id=${encodeURIComponent(projectId)}`,
          { headers: auth.headers },
        );
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
        window.location.href = body.url;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect GitHub.");
      setPending(false);
    }
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Dismiss"
        onClick={dismiss}
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
      />
      <div className="animate-pop relative w-full max-w-md overflow-hidden rounded-3xl border border-border bg-white shadow-composer">
        <div className="p-7">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-foreground text-white">
            <GithubIcon size={20} />
          </span>
          <h2 className="mt-4 text-[19px] font-semibold tracking-tight text-foreground">
            Track this project on GitHub?
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-secondary-foreground">
            Connect your GitHub and Meero creates a real repo for this app. Every successful build —
            and every automatic fix — commits straight to{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[12.5px]">main</code>, so you get a
            full, traceable history of how your app evolves.
          </p>

          <ul className="mt-4 space-y-2 text-[13px] text-secondary-foreground">
            <li className="flex items-center gap-2">
              <PullRequestIcon size={14} className="shrink-0 text-primary" />A real private repo,
              created automatically
            </li>
            <li className="flex items-center gap-2">
              <PullRequestIcon size={14} className="shrink-0 text-primary" />A commit on every
              successful build and fix
            </li>
          </ul>

          {error && (
            <p role="alert" className="mt-3 text-[12.5px] text-red-600">
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center gap-2.5">
            <button
              type="button"
              onClick={connect}
              disabled={pending}
              className="flex items-center gap-2 rounded-xl bg-foreground px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
            >
              {pending ? (
                <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              ) : (
                <GithubIcon size={16} />
              )}
              {githubUsername ? "Create repo" : "Connect GitHub"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={pending}
              className="rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-secondary-foreground transition hover:text-foreground disabled:opacity-60"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

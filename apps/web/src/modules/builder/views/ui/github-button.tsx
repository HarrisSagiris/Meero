"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { GithubIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

/**
 * Real GitHub connect + publish — no mocks. "Connect" starts an actual
 * OAuth App authorization redirect (orchestrator-brokered); "Publish"
 * creates a real private repo from the latest successful build's generated
 * source via GitHub's Git Data API. Every later successful build then
 * commits straight to main, giving a full, traceable build history.
 */
export function GithubButton({
  projectId,
  githubUsername,
  repoUrl,
}: {
  projectId: string;
  githubUsername: string | null;
  repoUrl: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        `${auth.base}/auth/github/authorize?project_id=${encodeURIComponent(projectId)}`,
        { headers: auth.headers },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start GitHub connect.");
      setPending(false);
    }
  }

  async function publish() {
    setPending(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setPending(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/projects/${projectId}/github/publish`, {
        method: "POST",
        headers: auth.headers,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not publish to GitHub.");
    } finally {
      setPending(false);
    }
  }

  if (repoUrl) {
    return (
      <a
        href={repoUrl}
        target="_blank"
        rel="noreferrer"
        title="View the real GitHub repo — every successful build commits to main here"
        className="flex size-8 items-center justify-center rounded-lg text-secondary-foreground transition hover:bg-muted hover:text-foreground"
      >
        <GithubIcon size={16} />
      </a>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={githubUsername ? publish : connect}
        disabled={pending}
        title={
          githubUsername
            ? `Publish to GitHub as @${githubUsername} — creates a real private repo from your latest build`
            : "Connect your GitHub account to publish this app as a real repo"
        }
        aria-label={githubUsername ? "Publish to GitHub" : "Connect GitHub"}
        className="flex size-8 items-center justify-center rounded-lg text-secondary-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <GithubIcon size={16} />
      </button>
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

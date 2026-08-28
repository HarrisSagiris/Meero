"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Collaborator = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  invited_by: string;
  created_at: string;
};

/**
 * Real team invites (00027_collaborators.sql) — an existing Meero user,
 * added by email, gets full working access to this project (chat,
 * builds/fixes, code) billed to the OWNER's credits. No pending/accepted
 * state in v1: every row here is an active collaborator the moment it's
 * added. Account-level actions (GitHub/Supabase, domains, releases) stay
 * owner-only regardless of who's a collaborator.
 */
export function CollaboratorsManager({ projectId }: { projectId: string }) {
  const [collaborators, setCollaborators] = useState<Collaborator[] | null>(null);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function authHeader() {
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!base || !session) {
      setError("Session expired — reload and sign in again.");
      return null;
    }
    return { base, headers: { Authorization: `Bearer ${session.access_token}` } };
  }

  async function load() {
    const auth = await authHeader();
    if (!auth) return;
    try {
      const res = await fetch(`${auth.base}/projects/${projectId}/collaborators`, {
        headers: auth.headers,
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setCollaborators(body.collaborators ?? []);
    } catch {
      // Best-effort — the invite form still works even if this list fails.
    }
  }

  useEffect(() => {
    // Real async fetch on mount, not a derived-state calculation — the
    // lint rule can't tell the two apart.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function invite() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setPending(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/projects/${projectId}/collaborators`, {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setCollaborators((prev) => [...(prev ?? []), body]);
      setEmail("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add collaborator.");
    } finally {
      setPending(false);
    }
  }

  async function remove(userId: string) {
    setError(null);
    const auth = await authHeader();
    if (!auth) return;
    try {
      const res = await fetch(`${auth.base}/projects/${projectId}/collaborators/${userId}`, {
        method: "DELETE",
        headers: auth.headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Failed (${res.status})`);
      }
      setCollaborators((prev) => (prev ?? []).filter((c) => c.user_id !== userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove collaborator.");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-muted/50 px-3.5 py-2.5">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
        COLLABORATORS
      </span>

      <div className="mt-2 flex gap-2">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="teammate@email.com"
          disabled={pending}
        />
        <Button type="button" onClick={() => void invite()} disabled={pending || !email.trim()}>
          {pending ? "Adding…" : "Invite"}
        </Button>
      </div>
      {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}

      {collaborators && collaborators.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {collaborators.map((c) => (
            <li
              key={c.user_id}
              className="flex items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-1.5"
            >
              <span className="min-w-0 truncate text-[12.5px] text-secondary-foreground">
                {c.display_name || c.email || c.user_id}
              </span>
              <button
                type="button"
                onClick={() => void remove(c.user_id)}
                className="shrink-0 text-[11px] font-medium text-muted-foreground transition hover:text-red-600"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {collaborators && collaborators.length === 0 && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-secondary-foreground">
          Invite a teammate who already has a Meero account — they&apos;ll get full chat and build
          access to this project.
        </p>
      )}
    </div>
  );
}

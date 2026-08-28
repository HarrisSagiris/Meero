"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { GitFork } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type SupabaseProject = {
  ref: string;
  name: string;
  region?: string;
};

/**
 * Clones a public marketplace project into a new one owned by the caller.
 *
 * The clone runs against the cloner's own Supabase project. The source
 * project keeps placeholders so none of the original owner's backend
 * credentials or resources leak.
 */
export function CloneButton({ projectId }: { projectId: string }) {
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState<SupabaseProject[] | null>(null);

  async function authHeader() {
    const supabase = createClient();

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;

    if (!base || !session) {
      setError("Session expired — reload and sign in again.");
      return null;
    }

    return {
      base,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    };
  }

  async function openPicker(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    if (busy) return;

    setError(null);
    setPickerOpen(true);

    if (projects !== null) return;

    const auth = await authHeader();

    if (!auth) {
      setPickerOpen(false);
      return;
    }

    try {
      const res = await fetch(`${auth.base}/supabase/projects`, {
        headers: auth.headers,
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(
          body?.detail ||
            "Connect your Supabase account first (open one of your projects), then clone.",
        );
      }

      setProjects(body.projects as SupabaseProject[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't list your Supabase projects.");
      setPickerOpen(false);
    }
  }

  async function clone(supabaseProjectRef: string) {
    setBusy(true);
    setError(null);

    const auth = await authHeader();

    if (!auth) {
      setBusy(false);
      return;
    }

    try {
      const res = await fetch(`${auth.base}/projects/${projectId}/clone`, {
        method: "POST",
        headers: {
          ...auth.headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          supabase_project_ref: supabaseProjectRef,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);

        throw new Error(body?.detail || `Clone failed (${res.status}).`);
      }

      const data = (await res.json()) as {
        project_id: string;
      };

      router.push(`/project/${data.project_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't clone this project.");
      setBusy(false);
      setPickerOpen(false);
    }
  }

  return (
    <div>
      <DropdownMenu
        open={pickerOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setPickerOpen(open);
          }
        }}
      >
        <DropdownMenuTrigger
          render={<Button size="sm" className="isolate" disabled={busy} onClick={openPicker} />}
        >
          <GitFork className="size-3" />
          {busy ? "Cloning…" : "Clone"}
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64 rounded-2xl p-1.5">
          <DropdownMenuGroup>
            <DropdownMenuLabel>RUN THE CLONE ON YOUR SUPABASE</DropdownMenuLabel>

            {projects === null ? (
              <div className="flex justify-center py-4">
                <span className="size-4 animate-spin rounded-full border-2 border-input border-t-primary" />
              </div>
            ) : projects.length === 0 ? (
              <p className="px-3 pb-3 text-[12px] leading-relaxed text-muted-foreground">
                No Supabase projects found — create one at database.new first.
              </p>
            ) : (
              projects.map((project) => (
                <DropdownMenuItem
                  key={project.ref}
                  disabled={busy}
                  onClick={() => void clone(project.ref)}
                  className="cursor-pointer rounded-lg px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col items-start">
                    <span className="w-full truncate text-[13px] font-medium text-foreground">
                      {project.name}
                    </span>

                    <span className="w-full truncate font-mono text-[10.5px] text-muted-foreground">
                      {project.ref}
                    </span>
                  </div>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && <p className="mt-1.5 max-w-[220px] text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

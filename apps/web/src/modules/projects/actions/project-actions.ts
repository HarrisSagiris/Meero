"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MODEL_OPTIONS, type ModelId } from "@/modules/projects/utils/models";

export type CreateProjectState = { error?: string };

/** Only a value the composer could actually have sent — anything else (a
 *  free user's client, tampered form data) is dropped, not trusted; the
 *  `projects_enforce_model_gating` DB trigger (00048) is the real
 *  plan-gating backstop regardless. */
function parsePreferredModel(raw: FormDataEntryValue | null): ModelId | null {
  const value = String(raw ?? "");
  return MODEL_OPTIONS.some((option) => option.id === value) ? (value as ModelId) : null;
}

/** Derive a short project name from the first line of the prompt. */
function nameFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  if (firstLine.length <= 60) return firstLine || "Untitled app";
  return `${firstLine.slice(0, 57).trimEnd()}…`;
}

/** Parse + validate the attachments JSON posted by the composer. */
function parseAttachments(raw: string, userId: string): { path: string; name: string }[] | null {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 10) return null;
    const clean: { path: string; name: string }[] = [];
    for (const item of parsed) {
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as { path?: unknown }).path !== "string" ||
        typeof (item as { name?: unknown }).name !== "string"
      ) {
        return null;
      }
      const { path, name } = item as { path: string; name: string };
      // Only files inside the caller's own storage folder are accepted.
      if (!path.startsWith(`${userId}/`) || path.includes("..")) return null;
      clean.push({ path, name: name.slice(0, 200) });
    }
    return clean;
  } catch {
    return null;
  }
}

/**
 * Creates a project + spec v1 from the home-page prompt, then sends the
 * user to the builder. RLS guarantees rows are owned by the caller.
 */
export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const prompt = String(formData.get("prompt") ?? "").trim();
  if (!prompt) {
    return { error: "Describe the app you want to build first." };
  }
  if (prompt.length > 20000) {
    return { error: "Prompt is too long (20,000 character max)." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const attachments = parseAttachments(String(formData.get("attachments") ?? ""), user.id);
  if (attachments === null) {
    return { error: "Attachments are invalid — remove them and retry." };
  }

  const preferredModel = parsePreferredModel(formData.get("model"));

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      owner_id: user.id,
      name: nameFromPrompt(prompt),
      description: prompt.length > 200 ? `${prompt.slice(0, 197)}…` : prompt,
      preferred_model: preferredModel,
    })
    .select("id")
    .single();

  if (projectError || !project) {
    return { error: projectError?.message ?? "Could not create the project." };
  }

  const { error: specError } = await supabase.from("specs").insert({
    project_id: project.id,
    version: 1,
    prompt,
    attachments,
    created_by: user.id,
  });

  if (specError) {
    // Don't leave an empty project behind if the spec insert failed.
    await supabase.from("projects").delete().eq("id", project.id);
    return { error: specError.message };
  }

  // Seed the conversation with the original prompt (best effort).
  await supabase.from("messages").insert({
    project_id: project.id,
    role: "user",
    content: prompt,
    spec_version: 1,
  });

  // Best-effort, fire-and-forget: a real LLM call on the orchestrator turns
  // the raw prompt into a short display title for the public gallery
  // (display_title, 00043) — never blocks the redirect below, and a
  // missing/unreachable orchestrator just leaves it unset (the gallery
  // falls back to `name`).
  const orchestratorUrl =
    process.env.ORCHESTRATOR_INTERNAL_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  if (orchestratorUrl) {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      void fetch(`${orchestratorUrl}/projects/${project.id}/generate-title`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      }).catch(() => {});
    }
  }

  revalidatePath("/", "layout");
  redirect(`/project/${project.id}`);
}

/**
 * Deletes a project for real — RLS ("projects: owner can delete",
 * 00001_init.sql) restricts this to the caller's own projects, and every
 * dependent row (specs, messages, builds, build_files, collaborators, etc.)
 * is set up with `on delete cascade`, so this one delete is the whole
 * cleanup. Irreversible — the confirm step lives in DeleteProjectButton.
 */
export async function deleteProject(projectId: string) {
  const supabase = await createClient();
  await supabase.from("projects").delete().eq("id", projectId);
  revalidatePath("/");
}

/**
 * Renames a project — plain owner-writable text field (no trigger, same as
 * is_starred/is_public), covered by the existing "projects: owner can
 * update" RLS policy. Mirrors the 1-120 char `check` constraint on
 * `projects.name` (00001_init.sql) so a bad value fails loudly here instead
 * of surfacing as an opaque Postgres constraint error.
 */
export async function renameProject(projectId: string, name: string) {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    return { error: "Name must be between 1 and 120 characters." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("projects").update({ name: trimmed }).eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath(`/project/${projectId}`);
  revalidatePath("/");
  return {};
}

export async function toggleStar(projectId: string, starred: boolean) {
  const supabase = await createClient();
  // RLS restricts the update to the caller's own projects.
  await supabase.from("projects").update({ is_starred: starred }).eq("id", projectId);
  revalidatePath("/");
}

/**
 * Pro/Ultra-only visibility toggle. Free-plan projects are ALWAYS public —
 * the `projects_enforce_free_public` trigger (00015_marketplace.sql) forces
 * is_public back to true for them on this same update, so this action is a
 * genuine no-op for free users rather than something that needs blocking
 * here too (defense in depth: the DB is the real guarantee).
 */
export async function setProjectVisibility(projectId: string, isPublic: boolean) {
  const supabase = await createClient();
  await supabase.from("projects").update({ is_public: isPublic }).eq("id", projectId);
  revalidatePath(`/project/${projectId}`);
}

/**
 * Solo mode (default) vs. Manual mode (00028_autonomy_mode.sql) — a plain
 * owner preference, covered by the existing "projects: owner can update"
 * RLS policy like is_starred/is_public. Manual mode only changes whether
 * the chat agent asks before starting a real build/AI fix (see
 * app/agent/graph.py's apply_node and build-status-listener.tsx) — it never
 * touches anything account-level.
 */
export async function setAutonomyMode(projectId: string, mode: "solo" | "manual") {
  const supabase = await createClient();
  await supabase.from("projects").update({ autonomy_mode: mode }).eq("id", projectId);
  revalidatePath(`/project/${projectId}`);
}

/**
 * Off by default (00042_conversion_agent.sql) — a plain owner preference,
 * covered by the same "projects: owner can update" RLS policy as
 * autonomy_mode/is_starred above. Gates ONLY the orchestrator's background
 * conversion-detection/experiment loop (app/conversion_agent.py); the
 * required behavior tracker every generated app ships
 * (components/meero-behavior-tracker.tsx) always records regardless of
 * this flag, exactly like the runtime error reporter does.
 */
export async function setConversionAgentEnabled(projectId: string, enabled: boolean) {
  const supabase = await createClient();
  await supabase.from("projects").update({ conversion_agent_enabled: enabled }).eq("id", projectId);
  revalidatePath(`/project/${projectId}`);
}

// Builder chat is handled client-side (src/components/builder/chat-panel.tsx):
// the browser stores the user message via RLS-scoped insert, then streams the
// agent's reply from the orchestrator's /chat/stream SSE endpoint.

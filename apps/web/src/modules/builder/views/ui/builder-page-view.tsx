import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BuilderCanvas } from "./builder-canvas";
import { BuilderLayout } from "./builder-layout";
import { BuilderTopBar } from "./builder-top-bar";
import { BuilderViewProvider, type BuilderTab } from "../../providers/builder-view-context";
import { BuildStatusListener } from "./build-status-listener";
import { ChatPanel } from "./chat-panel";
import { GithubConnectPrompt } from "./github-connect-prompt";
import {
  ProjectActivityProvider,
  type BuildActivity,
  type LivePlan,
} from "../../providers/project-activity-context";
import { CloneButton } from "@/modules/projects/views/ui/clone-button";
import { MeeroMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import type {
  Build,
  BuildFile,
  ConversionExperiment,
  ConversionHypothesis,
  ConversionResult,
  Message,
  Profile,
  Project,
  Spec,
} from "@/lib/types";
import { SidebarTriggerButton } from "@/modules/sidebar/views/ui/sidebar-trigger";

type ConversionExperimentWithResults = ConversionExperiment & {
  conversion_results: ConversionResult[];
};

export async function BuilderPageView({ projectId: id }: { projectId: string }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes this to the caller's own projects, plus any project someone
  // has made public (00015_marketplace.sql) — anyone else's private project
  // still 404s here exactly as before.
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle<Project>();
  if (!project) notFound();

  const isOwner = project.owner_id === user.id;

  // A real collaborator (00027_collaborators.sql) gets the full builder —
  // chat, code, live status — same as the owner, just billed to the
  // owner's credits and without account-level connection actions. Anyone
  // else lands in the read-only public view below.
  let isCollaborator = false;
  if (!isOwner) {
    const { data: membership } = await supabase
      .from("project_collaborators")
      .select("id")
      .eq("project_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    isCollaborator = !!membership;
  }
  const canWork = isOwner || isCollaborator;

  // A visitor on someone else's public project gets a read-only view — no
  // chat, no code tab, no live WS status — since none of those make sense
  // (or are RLS-permitted) for anyone but the owner/a collaborator. The
  // only action here is Clone, which spins up the visitor's OWN independent
  // copy.
  if (!canWork) {
    const { data: latestBuild } = await supabase
      .from("builds")
      .select("*")
      .eq("project_id", id)
      .eq("status", "succeeded")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle<Build>();

    return (
      <div className="flex h-screen flex-col bg-white">
        <header className="flex h-14 shrink-0 items-center gap-2 bg-white px-3 sm:px-4">
          <SidebarTriggerButton />
          <Link
            href="/"
            aria-label="Back to home"
            className="flex min-w-0 shrink items-center gap-2 rounded-lg py-1 pr-2 transition hover:bg-muted"
          >
            <MeeroMark size={22} className="shrink-0" />
            <span aria-hidden className="shrink-0 text-[16px] font-light text-input">
              /
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[14px] leading-tight font-semibold text-foreground">
                {project.name}
              </span>
              <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                Public app
              </span>
            </span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <Badge variant="secondary">Public</Badge>
            <CloneButton projectId={project.id} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/60 p-4">
          {latestBuild?.preview_url ? (
            <iframe
              src={latestBuild.preview_url}
              title="Live web app"
              sandbox="allow-scripts allow-same-origin allow-modals allow-forms"
              className="h-full w-full rounded-2xl border border-border bg-white shadow-primary/10"
            />
          ) : (
            <p className="text-[13px] text-muted-foreground">
              This project has no successful build yet.
            </p>
          )}
        </div>
      </div>
    );
  }

  // A collaborator's builder needs to know the OWNER's Supabase/GitHub/plan
  // state (that's whose connections the app actually runs on) — but
  // `profiles` carries real billing internals RLS can't safely widen to a
  // collaborator, so this goes through a narrow security-definer RPC
  // instead (00027_collaborators.sql) rather than a direct table read.
  const profilePromise = isOwner
    ? supabase
        .from("profiles")
        .select("github_username, supabase_connected, plan")
        .eq("id", user.id)
        .maybeSingle<Pick<Profile, "github_username" | "supabase_connected" | "plan">>()
    : supabase
        .rpc("project_owner_public_profile", { p_project_id: id })
        .maybeSingle<Pick<Profile, "github_username" | "supabase_connected" | "plan">>();

  const [
    { data: specs },
    { data: builds },
    { data: messages },
    { data: files },
    { data: profile },
    { data: conversionHypotheses },
    { data: conversionExperiments },
  ] = await Promise.all([
    supabase.from("specs").select("*").eq("project_id", id).order("version", { ascending: true }),
    supabase
      .from("builds")
      .select("*")
      .eq("project_id", id)
      .order("queued_at", { ascending: false }),
    supabase
      .from("messages")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: true }),
    // The generated source of the most recently built project — the Code
    // tab shows this. Newest build's files first; grouped client-side below.
    supabase
      .from("build_files")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .order("seq", { ascending: true })
      .limit(400),
    profilePromise,
    // Conversion tab data (00042_conversion_agent.sql) — same
    // fetch-server-side-in-page.tsx pattern as builds/specs/messages, so a
    // conversion.* WebSocket event's router.refresh() (build-status-listener.tsx)
    // keeps this live without a separate client-side poll.
    supabase
      .from("conversion_hypotheses")
      .select("*")
      .eq("project_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    // Results are embedded via the real FK (conversion_results.experiment_id
    // -> conversion_experiments.id) — one query instead of a second
    // sequential fetch. The embedded order() targets conversion_results
    // specifically (referencedTable) — conversion-panel.tsx reads
    // conversion_results[0] as "the latest result" for its lift badge, so
    // this must be newest-first or that badge could show a stale value.
    supabase
      .from("conversion_experiments")
      .select("*, conversion_results(*)")
      .eq("project_id", id)
      .order("started_at", { ascending: false })
      .order("evaluated_at", {
        ascending: false,
        referencedTable: "conversion_results",
      })
      .limit(20),
  ]);

  const specList = (specs ?? []) as Spec[];
  const buildList = (builds ?? []) as Build[];

  // Show the code from a single, most-recent build (a fresh build regenerates
  // the whole project, so mixing files across builds would be misleading).
  const allFiles = (files ?? []) as BuildFile[];
  const newestBuildId = allFiles[0]?.build_id;
  const codeFiles = allFiles
    .filter((f) => f.build_id === newestBuildId)
    .sort((a, b) => a.seq - b.seq);
  const latestSpec = specList.at(-1);

  // Server-derived snapshot of the newest build. codegen_worker.py now
  // persists each generated file to build_files the moment it's finalized
  // (db.upsert_build_file, 00040_build_files_live_persist.sql) instead of
  // only writing the whole bundle once at the very end — so a refresh
  // mid-generation can seed real partial progress here instead of landing
  // on a blank slate that silently waits for the next WebSocket event.
  const latestBuild = buildList[0];
  const generating = latestBuild?.status === "queued" || latestBuild?.status === "running";
  // Kick straight to the Code tab when a build is actively generating and
  // nothing's built yet, so the user lands on the code being written;
  // otherwise default to the live preview (BuilderCanvas's own rising-edge
  // effect handles jumping there mid-session once a NEW build starts).
  const initialTab: BuilderTab = generating && codeFiles.length === 0 ? "code" : "preview";
  let activitySeed: Partial<BuildActivity> | null = null;
  if (latestBuild && (latestBuild.status === "failed" || latestBuild.status === "canceled")) {
    const hasFiles = codeFiles.length > 0 && newestBuildId === latestBuild.id;
    const startedAt = latestBuild.started_at
      ? new Date(latestBuild.started_at).getTime()
      : new Date(latestBuild.queued_at).getTime();
    activitySeed = {
      buildId: latestBuild.id,
      files: hasFiles
        ? codeFiles.map((f) => ({
            path: f.path,
            status: "done" as const,
            content: f.content,
          }))
        : [],
      fileCount: hasFiles ? codeFiles.length : null,
      plan: (latestBuild.plan_preview as LivePlan | null) ?? null,
      error: latestBuild.error,
      isFix: latestBuild.retry_of != null,
      startedAt,
      phase: latestBuild.status,
      active: false,
    };
  } else if (latestBuild && (latestBuild.status === "queued" || latestBuild.status === "running")) {
    // Genuinely still in progress — nothing terminal yet. Seed whatever real
    // partial files have already been persisted; fileCount stays null since
    // the true total isn't known until the bundle finishes (an in-progress
    // count would misleadingly read as "that's everything").
    const hasFiles = codeFiles.length > 0 && newestBuildId === latestBuild.id;
    const startedAt = latestBuild.started_at
      ? new Date(latestBuild.started_at).getTime()
      : new Date(latestBuild.queued_at).getTime();
    activitySeed = {
      buildId: latestBuild.id,
      files: hasFiles
        ? codeFiles.map((f) => ({
            path: f.path,
            status: "done" as const,
            content: f.content,
          }))
        : [],
      fileCount: null,
      plan: (latestBuild.plan_preview as LivePlan | null) ?? null,
      error: null,
      isFix: latestBuild.retry_of != null,
      startedAt,
      phase: latestBuild.retry_of != null ? "fixing_code" : "generating_code",
      active: true,
    };
  } else if (latestBuild && latestBuild.status === "succeeded") {
    // Seed the finished pipeline card too — not just its failed/in-progress
    // counterparts above — so "Done! Your app is live", the schema/bundle
    // achievement boxes, and the "What's next?" tips survive a real page
    // refresh instead of only ever existing for the live WS session that
    // originally produced them (chat-panel.tsx's buildLive is gated purely
    // on activity.phase being non-null, which without this seed stays null
    // on every cold load and silently falls back to a bare "Built X" chip
    // row with none of that).
    const hasFiles = codeFiles.length > 0 && newestBuildId === latestBuild.id;
    const startedAt = latestBuild.started_at
      ? new Date(latestBuild.started_at).getTime()
      : new Date(latestBuild.queued_at).getTime();
    activitySeed = {
      buildId: latestBuild.id,
      files: hasFiles
        ? codeFiles.map((f) => ({
            path: f.path,
            status: "done" as const,
            content: f.content,
          }))
        : [],
      fileCount: hasFiles ? codeFiles.length : null,
      plan: (latestBuild.plan_preview as LivePlan | null) ?? null,
      error: null,
      isFix: latestBuild.retry_of != null,
      startedAt,
      phase: "succeeded",
      active: false,
    };
  }

  // Projects created before chat existed: show their spec history as the
  // opening user messages so the conversation has real context.
  let messageList = (messages ?? []) as Message[];
  if (messageList.length === 0 && specList.length > 0) {
    messageList = specList.map((spec) => ({
      id: spec.id,
      project_id: spec.project_id,
      role: "user" as const,
      content: spec.prompt,
      spec_version: spec.version,
      created_at: spec.created_at,
    }));
  }

  // Auto-intro: a freshly created project (a spec, no builds, and the agent
  // hasn't spoken yet) should have Meero open the conversation — reflect the
  // idea back and ask clarifying questions — instead of silently building.
  // The agent only starts a real build once the user engages (see graph.py).
  const hasAssistantMessage = messageList.some((m) => m.role === "assistant");
  const autoStartPrompt =
    !!latestSpec && buildList.length === 0 && !hasAssistantMessage
      ? (messageList.filter((m) => m.role === "user").at(-1)?.content ?? null)
      : null;

  const plan = profile?.plan ?? "free";
  const hypothesisList = (conversionHypotheses ?? []) as ConversionHypothesis[];
  const experimentList = (conversionExperiments ?? []) as ConversionExperimentWithResults[];
  const hasConversionAlert =
    hypothesisList.some((h) => h.status === "open") ||
    experimentList.some((e) => ["winner_a", "winner_b", "inconclusive"].includes(e.status));

  return (
    <div className="flex h-screen flex-col">
      {isOwner && (
        <GithubConnectPrompt
          projectId={project.id}
          githubUsername={profile?.github_username ?? null}
          alreadyLinked={!!project.github_repo_full_name}
        />
      )}
      <BuilderViewProvider initialTab={initialTab}>
        <BuilderTopBar
          isOwner={isOwner}
          isCollaborator={isCollaborator}
          projectId={project.id}
          projectName={project.name}
          plan={plan}
          isPublic={project.is_public}
          liveUrl={project.live_url}
          generating={!!generating}
          supabaseLinked={!!project.supabase_project_ref}
          monitoringActive={
            !!project.supabase_project_ref && buildList.some((b) => b.status === "succeeded")
          }
          autonomyMode={project.autonomy_mode}
          hasConversionAlert={hasConversionAlert}
        />

        <ProjectActivityProvider initial={activitySeed}>
          <BuilderLayout
            chat={
              <ChatPanel
                projectId={project.id}
                messages={messageList}
                files={codeFiles}
                hasBuiltBefore={buildList.some((b) => b.status === "succeeded")}
                autoStartPrompt={autoStartPrompt}
                supabaseLinked={!!project.supabase_project_ref}
                supabaseConnected={profile?.supabase_connected ?? false}
                pendingBuildSpecId={project.pending_build_spec_id}
                isOwner={isOwner}
                autonomyMode={project.autonomy_mode}
              />
            }
            canvas={
              <BuilderCanvas
                builds={buildList}
                files={codeFiles}
                plan={plan}
                supabaseLinked={!!project.supabase_project_ref}
                autonomyMode={project.autonomy_mode}
                conversionAgentEnabled={project.conversion_agent_enabled}
                conversionHypotheses={hypothesisList}
                conversionExperiments={experimentList}
                connections={{
                  projectId: project.id,
                  isOwner,
                  plan,
                  supabaseConnected: profile?.supabase_connected ?? false,
                  supabaseRef: project.supabase_project_ref,
                  supabaseUrl: project.supabase_url,
                  supabaseProvisioningStatus: project.supabase_provisioning_status,
                  supabaseProvisioningError: project.supabase_provisioning_error,
                  githubUsername: profile?.github_username ?? null,
                  githubRepoUrl: project.github_repo_url,
                  githubRepoFullName: project.github_repo_full_name,
                  liveUrl: project.live_url,
                  customDomain: project.custom_domain,
                  customDomainVerified: project.custom_domain_verified,
                }}
              />
            }
          />

          <BuildStatusListener
            projectId={project.id}
            builds={buildList}
            autonomyMode={project.autonomy_mode}
          />
        </ProjectActivityProvider>
      </BuilderViewProvider>
    </div>
  );
}

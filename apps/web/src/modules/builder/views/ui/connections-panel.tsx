"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CollaboratorsManager } from "@/modules/builder/views/ui/collaborators-manager";
import { DomainManager } from "@/modules/builder/views/ui/domain-manager";
import { GithubButton } from "@/modules/builder/views/ui/github-button";
import { SupabaseButton } from "@/modules/builder/views/ui/supabase-button";
import {
  ExternalLinkIcon,
  GithubIcon,
  LogOutIcon,
  PullRequestIcon,
  ShieldIcon,
  SupabaseIcon,
  UsersIcon,
  VercelIcon,
} from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import type { Plan } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Everything the builder's Connections tab needs — all real, all read from
 * the DB (trigger-protected projections written only by the orchestrator).
 */
export type ConnectionsInfo = {
  projectId: string;
  isOwner: boolean;
  plan: Plan;
  supabaseConnected: boolean;
  supabaseRef: string | null;
  supabaseUrl: string | null;
  supabaseProvisioningStatus: "provisioning" | "failed" | null;
  supabaseProvisioningError: string | null;
  githubUsername: string | null;
  githubRepoUrl: string | null;
  githubRepoFullName: string | null;
  liveUrl: string | null;
  customDomain: string | null;
  customDomainVerified: boolean;
};

type Tone = "on" | "action" | "off";

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  const styles: Record<Tone, string> = {
    on: "border-emerald-200 bg-emerald-50 text-emerald-700",
    action: "border-primary/30 bg-primary/10 text-primary",
    off: "border-border bg-muted text-muted-foreground",
  };

  const dot: Record<Tone, string> = {
    on: "bg-emerald-500",
    action: "bg-primary",
    off: "bg-input",
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[tone]}`}
    >
      <span className={`size-1 rounded-full ${dot[tone]}`} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Real Supabase logout — drops the stored Management API tokens
 * and unbinds this project, then refreshes.
 */
function DisconnectSupabaseButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const supabase = createClient();

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;

      if (!base || !session) {
        throw new Error("Session expired — reload and sign in again.");
      }

      const res = await fetch(`${base}/projects/${projectId}/supabase/disconnect`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);

        throw new Error(body?.detail || `Failed (${res.status}).`);
      }

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't log out of Supabase.");
      setBusy(false);
    }
  }

  return (
    <span className="ml-auto flex items-center gap-2">
      {error && <span className="max-w-[150px] truncate text-[11px] text-red-600">{error}</span>}

      <AlertDialog>
        <AlertDialogTrigger
          render={<Button type="button" variant="secondary" size="sm" disabled={busy} />}
        >
          <LogOutIcon size={13} />
          {busy ? "Logging out…" : "Log out"}
        </AlertDialogTrigger>

        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out of Supabase?</AlertDialogTitle>

            <AlertDialogDescription>
              This will unlink the Supabase project from this app. Future builds will need you to
              reconnect Supabase. Apps you&apos;ve already deployed will continue working.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>

            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void disconnect();
              }}
              variant="destructive"
            >
              {busy ? "Logging out…" : "Log out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

function OpenLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-w-0 items-center gap-1 font-mono text-[11.5px] text-secondary-foreground underline decoration-input underline-offset-2 transition hover:text-foreground hover:decoration-foreground"
    >
      <span className="truncate">{children}</span>
      <ExternalLinkIcon size={11} className="shrink-0" />
    </a>
  );
}

function ConnectionCard({
  icon,
  tint,
  title,
  status,
  description,
  detail,
  action,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  status: {
    tone: Tone;
    label: string;
  };
  description: string;
  detail?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border p-5 transition-colors hover:border-foreground/20">
      <div className="flex flex-col items-start gap-4">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tint}`}
          aria-hidden
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>

            <StatusPill tone={status.tone} label={status.label} />
          </div>

          <p className="mt-1.5 text-[13px] leading-relaxed text-secondary-foreground">
            {description}
          </p>

          {detail && <div className="mt-3">{detail}</div>}

          {action && (
            <div className="mt-4 flex items-center gap-3 border-t border-border pt-3.5">
              {action}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConnectionsPanel({ info }: { info: ConnectionsInfo }) {
  const {
    projectId,
    isOwner,
    plan,
    supabaseConnected,
    supabaseRef,
    supabaseUrl,
    supabaseProvisioningStatus,
    supabaseProvisioningError,
    githubUsername,
    githubRepoUrl,
    githubRepoFullName,
    liveUrl,
    customDomain,
    customDomainVerified,
  } = info;

  const supabaseStatus: {
    tone: Tone;
    label: string;
  } = supabaseRef
    ? {
        tone: "on",
        label: "Linked",
      }
    : supabaseProvisioningStatus === "provisioning"
      ? {
          tone: "action",
          label: "Setting up…",
        }
      : supabaseProvisioningStatus === "failed"
        ? {
            tone: "action",
            label: "Setup failed",
          }
        : supabaseConnected
          ? {
              tone: "action",
              label: "Link a project",
            }
          : {
              tone: "action",
              label: "Not connected",
            };

  const githubStatus: {
    tone: Tone;
    label: string;
  } = githubRepoUrl
    ? {
        tone: "on",
        label: "Published",
      }
    : githubUsername
      ? {
          tone: "action",
          label: "Ready to publish",
        }
      : {
          tone: "off",
          label: "Not connected",
        };

  const vercelStatus: {
    tone: Tone;
    label: string;
  } = liveUrl
    ? {
        tone: "on",
        label: "Live",
      }
    : plan !== "free"
      ? {
          tone: "off",
          label: "Not released",
        }
      : {
          tone: "off",
          label: "Pro & Ultra",
        };

  return (
    <div className="h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
      <div className="mx-auto max-w-2xl">
        <div className="mb-4 flex items-start gap-2.5">
          <ShieldIcon size={17} className="mt-0.5 shrink-0 text-primary" />

          <p className="text-[13px] leading-relaxed text-secondary-foreground">
            Your app is <span className="font-medium text-foreground">full-stack and yours</span> —
            its database, accounts, code, and deployment all live in your own connected services.
            Nothing runs on Meero&apos;s servers.
          </p>
        </div>

        <div className="space-y-4">
          <ConnectionCard
            icon={<SupabaseIcon size={20} className="text-emerald-600" />}
            tint="bg-emerald-50"
            title="Supabase"
            status={supabaseStatus}
            description="Your app's Postgres database and user accounts. Connect your account and Meero creates and links a new Supabase project automatically — every build then applies its schema here, with row-level security on every table."
            detail={
              supabaseRef ? (
                <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5">
                  <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
                    LINKED PROJECT
                  </span>

                  <OpenLink href={`https://supabase.com/dashboard/project/${supabaseRef}`}>
                    {supabaseUrl?.replace(/^https:\/\//, "") ?? supabaseRef}
                  </OpenLink>
                </div>
              ) : supabaseProvisioningStatus === "failed" && supabaseProvisioningError ? (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-red-700">
                  {supabaseProvisioningError}
                </p>
              ) : undefined
            }
            action={
              isOwner ? (
                <>
                  <SupabaseButton
                    projectId={projectId}
                    connected={supabaseConnected}
                    linkedRef={supabaseRef}
                    provisioningStatus={supabaseProvisioningStatus}
                    provisioningError={supabaseProvisioningError}
                  />

                  <span className="text-[12px] text-muted-foreground">
                    {supabaseRef
                      ? "Schema is applied here on every build."
                      : supabaseProvisioningStatus === "provisioning"
                        ? "Creating a new Supabase project for this app…"
                        : "Required before your app can build."}
                  </span>

                  {supabaseConnected && <DisconnectSupabaseButton projectId={projectId} />}
                </>
              ) : (
                <span className="text-[12px] text-muted-foreground">
                  {supabaseRef
                    ? "Linked by the project owner."
                    : "The owner hasn't linked Supabase yet."}
                </span>
              )
            }
          />

          <ConnectionCard
            icon={<GithubIcon size={20} className="text-foreground" />}
            tint="bg-muted"
            title="GitHub"
            status={githubStatus}
            description="Track this app in a real private repo. Every successful build — and every automatic fix — commits straight to main, giving you a full, traceable history of how your app evolves."
            detail={
              githubRepoFullName ? (
                <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5">
                  <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
                    <PullRequestIcon size={12} />
                    REPOSITORY
                  </span>

                  <OpenLink href={githubRepoUrl ?? `https://github.com/${githubRepoFullName}`}>
                    {githubRepoFullName}
                  </OpenLink>
                </div>
              ) : undefined
            }
            action={
              isOwner ? (
                <>
                  <GithubButton
                    projectId={projectId}
                    githubUsername={githubUsername}
                    repoUrl={githubRepoUrl}
                  />

                  <span className="text-[12px] text-muted-foreground">
                    {githubRepoUrl
                      ? "New builds commit to main."
                      : githubUsername
                        ? `Publish as @${githubUsername}.`
                        : "Optional — connect to version-control your app."}
                  </span>
                </>
              ) : (
                <span className="text-[12px] text-muted-foreground">
                  {githubRepoUrl ? "New builds commit to main." : "Not connected by the owner."}
                </span>
              )
            }
          />

          <ConnectionCard
            icon={<VercelIcon size={18} className="text-foreground" />}
            tint="bg-muted"
            title="Vercel — production"
            status={vercelStatus}
            description="Ship a real production deployment to Vercel with a live public URL. Trigger a release per build from the Preview tab (Pro & Ultra plans)."
            detail={
              liveUrl ? (
                <div className="space-y-2.5">
                  <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5">
                    <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
                      PRODUCTION URL
                    </span>

                    <OpenLink href={liveUrl}>{liveUrl.replace(/^https:\/\//, "")}</OpenLink>
                  </div>

                  {plan !== "free" && isOwner && (
                    <DomainManager
                      projectId={projectId}
                      domain={customDomain}
                      verified={customDomainVerified}
                    />
                  )}
                </div>
              ) : undefined
            }
            action={
              <span className="text-[12px] text-muted-foreground">
                {!isOwner
                  ? liveUrl
                    ? "Released by the project owner."
                    : "Production releases are managed by the owner."
                  : liveUrl
                    ? "Re-release anytime from the Preview tab."
                    : plan !== "free"
                      ? "Open the Preview tab and hit “Release to production” on a successful build."
                      : "Upgrade to Pro or Ultra to unlock one-click production releases."}
              </span>
            }
          />

          {isOwner && (
            <ConnectionCard
              icon={<UsersIcon size={18} className="text-foreground" />}
              tint="bg-muted"
              title="Team"
              status={{
                tone: "off",
                label: "Owner-managed",
              }}
              description="Invite an existing Meero teammate onto this project — full chat and build access, billed to your credits, no account-level connections."
              detail={<CollaboratorsManager projectId={projectId} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}

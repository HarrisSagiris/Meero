"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toggleStar } from "@/modules/projects/actions/project-actions";
import { CloneButton } from "@/modules/projects/views/ui/clone-button";
import { DeleteProjectButton } from "@/modules/projects/views/ui/delete-project-button";
import { GithubIcon, StarIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { timeAgo } from "@/lib/time";
import type { Project } from "@/lib/types";

export function ProjectCard({
  project,
  isOwner,
}: {
  project: Project;
  /** False for another user's project surfaced in the Marketplace tab —
   *  shows a Clone action instead of the star toggle. */
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="group relative rounded-xl flex flex-col justify-between border border-border p-3 px-4 transition-colors hover:border-foreground/30">
      <Link
        href={`/project/${project.id}`}
        className="absolute inset-0 rounded-xl"
        aria-label={`Open ${project.name}`}
      />

      <div>
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 truncate text-[15px] font-semibold">{project.name}</h3>
          {isOwner && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => toggleStar(project.id, !project.is_starred))}
                aria-label={project.is_starred ? "Unstar project" : "Star project"}
                className={`relative z-10 rounded-md p-1 transition-all duration-200 ${
                  project.is_starred
                    ? "text-foreground"
                    : "text-input opacity-0 group-hover:opacity-100 hover:text-secondary-foreground focus-visible:opacity-100"
                }`}
              >
                <StarIcon filled={project.is_starred} size={16} />
              </button>
              <DeleteProjectButton projectId={project.id} projectName={project.name} />
            </div>
          )}
        </div>

        {project.description && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-secondary-foreground">
            {project.description}
          </p>
        )}

        {/*{(project.github_repo_full_name || project.live_url || (!isOwner && project.is_public)) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {project.live_url && (
              <Badge variant="secondary" className="inline-flex items-center gap-1">
                <StatusDot tone="live" />
                Live on Vercel
              </Badge>
            )}
            {project.github_repo_full_name && (
              <Badge variant="secondary" className="inline-flex items-center gap-1">
                <GithubIcon size={11} />
                Published
              </Badge>
            )}
            {!isOwner && project.is_public && <Badge variant="secondary">Public</Badge>}
          </div>
        )}*/}
      </div>
      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <StatusDot />
          Edited {timeAgo(project.updated_at)}
        </p>
        {!isOwner && <CloneButton projectId={project.id} />}
      </div>
    </div>
  );
}

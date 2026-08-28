"use client";

import { useEffect, useState } from "react";
import { ProjectCard } from "@/modules/projects/views/ui/project-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";

export function ProjectsSection({
  projects,
  starredOnly = false,
  currentUserId,
}: {
  projects: Project[];
  starredOnly?: boolean;
  currentUserId: string;
}) {
  const [tab, setTab] = useState<"projects" | "community">("projects");
  const projectsLabel = starredOnly ? "Starred projects" : "Recent projects";

  // Everyone's public projects — the marketplace. Fetched client-side on
  // demand (not server-rendered like `projects`) so the home page's default
  // load never has to pull every public project on the platform. `null`
  // doubles as the loading signal — no separate loading state to set inside
  // the effect.
  const [community, setCommunity] = useState<Project[] | null>(null);

  useEffect(() => {
    if (tab !== "community" || community !== null) return;
    const supabase = createClient();
    supabase
      .from("projects")
      .select("*")
      .eq("is_public", true)
      .order("updated_at", { ascending: false })
      .limit(60)
      .then(({ data }) => {
        setCommunity((data ?? []) as Project[]);
      });
  }, [tab, community]);

  return (
    <section id="projects" className="mx-auto mb-16 max-w-6xl px-2">
      <div className="flex items-center justify-between gap-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "projects" | "community")}>
          <TabsList aria-label="View">
            <TabsTrigger value="projects">{projectsLabel}</TabsTrigger>
            <TabsTrigger value="community">Marketplace</TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "projects" && (
          <span className="text-[13px] text-muted-foreground">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
          </span>
        )}
        {tab === "community" && community && (
          <span className="text-[13px] text-muted-foreground">
            {community.length} public {community.length === 1 ? "project" : "projects"}
          </span>
        )}
      </div>

      {tab === "projects" ? (
        projects.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-6 py-14 text-center">
            <p className="text-[15px] font-medium text-secondary-foreground">
              {starredOnly ? "Nothing starred yet." : "No projects yet."}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {starredOnly
                ? "Star a project to pin it here."
                : "Describe an app above to create your first one."}
            </p>
            {!starredOnly && (
              <a
                href="#top"
                className="mt-4 inline-block rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-white shadow-primary/10 transition hover:bg-primary/85"
              >
                Describe your idea ↑
              </a>
            )}
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} isOwner />
            ))}
          </div>
        )
      ) : community === null ? (
        <div className="mt-6 flex items-center justify-center py-14">
          <span className="size-5 animate-spin rounded-full border-2 border-input border-t-primary" />
        </div>
      ) : community.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-6 py-14 text-center">
          <p className="text-[15px] font-medium text-secondary-foreground">Nothing public yet.</p>
          <p className="text-[13px] text-muted-foreground">
            Every free-plan app is public by default — check back soon.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {community.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isOwner={project.owner_id === currentUserId}
            />
          ))}
        </div>
      )}
    </section>
  );
}

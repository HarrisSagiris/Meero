"use client";

import { useEffect, useState } from "react";
import { ProjectCard } from "@/modules/projects/views/ui/project-card";
import { createClient } from "@/lib/supabase/client";
import type { Project } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Users2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function MarketplaceProjects({ currentUserId }: { currentUserId: string }) {
  const [projects, setProjects] = useState<Project[] | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase
      .from("projects")
      .select("*")
      .eq("is_public", true)
      .order("updated_at", { ascending: false })
      .limit(60)
      .then(({ data }) => {
        setProjects((data ?? []) as Project[]);
      });
  }, []);

  if (projects === null) {
    return (
      <section className="mx-auto mb-16 max-w-6xl px-2">
        <div className="flex items-center justify-center py-14">
          <span className="size-5 animate-spin rounded-full border-2 border-input border-t-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto mb-16 max-w-6xl px-2">
      <div className="flex items-end justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button size="icon-lg" variant="secondary">
            <Users2 />
          </Button>
          <div>
            <h2 className="text-base font-medium">Marketplace</h2>
            <p className="text-[12px] text-muted-foreground">
              Discover public projects from the community.
            </p>
          </div>
        </div>

        <Badge className="text-xs">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
        </Badge>
      </div>

      {projects.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-6 py-14 text-center">
          <p className="text-[15px] font-medium text-secondary-foreground">Nothing public yet.</p>

          <p className="text-[13px] text-muted-foreground">
            Every free-plan app is public by default — check back soon.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
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

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, ExternalLinkIcon } from "@/components/icons";
import { MeeroMark } from "@/components/logo";
import type { Project } from "@/lib/types";

export type PublicProject = Pick<
  Project,
  "id" | "name" | "description" | "screenshot_url" | "live_url" | "display_title"
>;

/** The AI-generated short title when one exists, never the raw build
 *  prompt `name` derives from — falls back to `name` only for projects
 *  built before display_title generation shipped, or if generation hasn't
 *  landed yet. */
function galleryTitle(project: PublicProject): string {
  return project.display_title || project.name;
}

/** A stand-in for projects with no screenshot yet (not a fake screenshot —
 *  an honest "nothing captured yet" card, same visual language everywhere). */
function PlaceholderArt({ name }: { name: string }) {
  return (
    <div className="meero-gradient-soft flex h-full w-full items-center justify-center">
      <MeeroMark size={28} className="opacity-40" invert={false} />
      <span className="sr-only">{name}</span>
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: PublicProject; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group text-left">
      <div className="aspect-[4/3] w-full overflow-hidden rounded-2xl border border-border bg-white shadow-primary/10 transition-shadow duration-300 group-hover:shadow-composer">
        {project.screenshot_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- external per-project Storage URL, not a static/local asset Next's optimizer can process
          <img
            src={project.screenshot_url}
            alt={galleryTitle(project)}
            className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <PlaceholderArt name={galleryTitle(project)} />
        )}
      </div>
      <p className="mt-2.5 truncate px-0.5 text-[13px] font-medium text-secondary-foreground transition-colors group-hover:text-foreground">
        {galleryTitle(project)}
      </p>
    </button>
  );
}

function ProjectModal({ project, onClose }: { project: PublicProject; onClose: () => void }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
      />
      <div className="animate-pop relative w-full max-w-lg overflow-hidden rounded-3xl border border-border bg-white shadow-composer">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-lg bg-white/90 text-secondary-foreground shadow-primary/10 transition hover:text-foreground"
        >
          <CloseIcon size={16} />
        </button>

        <div className="relative aspect-[4/3] w-full bg-muted">
          {project.screenshot_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- external per-project Storage URL
            <img
              src={project.screenshot_url}
              alt={galleryTitle(project)}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <PlaceholderArt name={galleryTitle(project)} />
          )}
          {project.live_url && (
            <a
              href={project.live_url}
              target="_blank"
              rel="noopener noreferrer"
              // Solid pill + dark text, not translucent-white-on-white —
              // this sits over whatever's behind it (a real screenshot, or
              // the light meero-gradient-soft placeholder when there isn't
              // one yet), and translucent white text was only ever legible
              // against a real dark-enough photo. This reads clearly either
              // way, same "stays visible over unpredictable content"
              // pattern as the builder's own floating pills.
              className="group/visit absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full border border-border bg-white/95 px-4 py-2 text-[13px] font-medium text-foreground shadow-primary/10 backdrop-blur-md transition hover:bg-white"
            >
              Visit website
              <ExternalLinkIcon
                size={12}
                className="transition-transform group-hover/visit:translate-x-0.5"
              />
            </a>
          )}
        </div>

        <div className="p-6">
          <h3 className="text-[18px] font-semibold tracking-tight text-foreground">
            {galleryTitle(project)}
          </h3>
          {project.description && (
            <p className="mt-2 text-[14px] leading-relaxed text-secondary-foreground">
              {project.description}
            </p>
          )}
          <Link
            href="/signup"
            className="mt-5 inline-flex items-center rounded-full bg-foreground px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-neutral-800"
          >
            Start building your own
          </Link>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Gallery of real public projects (00020_project_screenshots.sql) for
 * logged-out visitors — click a card to open it larger in a popup. Nothing
 * fake here: screenshot_url is null until a real successful build actually
 * captured one, in which case the card falls back to a plain placeholder.
 */
export function PublicGallery({ projects }: { projects: PublicProject[] }) {
  const [selected, setSelected] = useState<PublicProject | null>(null);

  if (projects.length === 0) return null;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onOpen={() => setSelected(p)} />
        ))}
      </div>
      {selected && <ProjectModal project={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

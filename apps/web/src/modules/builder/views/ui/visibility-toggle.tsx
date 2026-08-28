"use client";

import { useTransition } from "react";
import { setProjectVisibility } from "@/modules/projects/actions/project-actions";
import { ChevronDownIcon, GlobeIcon, LockIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const OPTIONS = [
  {
    value: "private" as const,
    label: "Private",
    hint: "Only you can open this project. It stays off the Marketplace.",
  },
  {
    value: "public" as const,
    label: "Public",
    hint: "Listed on the Marketplace — any signed-in user can view it and clone their own copy onto their Supabase.",
  },
];

/**
 * Pro/Ultra-only: opt a project into (or out of) the marketplace.
 *
 * Free-plan projects are always public at the database layer and never
 * render this component.
 */
export function VisibilityToggle({
  projectId,
  isPublic,
}: {
  projectId: string;
  isPublic: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const current = isPublic ? "public" : "private";
  const Icon = isPublic ? GlobeIcon : LockIcon;

  function choose(value: "public" | "private") {
    const next = value === "public";

    if (next === isPublic) return;

    startTransition(() => {
      void setProjectVisibility(projectId, next);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            title={isPublic ? "Public — on the Marketplace" : "Private — only you"}
            className="h-8 rounded-full px-2.5 text-[13px] font-medium"
          />
        }
      >
        <Icon size={14} className={isPublic ? "text-primary" : "text-secondary-foreground"} />

        {pending ? "…" : isPublic ? "Public" : "Private"}

        <ChevronDownIcon
          size={12}
          className="text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 rounded-2xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel>PROJECT VISIBILITY</DropdownMenuLabel>

          {OPTIONS.map((option) => {
            const isSelected = option.value === current;
            const OptIcon = option.value === "public" ? GlobeIcon : LockIcon;

            return (
              <DropdownMenuItem
                key={option.value}
                disabled={pending}
                onClick={() => choose(option.value)}
                className={`items-start gap-2.5 rounded-xl px-3 py-2.5 ${
                  isSelected ? "bg-muted" : ""
                }`}
              >
                <OptIcon
                  size={16}
                  className={`mt-0.5 shrink-0 ${
                    option.value === "public" ? "text-primary" : "text-secondary-foreground"
                  }`}
                />

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold text-foreground">
                      {option.label}
                    </span>

                    {isSelected && (
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 20 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-emerald-600"
                        aria-hidden
                      >
                        <path d="m4 10.5 4 4 8-9" />
                      </svg>
                    )}
                  </span>

                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

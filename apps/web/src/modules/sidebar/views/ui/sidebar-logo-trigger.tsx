"use client";

import { PanelLeftIcon } from "lucide-react";
import { MeeroMark } from "@/components/logo";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** Collapsed-rail header: the logo mark doubles as the expand trigger —
 *  hover swaps it for the expand icon in place, no separate button. */
export function SidebarLogoTrigger({ className }: { className?: string }) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label="Expand sidebar"
      className={cn(
        "group/logo-trigger relative size-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] hover:bg-sidebar-accent",
        className,
      )}
    >
      <MeeroMark
        size={22}
        className="mx-auto transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/logo-trigger:opacity-0"
      />
      <PanelLeftIcon className="absolute inset-0 m-auto size-4 rotate-180 text-sidebar-foreground opacity-0 transition-opacity duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/logo-trigger:opacity-100" />
    </button>
  );
}

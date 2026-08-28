"use client";
import { SidebarTrigger } from "@/components/ui/sidebar";

/** Mobile only — desktop's collapsed rail now expands via its own logo
 *  (see SidebarLogoTrigger), so a second floating trigger here would just
 *  duplicate that affordance. */
export function SidebarTriggerButton({ className = "" }: { className?: string }) {
  return <SidebarTrigger className={`flex md:hidden ${className}`} />;
}

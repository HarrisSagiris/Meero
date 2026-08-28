"use client";

import { useTransition } from "react";
import { setConversionAgentEnabled } from "@/modules/projects/actions/project-actions";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Owner-only. Off by default (00042_conversion_agent.sql) — a binary
 * toggle, simpler than AutonomyModeToggle's Solo/Manual dropdown since
 * there are only two states here. Gates ONLY the orchestrator's background
 * detection/experiment loop; the required behavior tracker every generated
 * app ships always records regardless of this flag.
 */
export function ConversionAgentToggle({
  projectId,
  enabled,
}: {
  projectId: string;
  enabled: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function choose(value: "on" | "off") {
    const next = value === "on";
    if (next === enabled) return;
    startTransition(() => setConversionAgentEnabled(projectId, next));
  }

  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[13px] font-medium text-secondary-foreground">
        Autonomous optimization
      </span>
      <Tabs value={enabled ? "on" : "off"} onValueChange={(v) => choose(v as "on" | "off")}>
        <TabsList aria-label="Autonomous conversion optimization">
          <TabsTrigger value="off">Off</TabsTrigger>
          <TabsTrigger value="on">{pending ? "…" : "On"}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

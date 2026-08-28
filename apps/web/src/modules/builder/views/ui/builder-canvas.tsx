"use client";

import { useEffect, useRef } from "react";
import { useBuilderView } from "@/modules/builder/providers/builder-view-context";
import { CodeView } from "@/modules/builder/views/ui/code-view";
import {
  ConnectionsPanel,
  type ConnectionsInfo,
} from "@/modules/builder/views/ui/connections-panel";
import { ConversionPanel } from "@/modules/builder/views/ui/conversion-panel";
import { PreviewPane } from "@/modules/builder/views/ui/preview-pane";
import { StatsPanel } from "@/modules/builder/views/ui/stats-panel";
import { VersionHistoryPanel } from "@/modules/builder/views/ui/version-history-panel";
import type {
  Build,
  BuildFile,
  ConversionExperiment,
  ConversionHypothesis,
  ConversionResult,
  Plan,
} from "@/lib/types";

type ConversionExperimentWithResults = ConversionExperiment & {
  conversion_results: ConversionResult[];
};

/**
 * Right-hand builder canvas — just the selected view's content. The tab
 * switcher itself lives in BuilderTopBar (a sibling, sharing state via
 * BuilderViewProvider) as one unified top bar. Content fades in on every
 * tab switch (keyed by `tab`, so React remounts + replays the entrance
 * animation) instead of swapping instantly.
 */
export function BuilderCanvas({
  builds,
  files,
  plan,
  supabaseLinked,
  connections,
  autonomyMode = "solo",
  conversionAgentEnabled = false,
  conversionHypotheses = [],
  conversionExperiments = [],
}: {
  builds: Build[];
  files: BuildFile[];
  plan: Plan;
  supabaseLinked: boolean;
  connections: ConnectionsInfo;
  /** Manual mode (00028_autonomy_mode.sql) — see PreviewPane. */
  autonomyMode?: "solo" | "manual";
  /** Off by default (00042_conversion_agent.sql) — see ConversionPanel. */
  conversionAgentEnabled?: boolean;
  conversionHypotheses?: ConversionHypothesis[];
  conversionExperiments?: ConversionExperimentWithResults[];
}) {
  const { tab, setTab } = useBuilderView();
  const latest = builds[0];
  const generating = latest?.status === "queued" || latest?.status === "running";

  // Builds now start from the chat (after Meero and the user agree on the
  // plan), so a generation often begins after mount. When it does, jump to
  // the Code tab so the user watches the source stream in — the rising edge
  // only, so it never fights a manual tab switch afterward.
  const wasGenerating = useRef(generating);
  useEffect(() => {
    if (generating && !wasGenerating.current) setTab("code");
    wasGenerating.current = generating;
  }, [generating, setTab]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden lg:rounded-2xl lg:border lg:border-border lg:shadow-primary/10">
      <div key={tab} className="animate-fade-in min-h-0 min-w-0 flex-1">
        {tab === "preview" ? (
          <PreviewPane
            builds={builds}
            plan={plan}
            supabaseLinked={supabaseLinked}
            projectId={connections.projectId}
            autonomyMode={autonomyMode}
          />
        ) : tab === "code" ? (
          <CodeView files={files} generating={generating} />
        ) : tab === "history" ? (
          <VersionHistoryPanel projectId={connections.projectId} builds={builds} />
        ) : tab === "connections" ? (
          <ConnectionsPanel info={connections} />
        ) : tab === "stats" ? (
          <StatsPanel projectId={connections.projectId} supabaseLinked={supabaseLinked} />
        ) : (
          <ConversionPanel
            projectId={connections.projectId}
            isOwner={connections.isOwner}
            supabaseLinked={supabaseLinked}
            conversionAgentEnabled={conversionAgentEnabled}
            autonomyMode={autonomyMode}
            hypotheses={conversionHypotheses}
            experiments={conversionExperiments}
          />
        )}
      </div>
    </div>
  );
}

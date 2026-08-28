import { RebuildButton } from "@/modules/builder/views/ui/rebuild-button";
import { RestoreBuildButton } from "@/modules/builder/views/ui/restore-build-button";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { formatStamp, timeAgo } from "@/lib/time";
import type { Build } from "@/lib/types";

/**
 * Real version control for the generated code — every succeeded build
 * already stores its own complete source (build_files), so this is a true
 * history of what actually got built, not a synthetic log. Restoring an
 * earlier version re-runs the real pipeline (schema re-apply, a real
 * `next build`, a real commit to main) against that version's exact
 * stored files — see POST /builds/{id}/restore. Nothing here is ever
 * deleted or mutated: rolling back is itself a new, real, forward build.
 */
export function VersionHistoryPanel({ projectId, builds }: { projectId: string; builds: Build[] }) {
  const currentId = builds.find((b) => b.status === "succeeded")?.id ?? null;

  if (builds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="max-w-[280px] text-center text-[13px] text-muted-foreground">
          No builds yet — once you build this app, every version will show up here and you can roll
          back to any of them.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <ol className="flex flex-col gap-2">
        {builds.map((build) => (
          <li key={build.id}>
            <VersionRow build={build} isCurrent={build.id === currentId} projectId={projectId} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function kindLabel(build: Build): string {
  if (build.restored_from) return "Restored version";
  if (build.retry_of && build.is_runtime_fix) return "Runtime fix";
  if (build.retry_of) return "Auto-fix";
  return "Build";
}

const STATUS_STYLES: Record<
  Build["status"],
  { tone: "live" | "neutral" | "accent"; label: string }
> = {
  succeeded: { tone: "live", label: "Built" },
  failed: { tone: "accent", label: "Failed" },
  canceled: { tone: "neutral", label: "Canceled" },
  running: { tone: "accent", label: "Building…" },
  queued: { tone: "neutral", label: "Queued" },
};

function VersionRow({
  build,
  isCurrent,
  projectId,
}: {
  build: Build;
  isCurrent: boolean;
  projectId: string;
}) {
  const status = STATUS_STYLES[build.status];
  const canRestore = build.status === "succeeded" && !isCurrent;
  const stamp = build.finished_at ?? build.queued_at;

  return (
    <div
      className={`flex items-start justify-between gap-3 rounded-xl border p-3 ${
        isCurrent ? "border-foreground/15 bg-muted/60" : "border-border bg-white"
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[13px] font-medium text-foreground">{kindLabel(build)}</span>
          {isCurrent && <Badge variant="default">Current</Badge>}
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <StatusDot tone={status.tone} />
            {status.label}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground" title={formatStamp(stamp)}>
          {timeAgo(stamp)}
        </p>
        {build.error && build.status === "failed" && (
          <p className="mt-1 line-clamp-2 text-[11.5px] text-red-600">{build.error}</p>
        )}
      </div>

      {canRestore && <RestoreBuildButton buildId={build.id} />}
      {isCurrent && build.status === "succeeded" && <RebuildButton projectId={projectId} />}
    </div>
  );
}

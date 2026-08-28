import { Progress } from "@/components/ui/progress";
import { formatTokens } from "@/lib/format";

export function UsageBar({
  remaining,
  limit,
  size = "sm",
}: {
  remaining: number;
  limit: number;
  size?: "sm" | "lg";
}) {
  const used = Math.max(0, limit - remaining);
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <div>
      <div className={`flex items-center justify-between ${size === "lg" ? "mb-2" : "mb-1"}`}>
        <span
          className={`font-medium text-secondary-foreground ${size === "lg" ? "text-[13px]" : "text-[11px]"}`}
        >
          Tokens left
        </span>
        <span
          className={`font-semibold text-foreground ${size === "lg" ? "text-[13px]" : "text-[11px]"}`}
        >
          {formatTokens(remaining)}/{formatTokens(limit)}
        </span>
      </div>
      <Progress value={remaining} />
    </div>
  );
}

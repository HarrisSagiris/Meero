const TONES = {
  live: "bg-emerald-500",
  neutral: "bg-muted-foreground",
  accent: "bg-primary",
} as const;

export function StatusDot({
  tone = "neutral",
  className = "",
}: {
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block size-1.5 rounded-full ${TONES[tone]} ${className}`}
    />
  );
}

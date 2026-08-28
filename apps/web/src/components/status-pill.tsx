/**
 * Real, live status pulled server-side from Meero's own OpenStatus page
 * (https://meero.openstatus.dev) — a genuine external status page, not a
 * simulated indicator. Uses OpenStatus's public StatusPage-compatible JSON
 * endpoint (status.indicator: "none" | "minor" | "major" | "critical"),
 * cached for 60s (real ISR, not a one-time build-time snapshot) so every
 * page load doesn't hit OpenStatus directly. On any fetch failure this
 * reports "Status unavailable" with a neutral dot — it never falls back to
 * a fabricated "operational," since a real outage is exactly the moment
 * this fetch might also be failing.
 */

const STATUS_URL = "https://meero.openstatus.dev";
const STATUS_API_URL = "https://meero.openstatus.dev/api/status/current.json";

type OpenStatusIndicator = "none" | "minor" | "major" | "critical";

type OpenStatusResponse = {
  status?: {
    indicator?: OpenStatusIndicator;
    description?: string;
  };
};

const DOT_CLASS: Record<OpenStatusIndicator, string> = {
  none: "bg-emerald-500",
  minor: "bg-amber-500",
  major: "bg-red-500",
  critical: "bg-red-500",
};

async function fetchStatus(): Promise<OpenStatusResponse["status"] | null> {
  try {
    const res = await fetch(STATUS_API_URL, {
      // Real revalidation window, not an indefinite cache — a genuine
      // outage should show up here within a minute, not persist stale.
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as OpenStatusResponse;
    return body.status ?? null;
  } catch {
    return null;
  }
}

export async function StatusPill() {
  const status = await fetchStatus();
  const indicator = status?.indicator;
  const dotClass = indicator ? DOT_CLASS[indicator] : "bg-input";
  const label = status?.description ?? "Status unavailable";
  const live = indicator === "none";

  return (
    <a
      href={STATUS_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Meero status"
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[12px] font-medium text-secondary-foreground transition hover:border-foreground hover:text-foreground"
    >
      <span className="relative flex size-1.5">
        {live && (
          <span
            className={`motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotClass}`}
            aria-hidden
          />
        )}
        <span className={`relative inline-flex size-1.5 rounded-full ${dotClass}`} aria-hidden />
      </span>
      {label}
    </a>
  );
}

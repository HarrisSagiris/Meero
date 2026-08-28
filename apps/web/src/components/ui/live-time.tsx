"use client";

import { useEffect, useState } from "react";
import { formatStamp, timeAgo, timeUntil } from "@/lib/time";

type Kind = "stamp" | "ago" | "until";

const FORMATTERS: Record<Kind, (iso: string) => string> = {
  stamp: formatStamp,
  ago: timeAgo,
  until: timeUntil,
};

/**
 * Renders a timezone- or "now"-relative time string, but only computes it
 * AFTER mount. The server and the client's first render would otherwise
 * produce genuinely different text for the same instant — `formatStamp`
 * uses the runtime's local timezone (server vs. browser differ), and
 * `timeAgo`/`timeUntil` are relative to `Date.now()` (server-render time vs.
 * client-hydrate time always differ by at least a few seconds) — which is
 * exactly what triggers a React hydration mismatch (error #418). Renders
 * nothing until the post-mount effect fills it in (one frame later, never
 * visible), then keeps updating on an interval so the text stays accurate.
 */
export function LiveTime({
  iso,
  kind,
  intervalMs = 60_000,
  className,
}: {
  iso: string;
  kind: Kind;
  intervalMs?: number;
  className?: string;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const format = FORMATTERS[kind];
    // Computing this after mount (not in a lazy initializer) is the whole
    // point — the value depends on the CLIENT's clock/timezone, which can't
    // exist at SSR time without mismatching what the server rendered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(format(iso));
    const id = setInterval(() => setText(format(iso)), intervalMs);
    return () => clearInterval(id);
  }, [iso, kind, intervalMs]);

  if (text === null) return null;
  return <span className={className}>{text}</span>;
}

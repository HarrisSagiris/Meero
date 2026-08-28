"use client";

import { useEffect, useState } from "react";
import { GithubIcon, NotionIcon, SlackIcon } from "@/components/icons";

const PROVIDERS = [
  { label: "GitHub", Icon: GithubIcon },
  { label: "Slack", Icon: SlackIcon },
  { label: "Notion", Icon: NotionIcon },
] as const;

const INTERVAL_MS = 1700;

/**
 * "on GitHub." / "on Slack." / "on Notion." — the trailing phrase and its
 * logo cycle together on ONE shared interval (real accurate brand marks,
 * see icons.tsx). GitHub is the one real integration today; Slack and
 * Notion are the honest "what's next," not something claimed as working.
 * Both the text and the icon are stacked (grid/absolute, same box) rather
 * than swapped, so the phrase never reflows the heading as it cycles.
 */
export function ProviderShowcase({
  size = 40,
  textClassName = "",
  iconClassName = "",
}: {
  size?: number;
  textClassName?: string;
  iconClassName?: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % PROVIDERS.length);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-3">
      <span className="relative inline-grid">
        {PROVIDERS.map((p, i) => (
          <span
            key={p.label}
            aria-hidden={i !== index}
            className={`meero-text-gradient col-start-1 row-start-1 whitespace-nowrap transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${textClassName} ${
              i === index ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
            }`}
          >
            on {p.label}.
          </span>
        ))}
      </span>
      <span
        className={`relative inline-block shrink-0 ${iconClassName}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        {PROVIDERS.map(({ label, Icon }, i) => (
          <Icon
            key={label}
            size={size}
            className={`absolute inset-0 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
              i === index ? "scale-100 opacity-100" : "scale-75 opacity-0"
            }`}
          />
        ))}
      </span>
    </span>
  );
}

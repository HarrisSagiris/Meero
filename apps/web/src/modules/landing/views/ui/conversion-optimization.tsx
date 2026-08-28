"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { CursorClickIcon, FlaskIcon, TrendingUpIcon } from "@/components/icons";
import { WindowChrome } from "@/modules/landing/views/ui/how-it-works";
import { ScrollReveal } from "@/components/scroll-reveal";
import ShinyText from "@/components/ui/shiny-text";

type GrowthState = "issue" | "testing" | "applied";
const STATES: GrowthState[] = ["issue", "testing", "applied"];

/** The hero's third promise, shown live — "improving after launch" — the
 *  real conversion agent (orchestrator/app/conversion_agent.py): a genuine
 *  issue detected from the required behavior tracker's real events (dead
 *  clicks, rage clicks, form abandonment — real issue_type values, not
 *  invented ones), a real A/B experiment launched to test a fix, and the
 *  winner applied automatically once it's actually decided. Same 3-state
 *  cycling pattern as autonomous-monitoring.tsx's MonitorPreview, on
 *  purpose — this is the section that completes that one's story. */
function GrowthPreview() {
  const reduceMotion = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setI((n) => (n + 1) % STATES.length), 2500);
    return () => clearInterval(id);
  }, [reduceMotion]);

  const state = STATES[i];

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
      {state === "issue" && (
        <div className="animate-pop flex flex-col items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-700">
            <CursorClickIcon size={12} />
            Rage clicks on &quot;Sign up&quot;
          </span>
          <div className="w-full max-w-[180px] space-y-1.5">
            {["w-4/5", "w-3/5", "w-2/5"].map((w, idx) => (
              <div
                key={idx}
                style={{ animationDelay: `${idx * 150}ms` }}
                className={`animate-code-shimmer h-2 rounded-full bg-amber-200/70 ${w}`}
              />
            ))}
          </div>
        </div>
      )}

      {state === "testing" && (
        <div className="animate-pop flex flex-col items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <FlaskIcon size={18} />
          </span>
          <ShinyText
            text="Running a real A/B test…"
            speed={1.6}
            color="#8a8a8a"
            shineColor="#0a0a0a"
            className="text-[13px] font-medium"
          />
        </div>
      )}

      {state === "applied" && (
        <div className="animate-pop flex flex-col items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-emerald-500 text-white">
            <svg
              width="14"
              height="14"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m4 10.5 4 4 8-9" />
            </svg>
          </span>
          <span className="text-[13px] font-medium text-emerald-700">
            Winner applied automatically
          </span>
        </div>
      )}
    </div>
  );
}

export function ConversionOptimization() {
  return (
    <section className="mx-auto max-w-5xl px-2 pt-8 pb-28">
      <ScrollReveal className="grid grid-cols-1 items-center gap-10 sm:grid-cols-2">
        <div className="text-center sm:order-2 sm:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[12px] font-semibold text-primary">
            <TrendingUpIcon size={13} />
            Autonomous optimization
          </span>
          <h2 className="mt-4 font-sans text-[32px] font-semibold tracking-[-0.02em] text-foreground sm:text-[42px]">
            It gets better the longer it runs
            <span className="text-primary">.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-secondary-foreground sm:mx-0">
            Meero watches how real visitors actually use your app — where they click, where they
            drop off — finds the friction, and tests a real fix with a genuine A/B experiment before
            applying it.
          </p>
        </div>

        <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-primary/10 sm:order-1">
          <WindowChrome label="Improvements" />
          <GrowthPreview />
        </div>
      </ScrollReveal>
    </section>
  );
}

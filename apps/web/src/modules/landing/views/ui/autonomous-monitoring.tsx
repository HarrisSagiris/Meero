"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ShieldIcon } from "@/components/icons";
import { WindowChrome } from "@/modules/landing/views/ui/how-it-works";
import { ScrollReveal } from "@/components/scroll-reveal";
import ShinyText from "@/components/ui/shiny-text";

type MonitorState = "error" | "fixing" | "verified";
const STATES: MonitorState[] = ["error", "fixing", "verified"];

/** The headline differentiator, shown live: a real production error, Meero
 *  fixing it with no human click, then a genuine pass/verify state — not
 *  just claimed in copy, the animation itself teaches the verify-then-trust
 *  story (see orchestrator/app/runtime_monitor.py for the real mechanism
 *  this is illustrating). */
function MonitorPreview() {
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
      {state === "error" && (
        <div className="animate-pop flex flex-col items-center gap-3">
          <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-600">
            <span className="motion-safe:animate-pulse size-1.5 rounded-full bg-red-500" />
            Error detected
          </span>
          <div className="w-full max-w-[180px] space-y-1.5">
            {["w-4/5", "w-3/5", "w-2/5"].map((w, idx) => (
              <div
                key={idx}
                style={{ animationDelay: `${idx * 150}ms` }}
                className={`animate-code-shimmer h-2 rounded-full bg-red-200/70 ${w}`}
              />
            ))}
          </div>
        </div>
      )}

      {state === "fixing" && (
        <div className="animate-pop flex flex-col items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldIcon size={18} />
          </span>
          <ShinyText
            text="Fixing automatically…"
            speed={1.6}
            color="#8a8a8a"
            shineColor="#0a0a0a"
            className="text-[13px] font-medium"
          />
        </div>
      )}

      {state === "verified" && (
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
          <span className="text-[13px] font-medium text-emerald-700">Verified &amp; resolved</span>
        </div>
      )}
    </div>
  );
}

export function AutonomousMonitoring() {
  return (
    <section className="mx-auto max-w-5xl px-2 pt-8 pb-28">
      <ScrollReveal className="grid grid-cols-1 items-center gap-10 sm:grid-cols-2">
        <div className="text-center sm:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[12px] font-semibold text-primary">
            <ShieldIcon size={13} />
            24/7 monitoring
          </span>
          <h2 className="mt-4 font-sans text-[32px] font-semibold tracking-[-0.02em] text-foreground sm:text-[42px]">
            Meero doesn&apos;t stop watching after it ships
            <span className="text-primary">.</span>
          </h2>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-secondary-foreground sm:mx-0">
            24/7, Meero watches your live app for real production errors and fixes them
            automatically — verified before it calls the job done.
          </p>
        </div>

        <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-primary/10">
          <WindowChrome label="yourapp.meero.im" />
          <MonitorPreview />
        </div>
      </ScrollReveal>
    </section>
  );
}

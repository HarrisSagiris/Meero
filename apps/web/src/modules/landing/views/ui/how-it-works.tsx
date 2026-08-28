"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { ArrowUpIcon, CodeIcon, LockIcon, SupabaseIcon, VercelIcon } from "@/components/icons";
import { ScrollReveal } from "@/components/scroll-reveal";

const IDEAS = ["A CRM to track deals…", "A team chat app…", "An event RSVP tracker…"];

/** Three mac-style dots + an optional centered label — the shared chrome
 *  every step's mock window opens with, echoing a real browser/app frame
 *  rather than a generic icon-in-a-circle. Exported for reuse by other
 *  landing sections that want the same mock-browser-chrome treatment (see
 *  autonomous-monitoring.tsx). */
export function WindowChrome({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-border bg-muted px-3 py-2.5">
      <span className="size-2 rounded-full bg-input" />
      <span className="size-2 rounded-full bg-input" />
      <span className="size-2 rounded-full bg-input" />
      {label && (
        <span className="ml-1.5 truncate text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  );
}

/** Step 1 — a live replica of the hero composer, cycling through a few
 *  example ideas with a blinking caret, so the card shows the ACTUAL
 *  flow instead of an illustrative stand-in. */
function DescribePreview() {
  const reduceMotion = useReducedMotion();
  const [i, setI] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const id = setInterval(() => setI((n) => (n + 1) % IDEAS.length), 2200);
    return () => clearInterval(id);
  }, [reduceMotion]);

  return (
    <div className="flex flex-1 flex-col justify-center px-5 py-8">
      <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-white px-4 py-3 shadow-primary/10">
        <span className="min-w-0 flex-1 truncate text-left text-[13px] text-secondary-foreground">
          <AnimatePresence mode="wait">
            <motion.span
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35 }}
              className="inline-flex items-center"
            >
              {IDEAS[i]}
              <span className="animate-blink ml-0.5 inline-block h-[13px] w-px bg-secondary-foreground" />
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <ArrowUpIcon size={12} />
        </span>
      </div>
    </div>
  );
}

/** Step 2 — a skeleton code block "typing" itself out, then a small
 *  connection diagram (Next.js → Supabase) with a pulse traveling the
 *  line, standing in for the real schema-apply step. */
function BuildPreview() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6 px-5 py-7">
      <div className="space-y-1.5">
        {[
          { w: "w-2/5", tone: "bg-primary/35" },
          { w: "w-4/5", tone: "bg-input" },
          { w: "w-3/5", tone: "bg-input" },
          { w: "w-1/2", tone: "bg-input" },
        ].map((line, idx) => (
          <div
            key={idx}
            style={{ animationDelay: `${idx * 180}ms` }}
            className={`animate-code-shimmer h-2 rounded-full ${line.w} ${line.tone}`}
          />
        ))}
      </div>

      <div className="flex items-center justify-center gap-3">
        <div className="flex flex-col items-center gap-1.5">
          <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-muted text-secondary-foreground">
            <CodeIcon size={15} />
          </span>
          <span className="text-[10px] font-medium text-muted-foreground">Next.js</span>
        </div>

        <div className="relative h-px w-12 bg-input">
          <motion.span
            aria-hidden
            className="absolute top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary motion-reduce:hidden"
            animate={{ left: ["0%", "92%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-muted text-secondary-foreground">
            <SupabaseIcon size={15} />
          </span>
          <span className="text-[10px] font-medium text-muted-foreground">Supabase</span>
        </div>
      </div>
    </div>
  );
}

/** Step 3 — a real browser-chrome frame with a live URL bar and a
 *  pulsing "Live" state, plus the Vercel release it actually ships on. */
function ShipPreview() {
  return (
    <div className="flex flex-1 flex-col justify-center gap-5 px-5 py-7">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
        <LockIcon size={11} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[11.5px] text-secondary-foreground">yourapp.meero.im</span>
      </div>

      <div className="flex items-center justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-secondary-foreground shadow-primary/10">
          <span className="relative flex size-2">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
      </div>

      <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
        <VercelIcon size={10} />
        Deployed on Vercel
      </div>
    </div>
  );
}

const STEPS = [
  {
    title: "Describe it",
    body: "Tell Meero what you want to build, in plain English — no spec, no boilerplate.",
    chrome: "meero.im",
    Preview: DescribePreview,
  },
  {
    title: "Meero builds it",
    body: "A real Next.js app and Postgres schema, generated and applied to your own Supabase.",
    chrome: "Building…",
    Preview: BuildPreview,
  },
  {
    title: "Ship it",
    body: "Preview instantly, then go live with a real one-click release on Pro and Ultra.",
    chrome: "Preview",
    Preview: ShipPreview,
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-5xl px-2 pt-28 pb-8">
      <h2 className="text-center font-sans text-[32px] font-semibold tracking-[-0.02em] text-foreground sm:text-[42px]">
        From idea to live app
        <span className="text-primary">.</span>
      </h2>
      <p className="mx-auto mt-3 max-w-md text-center text-[15px] leading-relaxed text-secondary-foreground">
        No boilerplate, no config — just describe what you want.
      </p>

      <div className="mt-14 grid grid-cols-1 gap-6 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <ScrollReveal
            key={step.title}
            delay={i * 140}
            className="flex flex-col items-center text-center"
          >
            <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-primary/10">
              <WindowChrome label={step.chrome} />
              <step.Preview />
            </div>
            <h3 className="mt-4 text-[15px] font-semibold text-foreground">{step.title}</h3>
            <p className="mt-1.5 max-w-[240px] text-[13.5px] leading-relaxed text-secondary-foreground">
              {step.body}
            </p>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}

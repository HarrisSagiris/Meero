"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setAutonomyMode } from "@/modules/projects/actions/project-actions";
import { ChevronDownIcon, ShieldIcon, SparkleIcon } from "@/components/icons";

const OPTIONS = [
  {
    value: "solo" as const,
    label: "Solo",
    hint: "Meero builds, fixes, and iterates on its own the moment the app is ready — no action needed from you.",
  },
  {
    value: "manual" as const,
    label: "Manual",
    hint: "Meero asks first — a real build or AI fix only starts once you hit Approve. Deploys and Supabase/GitHub actions are always explicit either way.",
  },
];

/** Owner-only. Solo mode (default) is today's existing behavior; Manual
 *  mode makes the chat agent wait for a real approval click before it
 *  starts a build or an AI fix — see 00028_autonomy_mode.sql. */
export function AutonomyModeToggle({
  projectId,
  mode,
}: {
  projectId: string;
  mode: "solo" | "manual";
}) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(value: "solo" | "manual") {
    setOpen(false);
    if (value === mode) return;
    startTransition(() => setAutonomyMode(projectId, value));
  }

  const isManual = mode === "manual";
  const Icon = isManual ? ShieldIcon : SparkleIcon;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={isManual ? "Manual — Meero asks before building" : "Solo — Meero builds on its own"}
        className={`flex h-8 items-center gap-1.5 rounded-full border bg-white px-2.5 text-[13px] font-medium transition disabled:opacity-50 ${
          open
            ? "border-foreground text-foreground"
            : "border-border text-secondary-foreground hover:border-foreground hover:text-foreground"
        }`}
      >
        <Icon size={14} className={isManual ? "text-primary" : "text-secondary-foreground"} />
        {pending ? "…" : isManual ? "Manual" : "Solo"}
        <ChevronDownIcon
          size={12}
          className={`text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Autonomy mode"
          // Opens upward — this control lives in the composer at the
          // bottom of the screen, so a downward dropdown would run off
          // the viewport.
          className="animate-pop absolute bottom-full left-0 z-40 mb-2 w-72 rounded-xl border border-border bg-white p-1.5 shadow-composer"
        >
          {OPTIONS.map((option) => {
            const isSelected = option.value === mode;
            const OptIcon = option.value === "manual" ? ShieldIcon : SparkleIcon;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => choose(option.value)}
                  className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${
                    isSelected ? "bg-muted" : "hover:bg-muted"
                  }`}
                >
                  <OptIcon
                    size={16}
                    className={`mt-0.5 shrink-0 ${option.value === "manual" ? "text-primary" : "text-secondary-foreground"}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-foreground">
                        {option.label}
                      </span>
                      {isSelected && (
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-emerald-600"
                          aria-hidden
                        >
                          <path d="m4 10.5 4 4 8-9" />
                        </svg>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                      {option.hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

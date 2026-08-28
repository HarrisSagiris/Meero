"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/icons";

/**
 * The "Watching" badge in the builder top bar, with a dropdown explaining
 * what is actually running — it used to be a bare `title` tooltip, which
 * couldn't say enough (and never appears at all on touch devices).
 *
 * Every claim here is real behavior, not marketing: the generated app's
 * required error reporter (components/meero-error-reporter.tsx) writes
 * production errors into a `_meero_runtime_errors` table on the owner's own
 * Supabase, and the orchestrator's background monitor (app/runtime_monitor.py)
 * reads them back on a real interval. The two modes genuinely differ —
 * Manual detects but never auto-fires a fix (00028_autonomy_mode.sql) — so
 * the copy branches rather than describing one behavior for both.
 */
export function MonitoringBadge({ autonomyMode }: { autonomyMode: "solo" | "manual" }) {
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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex h-8 items-center gap-1.5 rounded-full border bg-white px-2.5 text-[12px] font-medium transition ${
          open
            ? "border-foreground text-foreground"
            : "border-border text-secondary-foreground hover:border-foreground hover:text-foreground"
        }`}
      >
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Watching
        <ChevronDownIcon
          size={12}
          className={`text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="What Meero is watching"
          className="animate-pop absolute top-full right-0 z-40 mt-2 w-72 rounded-2xl border border-border bg-white p-3.5 text-left shadow-composer"
        >
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            Watching your live app
          </p>

          <p className="mt-2 text-[12px] leading-relaxed text-secondary-foreground">
            Your app reports real errors from real visitors straight into your own Supabase. Meero
            checks for new ones every 45 seconds — around the clock, whether or not this page is
            open.
          </p>

          {autonomyMode === "solo" ? (
            <p className="mt-2 text-[12px] leading-relaxed text-secondary-foreground">
              When something breaks, Meero writes a fix and rebuilds your app on its own. It only
              counts the error as resolved if the new build genuinely passes its own checks — never
              just because it tried. Capped at 3 automatic fixes an hour.
            </p>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-secondary-foreground">
              You&apos;re in Manual mode, so Meero will flag what it finds but won&apos;t change
              anything until you ask it to. Switch to Solo mode if you&apos;d rather it fix things
              on its own.
            </p>
          )}

          <p className="mt-2.5 border-t border-border pt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Anything it catches shows up in the chat panel, with the real error and a one-click fix.
          </p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real error in the console/monitoring — never swallow it.
    console.error(error);
  }, [error]);

  return (
    <main className="meero-gradient-soft flex min-h-screen flex-col items-center justify-center px-6">
      <div className="rounded-2xl border border-border bg-white/95 px-10 py-12 text-center shadow-composer backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-secondary-foreground">
          An unexpected error occurred{error.digest ? ` (ref ${error.digest})` : ""}. Your data is
          safe.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-xl bg-foreground px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-neutral-800"
        >
          Try again
        </button>
      </div>
    </main>
  );
}

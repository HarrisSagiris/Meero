import { MeeroWordmark } from "@/components/logo";

/**
 * Split-screen auth layout: form on the left, gradient showcase panel on
 * the right (hidden on small screens).
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen bg-background">
      <div className="flex w-full flex-col justify-center px-8 py-12 sm:px-16 lg:w-[46%] lg:px-24">
        <div className="mx-auto w-full max-w-md">
          <MeeroWordmark height={36} />
          <div className="mt-10">{children}</div>
        </div>
      </div>

      <div className="hidden p-4 lg:flex lg:w-[54%]">
        <div className="meero-gradient-soft relative flex w-full items-center justify-center overflow-hidden rounded-2xl">
          <div className="flex w-full max-w-lg items-center gap-3 rounded-2xl bg-white/90 px-6 py-5 shadow-composer backdrop-blur-md">
            <p className="flex-1 text-[15px] font-medium text-foreground">
              Meero watches your product 24/7 and finds ways to make it better.
            </p>
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-primary/10"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
              </svg>
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}

import { PromptComposer } from "@/modules/projects/views/ui/prompt-composer";
import { ScrollHint } from "@/modules/projects/views/ui/scroll-hint";
import type { Plan } from "@/lib/types";

/**
 * The logged-in home hero — the app-building composer. Heading uses the
 * base sans (bold), same display treatment as the landing page and auth
 * headings. (The Superagent mode toggle that used to live here is pulled
 * from the frontend for now; its real backend/orchestrator support is
 * untouched, and superagent-panel / connection-icon-cycle are left in
 * place to reinstate later.)
 */
export function HomeHero({
  displayName,
  plan,
  creditsRemaining,
  bonusCredits,
}: {
  displayName: string;
  plan: Plan;
  creditsRemaining: number;
  bonusCredits: number;
}) {
  return (
    <section
      id="top"
      className="flex min-h-[68svh] flex-col items-center justify-center px-2 py-14"
    >
      <div className="flex w-full flex-col items-center">
        <h1 className="animate-rise text-center font-semibold text-[clamp(30px,5.2vw,45px)] leading-[1.15] tracking-[-0.02em] text-foreground">
          <span className="block">
            Hi <span className="text-foreground/60">{displayName}</span>, Build once
            <span className="text-primary">.</span>
          </span>
          <span className="block">
            Meero keeps improving it<span className="text-primary">.</span>
          </span>
        </h1>
        <div className="animate-rise mt-10 w-full max-w-3xl">
          <PromptComposer
            plan={plan}
            creditsRemaining={creditsRemaining}
            bonusCredits={bonusCredits}
          />
        </div>
      </div>
    </section>
  );
}

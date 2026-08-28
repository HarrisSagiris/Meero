import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/modules/marketing/views/ui/marketing-nav";
import { PLAN_CARDS, PLAN_LABEL } from "@/modules/billing/utils/plans";
import { PLAN_CREDIT_LIMITS } from "@/lib/types";
import { formatTokens } from "@/lib/format";
import { CheckIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Meero pricing — a free plan with a real weekly token budget, plus Pro and Ultra for one-click Vercel production releases and private projects.",
};

/** Plan data comes from the SAME PLAN_CARDS/PLAN_CREDIT_LIMITS the billing
 *  settings tab and onboarding wizard read, so this page can never quote a
 *  price or token budget that disagrees with what a user is actually
 *  charged or granted. */
export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-16 sm:px-8">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="font-serif text-[clamp(36px,5.5vw,52px)] leading-[1.05] tracking-[-0.01em] text-foreground">
            Simple, honest pricing
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-secondary-foreground">
            Every plan builds the same thing: a real, secure, full-stack Next.js app running on your
            own Supabase project. Plans differ in how much you can build each week, and whether you
            can ship to production in one click.
          </p>
        </header>

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {PLAN_CARDS.map((card) => {
            const featured = card.plan === "pro";
            return (
              <div
                key={card.plan}
                className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
                  featured ? "border-primary shadow-composer" : "border-border shadow-primary/10"
                }`}
              >
                {featured && (
                  <span className="absolute -top-3 left-6 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white">
                    MOST POPULAR
                  </span>
                )}

                <h2 className="text-[15px] font-semibold text-foreground">
                  {PLAN_LABEL[card.plan]}
                </h2>
                <p className="mt-1 text-[13px] text-muted-foreground">{card.tagline}</p>

                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-[38px] leading-none font-semibold tracking-tight text-foreground">
                    {card.price}
                  </span>
                  <span className="text-[13px] text-muted-foreground">{card.period}</span>
                </div>

                <ul className="mt-6 space-y-2.5">
                  <li className="flex items-start gap-2 text-[13.5px] text-foreground">
                    <CheckIcon size={15} className="mt-0.5 shrink-0 text-primary" />
                    <span>{formatTokens(PLAN_CREDIT_LIMITS[card.plan])} tokens per week</span>
                  </li>
                  <li className="flex items-start gap-2 text-[13.5px] text-foreground">
                    <CheckIcon size={15} className="mt-0.5 shrink-0 text-primary" />
                    <span>{card.model}</span>
                  </li>
                  {card.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-[13.5px] text-foreground"
                    >
                      <CheckIcon size={15} className="mt-0.5 shrink-0 text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/signup"
                  className={`mt-7 rounded-full px-4 py-2.5 text-center text-[13.5px] font-medium transition ${
                    featured
                      ? "bg-primary text-white hover:bg-primary/85"
                      : "border border-border text-foreground hover:bg-muted"
                  }`}
                >
                  {card.plan === "free" ? "Start free" : `Get ${PLAN_LABEL[card.plan]}`}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] leading-relaxed text-muted-foreground">
          Token budgets refresh every Sunday at 00:00 UTC. Need more before the reset? A one-time
          top-up is available from the Billing tab in your account settings — it adds bonus tokens
          that never expire.
        </p>

        <section className="mt-20">
          <h2 className="text-center text-[22px] font-semibold tracking-tight text-foreground">
            What every plan includes
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                title: "Your own Supabase",
                body: "Every app's backend is a Supabase project on your account — real Postgres tables with row-level security, and real end-user auth. Your data never lives on our servers.",
              },
              {
                title: "Secure by construction",
                body: "Generated code is mechanically validated before it ever builds: no XSS sinks, no raw network calls, and every table must enable RLS with a real policy.",
              },
              {
                title: "Real production builds",
                body: "Each build runs an actual next build against a pinned toolchain — not a preview simulation. If it compiles here, it compiles anywhere.",
              },
              {
                title: "GitHub, wired up",
                body: "Connect GitHub and Meero creates the repo, then commits every successful build straight to main as a real commit.",
              },
              {
                title: "Self-healing in production",
                body: "Generated apps report real runtime errors back to your own database. Meero surfaces them and can ship a fix through the normal pipeline as a reviewable pull request.",
              },
              {
                title: "Readiness checks",
                body: "After each build, Meero runs genuine signup, login, and data-privacy checks against your live app and reports the results in plain English.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-border bg-white p-5">
                <h3 className="text-[14px] font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-secondary-foreground">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

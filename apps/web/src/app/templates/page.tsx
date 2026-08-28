import type { Metadata } from "next";
import Link from "next/link";
import { MarketingHeader } from "@/modules/marketing/views/ui/marketing-nav";
import { STARTER_IDEAS } from "@/modules/landing/utils/starter-ideas";
import { UseTemplateButton } from "@/modules/marketing/views/ui/use-template-button";

export const metadata: Metadata = {
  title: "Templates",
  description:
    "Detailed starting specs for common app shapes — a team CRM, a feedback board, realtime chat, event RSVPs. Each one is a real prompt Meero builds a full-stack app from.",
};

/** Renders the SAME STARTER_IDEAS the composer drops into the prompt box, so
 *  what's advertised here is literally the spec that gets built — no
 *  separate marketing copy to drift out of sync. Each card links to the
 *  composer with the idea preselected. */
export default function TemplatesPage() {
  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-16 sm:px-8">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="font-serif text-[clamp(36px,5.5vw,52px)] leading-[1.05] tracking-[-0.01em] text-foreground">
            Start from a real spec
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-secondary-foreground">
            These aren&apos;t theme files or boilerplate repos — each one is a detailed
            specification (data model, screens, rules, UI direction) that Meero builds into a
            working full-stack app on your own Supabase. Start from one and change anything.
          </p>
        </header>

        <div className="mt-14 grid gap-5 md:grid-cols-2">
          {STARTER_IDEAS.map((idea) => {
            // The prompt's first line is its headline sentence; the rest is
            // the full spec. Showing the opening lines keeps each card
            // honest about what will actually be built.
            const [headline, ...rest] = idea.prompt.split("\n").filter(Boolean);
            const summary = rest.slice(0, 2).join(" ");

            return (
              <div
                key={idea.label}
                className="flex flex-col rounded-2xl border border-border bg-white p-6 shadow-primary/10"
              >
                <h2 className="text-[16px] font-semibold text-foreground">{idea.label}</h2>
                <p className="mt-2 text-[13.5px] leading-relaxed text-foreground">{headline}</p>
                <p className="mt-3 line-clamp-4 text-[13px] leading-relaxed text-muted-foreground">
                  {summary}
                </p>

                <UseTemplateButton prompt={idea.prompt} />
              </div>
            );
          })}
        </div>

        <section className="mt-20 rounded-2xl border border-border bg-muted/40 p-8 text-center sm:p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-foreground">
            Or just describe your own
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-[13.5px] leading-relaxed text-secondary-foreground">
            Templates are only a convenient starting point. Meero builds from plain description —
            tell it what you want in your own words and it plans the data model, writes the app,
            applies the schema to your database, and runs a real build.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-primary/85"
          >
            Describe your app
          </Link>
        </section>
      </main>
    </div>
  );
}

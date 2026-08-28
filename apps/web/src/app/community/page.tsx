import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MarketingHeader } from "@/modules/marketing/views/ui/marketing-nav";
import { PublicGallery, type PublicProject } from "@/modules/landing/views/ui/public-gallery";

export const metadata: Metadata = {
  title: "Community",
  description:
    "Real apps built with Meero and shared publicly by their creators. Open any one to see what it does — or clone it into your own Supabase project and make it yours.",
};

/** Reads the SAME public marketplace rows the landing gallery and signed-in
 *  dashboard read (projects.is_public, allowed to anon by the public-projects
 *  RLS policy) — this is genuine user work, never seeded or sample data, so
 *  an empty database honestly renders as "nothing shared yet". */
export default async function CommunityPage() {
  const supabase = await createClient();

  const { data: publicProjects } = await supabase
    .from("projects")
    .select("id, name, description, screenshot_url, live_url, display_title")
    .eq("is_public", true)
    .order("updated_at", { ascending: false })
    .limit(48);

  const projects = (publicProjects ?? []) as PublicProject[];

  return (
    <div className="min-h-screen bg-white">
      <MarketingHeader />

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-16 sm:px-8">
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="font-serif text-[clamp(36px,5.5vw,52px)] leading-[1.05] tracking-[-0.01em] text-foreground">
            Built with Meero
          </h1>
          <p className="mt-4 text-[15px] leading-relaxed text-secondary-foreground">
            Real, working apps shared publicly by the people who built them. Every one runs on its
            creator&apos;s own Supabase — open one to see what it does, or clone it into your own
            account and make it yours.
          </p>
        </header>

        <div className="mt-14">
          {projects.length > 0 ? (
            <PublicGallery projects={projects} />
          ) : (
            <div className="rounded-2xl border border-border bg-white p-12 text-center">
              <p className="text-[15px] font-medium text-foreground">Nothing shared yet</p>
              <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
                No one has made a project public yet. Build something and flip it to public —
                it&apos;ll show up right here.
              </p>
              <Link
                href="/signup"
                className="mt-6 inline-block rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-primary/85"
              >
                Build the first one
              </Link>
            </div>
          )}
        </div>

        <section className="mt-20 rounded-2xl border border-border bg-muted/40 p-8 text-center sm:p-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-foreground">
            Cloning is real, not a screenshot
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-[13.5px] leading-relaxed text-secondary-foreground">
            When you clone a community project, Meero copies its generated source and re-points it
            at <em>your</em> Supabase project — applying the schema to your database and running a
            real build. You get an independent, working app you fully own, not a read-only copy of
            someone else&apos;s.
          </p>
          <Link
            href="/signup"
            className="mt-6 inline-block rounded-full bg-primary px-5 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-primary/85"
          >
            Get started free
          </Link>
        </section>
      </main>
    </div>
  );
}

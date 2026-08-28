import { createClient } from "@/lib/supabase/server";
import { HomeHero } from "@/modules/projects/views/ui/home-hero";
import { Landing } from "@/modules/landing/views/ui/landing";
import type { PublicProject } from "@/modules/landing/views/ui/public-gallery";
import { NewsBar } from "@/modules/news/views/ui/news-bar";
import { ScrollReveal } from "@/components/scroll-reveal";
import { StatusPill } from "@/components/status-pill";
import { TopNav } from "@/modules/sidebar/views/ui/top-nav";
import { hoursFromNowIso } from "@/lib/time";
import type { Project } from "@/lib/types";
import { MarketplaceProjects } from "@/modules/marketplace/views/ui/marketplace-projects";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const { data: publicProjects } = await supabase
      .from("projects")
      .select("id, name, description, screenshot_url, live_url, display_title")
      .eq("is_public", true)
      .order("updated_at", { ascending: false })
      .limit(12);

    return <Landing publicProjects={(publicProjects ?? []) as PublicProject[]} />;
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, email, plan, credits_remaining, bonus_credits, credits_reset_at, stripe_customer_id, stripe_subscription_status, created_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  const email = profile?.email ?? user.email ?? "";
  const displayName =
    profile?.display_name?.split(" ")[0] ?? (email ? email.split("@")[0] : "there");

  const accountProfile = {
    display_name: profile?.display_name ?? null,
    email,
    plan: (profile?.plan as "free" | "pro" | "ultra" | undefined) ?? "free",
    credits_remaining: profile?.credits_remaining ?? 100000,
    bonus_credits: profile?.bonus_credits ?? 0,
    credits_reset_at: profile?.credits_reset_at ?? hoursFromNowIso(24),
    stripe_customer_id: profile?.stripe_customer_id ?? null,
    stripe_subscription_status: profile?.stripe_subscription_status ?? null,
    created_at: profile?.created_at ?? user.created_at,
  };

  const { data: collabRows } = await supabase
    .from("project_collaborators")
    .select("project_id")
    .eq("user_id", user.id);

  const collabProjectIds = (collabRows ?? []).map((r) => r.project_id as string);

  let query = supabase.from("projects").select("*");

  query =
    collabProjectIds.length > 0
      ? query.or(`owner_id.eq.${user.id},id.in.(${collabProjectIds.join(",")})`)
      : query.eq("owner_id", user.id);

  query = query.order("updated_at", { ascending: false });

  if (filter === "starred") {
    query = query.eq("is_starred", true);
  }

  const { data: projects } = await query;
  const list = (projects ?? []) as Project[];

  return (
    <div className="relative min-h-screen">
      <TopNav profile={accountProfile} />

      {!user && <NewsBar />}

      <main className="relative overflow-hidden px-4 py-20 sm:px-6">
        <video
          src="/pixel-anim.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[700px] w-full object-cover opacity-50 [mask-image:linear-gradient(to_bottom,black_0%,black_40%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_40%,transparent_100%)]"
        />

        <div className="relative z-10 space-y-10">
          <HomeHero
            displayName={displayName}
            plan={accountProfile.plan}
            creditsRemaining={accountProfile.credits_remaining}
            bonusCredits={accountProfile.bonus_credits}
          />

          <ScrollReveal once={false} className="mt-20!">
            <MarketplaceProjects currentUserId={user.id} />
          </ScrollReveal>
        </div>
      </main>

      <footer className="relative flex justify-center px-4 py-8 sm:px-6">
        <StatusPill />
      </footer>
    </div>
  );
}

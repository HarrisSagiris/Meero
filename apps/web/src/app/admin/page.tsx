import { notFound } from "next/navigation";
import {
  CreatorReferrals,
  type CreatorReferralWithStats,
} from "@/modules/admin/views/ui/creator-referrals";
import { NewsManager } from "@/modules/admin/views/ui/news-manager";
import { SignupCapForm } from "@/modules/admin/views/ui/signup-cap-form";
import { MeeroMark } from "@/components/logo";
import { ADMIN_EMAIL } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppSettings, CreatorReferral, NewsPost } from "@/lib/types";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <p className="text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1.5 text-[26px] font-bold tracking-tight text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-8 first:mt-0">
      <p className="mb-3 text-[12px] font-semibold tracking-wide text-muted-foreground">{title}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </div>
  );
}

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // 404, not redirect — this route shouldn't even hint at its own existence
  // to anyone but the one admin account.
  if (!user || user.email !== ADMIN_EMAIL) notFound();

  const count = (query: PromiseLike<{ count: number | null }>): Promise<number> =>
    Promise.resolve(query).then((r) => r.count ?? 0);

  const profiles = supabase.from("profiles");
  const projects = supabase.from("projects");
  const builds = supabase.from("builds");
  const head = { count: "exact" as const, head: true };

  const [
    settingsRes,
    totalUsers,
    freeUsers,
    proUsers,
    ultraUsers,
    signups7d,
    signups30d,
    githubConnected,
    supabaseConnected,
    totalProjects,
    publicProjects,
    clonedProjects,
    totalBuilds,
    succeededBuilds,
    failedBuilds,
    activeBuilds,
    newsRes,
  ] = await Promise.all([
    supabase.from("app_settings").select("*").eq("id", true).maybeSingle<AppSettings>(),
    count(profiles.select("id", head)),
    count(profiles.select("id", head).eq("plan", "free")),
    count(profiles.select("id", head).eq("plan", "pro")),
    count(profiles.select("id", head).eq("plan", "ultra")),
    count(profiles.select("id", head).gte("created_at", daysAgoIso(7))),
    count(profiles.select("id", head).gte("created_at", daysAgoIso(30))),
    count(profiles.select("id", head).not("github_username", "is", null)),
    count(profiles.select("id", head).eq("supabase_connected", true)),
    count(projects.select("id", head)),
    count(projects.select("id", head).eq("is_public", true)),
    count(projects.select("id", head).not("clone_of", "is", null)),
    count(builds.select("id", head)),
    count(builds.select("id", head).eq("status", "succeeded")),
    count(builds.select("id", head).eq("status", "failed")),
    count(builds.select("id", head).in("status", ["queued", "running"])),
    supabase.from("news_posts").select("*").order("created_at", { ascending: false }),
  ]);

  const referralsRes = await supabase
    .from("creator_referrals")
    .select("*")
    .order("created_at", { ascending: false });
  const referrals = (referralsRes.data ?? []) as CreatorReferral[];
  const referralEvents = supabase.from("creator_referral_events");
  const referralsWithStats: CreatorReferralWithStats[] = await Promise.all(
    referrals.map(async (referral) => {
      const [clicks, signups] = await Promise.all([
        count(
          referralEvents
            .select("id", head)
            .eq("referral_id", referral.id)
            .eq("event_type", "click"),
        ),
        count(
          referralEvents
            .select("id", head)
            .eq("referral_id", referral.id)
            .eq("event_type", "signup"),
        ),
      ]);
      return { ...referral, clicks, signups };
    }),
  );

  const settings = settingsRes.data;
  const newsPosts = (newsRes.data ?? []) as NewsPost[];
  const finishedBuilds = succeededBuilds + failedBuilds;
  const successRate =
    finishedBuilds > 0 ? Math.round((succeededBuilds / finishedBuilds) * 100) : null;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-8 flex items-center gap-2">
        <MeeroMark size={28} />
        <h1 className="text-[20px] font-semibold text-foreground">Admin</h1>
      </div>

      <Section title="Users">
        <StatCard label="Total users" value={totalUsers} />
        <StatCard label="New this week" value={signups7d} sub="last 7 days" />
        <StatCard label="New this month" value={signups30d} sub="last 30 days" />
        <StatCard
          label="Plan mix"
          value={`${freeUsers} / ${proUsers} / ${ultraUsers}`}
          sub="Free / Pro / Ultra"
        />
        <StatCard
          label="GitHub connected"
          value={githubConnected}
          sub={
            totalUsers > 0
              ? `${Math.round((githubConnected / totalUsers) * 100)}% of users`
              : undefined
          }
        />
        <StatCard
          label="Supabase connected"
          value={supabaseConnected}
          sub={
            totalUsers > 0
              ? `${Math.round((supabaseConnected / totalUsers) * 100)}% of users`
              : undefined
          }
        />
      </Section>

      <Section title="Projects">
        <StatCard label="Total projects" value={totalProjects} />
        <StatCard
          label="Public"
          value={publicProjects}
          sub={`${totalProjects - publicProjects} private`}
        />
        <StatCard label="Marketplace clones" value={clonedProjects} />
      </Section>

      <Section title="Builds">
        <StatCard label="Total builds" value={totalBuilds} />
        <StatCard label="Succeeded" value={succeededBuilds} />
        <StatCard label="Failed" value={failedBuilds} />
        <StatCard label="In progress" value={activeBuilds} sub="queued + running" />
        {successRate !== null && (
          <StatCard
            label="Success rate"
            value={`${successRate}%`}
            sub={`${finishedBuilds} finished builds`}
          />
        )}
      </Section>

      <div className="mt-8 rounded-2xl border border-border bg-white p-6 shadow-primary/10">
        <h2 className="mb-1 text-[15px] font-semibold text-foreground">Signups</h2>
        <p className="mb-5 text-[13px] text-muted-foreground">
          Cap how many people can create a Meero account. Enforced at the database for every signup
          path — password, magic link, OAuth — not just this form.
        </p>
        <SignupCapForm signupCap={settings?.signup_cap ?? null} userCount={totalUsers} />
      </div>

      <CreatorReferrals referrals={referralsWithStats} />

      <NewsManager posts={newsPosts} />
    </div>
  );
}

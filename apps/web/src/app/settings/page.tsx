import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsPageView } from "@/modules/account/views/ui/settings-page-view";
import { hoursFromNowIso } from "@/lib/time";

export const metadata = { title: "Settings — Meero" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; github?: string; supabase?: string }>;
}) {
  const { section, github, supabase: supabaseStatus } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, email, avatar_url, plan, credits_remaining, bonus_credits, credits_reset_at, stripe_customer_id, stripe_subscription_status, github_username, supabase_connected, created_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  const email = profile?.email ?? user.email ?? "";

  // Defaults let the page render even if migration 00004/00009 (billing
  // columns) hasn't been applied to this database yet — same fallback
  // pattern app-sidebar.tsx / app/page.tsx already use.
  const accountProfile = {
    display_name: profile?.display_name ?? null,
    email,
    avatar_url: profile?.avatar_url ?? null,
    plan: (profile?.plan as "free" | "pro" | "ultra" | undefined) ?? "free",
    credits_remaining: profile?.credits_remaining ?? 100000,
    bonus_credits: profile?.bonus_credits ?? 0,
    credits_reset_at: profile?.credits_reset_at ?? hoursFromNowIso(24),
    stripe_customer_id: profile?.stripe_customer_id ?? null,
    stripe_subscription_status: profile?.stripe_subscription_status ?? null,
    github_username: profile?.github_username ?? null,
    supabase_connected: profile?.supabase_connected ?? false,
    created_at: profile?.created_at ?? user.created_at,
  };

  return (
    <SettingsPageView
      profile={accountProfile}
      initialSection={section}
      githubStatus={github}
      supabaseStatus={supabaseStatus}
    />
  );
}

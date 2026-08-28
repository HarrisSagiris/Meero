import * as React from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { MeeroWordmark } from "@/components/logo";
import { SidebarLogoTrigger } from "./sidebar-logo-trigger";
import { AccountMenu } from "@/modules/account/views/ui/account-menu";
import { createClient } from "@/lib/supabase/server";
import { hoursFromNowIso, timeUntil } from "@/lib/time";
import { PLAN_CREDIT_LIMITS, Profile, type Project } from "@/lib/types";
import { ProjectNav } from "./project-nav";
import { RailNav } from "./rail-nav";
import { StarredProject } from "./starred-projects";
import { SearchProject } from "./search-project";
import { UsageBar } from "@/modules/account/views/ui/usage-bar";
import { PLAN_LABEL } from "@/modules/billing/utils/plans";
import { CreditIcon } from "@/components/icons";
import { formatTokens } from "@/lib/format";
import { UserNav } from "./user-nav";

export async function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "display_name, email, plan, avatar_url, credits_remaining, bonus_credits, credits_reset_at, stripe_customer_id, stripe_subscription_status, created_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) return null;

  const email = profile?.email ?? user.email ?? "";
  const displayName =
    profile?.display_name?.split(" ")[0] ?? (email ? email.split("@")[0] : "there");

  // Defaults let the dashboard render even if migration 00004/00009 (billing
  // columns) hasn't been applied to this database yet.
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

  // Explicitly scoped to the caller's own projects, plus any project
  // they've been added to as a real collaborator (00027_collaborators.sql)
  // — RLS also allows reading OTHER users' public projects now
  // (00015_marketplace.sql), so this dashboard would otherwise start mixing
  // in everyone's public work alongside the caller's own without this
  // filter.
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
  // if (filter === "starred") {
  //   query = query.eq("is_starred", true);
  // }
  const { data: projects } = await query;
  const list = (projects ?? []) as Project[];

  return (
    <Sidebar {...props} variant="sidebar" collapsible="icon">
      <SidebarHeader className="px-3">
        <SidebarMenu className="gap-4">
          <SidebarMenuItem className="flex w-full items-center justify-between group-data-[collapsible=icon]:justify-center">
            <MeeroWordmark height={30} className="group-data-[collapsible=icon]:hidden" />
            <SidebarLogoTrigger className="hidden group-data-[collapsible=icon]:flex" />
            <SidebarTrigger className="group-data-[collapsible=icon]:hidden" />
          </SidebarMenuItem>
          <SearchProject projects={projects} />
        </SidebarMenu>
      </SidebarHeader>
      {/* Expanded: the real project list. Collapsed: that list drops out and
          RailNav takes over with a compact, sectioned icon nav — the rail
          would otherwise be an empty gap between the header and footer. */}
      <SidebarContent className="mt-1">
        <div className="group-data-[collapsible=icon]:hidden">
          <StarredProject list={list} />
          <ProjectNav list={list} />
        </div>
        <RailNav />
      </SidebarContent>
      <SidebarFooter>
        <UserNav profile={profile as Profile} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

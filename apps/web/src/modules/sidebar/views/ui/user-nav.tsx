"use client";
import Link from "next/link";
import { CreditIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { formatTokens } from "@/lib/format";
import { timeUntil } from "@/lib/time";
import { Plan, PLAN_CREDIT_LIMITS, Profile } from "@/lib/types";
import { AccountMenu } from "@/modules/account/views/ui/account-menu";
import { UsageBar } from "@/modules/account/views/ui/usage-bar";
import { PLAN_LABEL } from "@/modules/billing/utils/plans";
import { Sparkles } from "lucide-react";

export function UserNav({ profile }: { profile: Profile }) {
  const limit = PLAN_CREDIT_LIMITS[profile.plan as Plan];

  return (
    <SidebarMenu className="gap-3">
      <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
        <div className="rounded-xl bg-background border px-2 py-2.5">
          <span className="mb-2 flex items-center gap-1.5 px-1 text-[12px] font-medium text-secondary-foreground">
            <CreditIcon size={14} />
            {PLAN_LABEL[profile.plan as Plan]} plan
          </span>

          <div className="px-1">
            <UsageBar remaining={profile.credits_remaining} limit={limit} />
          </div>

          <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">
            Resets in {timeUntil(profile.credits_reset_at)}
            {profile.bonus_credits > 0 && <> · +{formatTokens(profile.bonus_credits)} bonus</>}
          </p>
          {profile.credits_remaining === 0 && (
            <Button
              size="sm"
              render={<Link href="/settings?section=billing" />}
              className="w-full mt-1 rounded-md"
            >
              Upgrade <Sparkles className="size-3.5!" />
            </Button>
          )}
        </div>
      </SidebarMenuItem>
      <AccountMenu
        displayName={profile.display_name ?? "Meero user"}
        profile={profile}
        dark={false}
      />
    </SidebarMenu>
  );
}

"use client";

import Link from "next/link";
import { signOut } from "@/modules/auth/actions/auth-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDownIcon,
  CreditIcon,
  LogOutIcon,
  SettingsIcon,
  ShieldIcon,
} from "@/components/icons";
import type { SettingsProfile } from "@/modules/account/utils/types";
import { UsageBar } from "@/modules/account/views/ui/usage-bar";
import { formatTokens } from "@/lib/format";
import { ADMIN_EMAIL } from "@/lib/admin";
import { timeUntil } from "@/lib/time";
import { PLAN_CREDIT_LIMITS, type Profile } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

type AccountProfile = SettingsProfile & {
  avatar_url?: string | null;
};

const PLAN_LABEL: Record<Profile["plan"], string> = {
  free: "Free",
  pro: "Pro",
  ultra: "Ultra",
};

export function AccountMenu({
  displayName,
  profile,
  dark,
}: {
  displayName: string;
  profile: AccountProfile;
  dark: boolean;
}) {
  const initial = (displayName || profile.email).charAt(0).toUpperCase();
  const limit = PLAN_CREDIT_LIMITS[profile.plan];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<button type="button" />}
        className={`flex items-center gap-2 rounded-xl border py-1 pr-2 pl-1 backdrop-blur-sm transition-colors duration-300 group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:justify-start group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 ${
          dark
            ? "border-white/15 bg-white/10 hover:bg-white/15"
            : "border-border bg-white/80 hover:bg-white"
        }`}
      >
        <Avatar className="size-8 group-data-[collapsible=icon]:rounded-lg group-data-[collapsible=icon]:after:rounded-lg">
          <AvatarImage src={profile.avatar_url ?? undefined} />
          <AvatarFallback className="group-data-[collapsible=icon]:rounded-lg">
            {initial}
          </AvatarFallback>
        </Avatar>

        <span
          className={`max-w-[140px] truncate text-[13px] font-medium transition-colors duration-300 group-data-[collapsible=icon]:hidden ${
            dark ? "text-white" : "text-foreground"
          }`}
        >
          {displayName}
        </span>

        <ChevronDownIcon
          size={13}
          className={`text-muted-foreground ml-auto transition-transform duration-200 group-data-[collapsible=icon]:hidden ${
            dark ? "text-white/70" : ""
          }`}
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-64 rounded-2xl p-1.5 shadow-composer"
      >
        <div className="px-3 py-2.5">
          <p className="truncate text-[13px] font-semibold text-foreground">{displayName}</p>

          <p className="truncate text-[12px] text-muted-foreground">{profile.email}</p>
        </div>

        <div className="mx-1.5 mb-1.5 rounded-xl bg-muted/70 px-3 py-2.5">
          <span className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-secondary-foreground">
            <CreditIcon size={14} />
            {PLAN_LABEL[profile.plan]} plan
          </span>

          <UsageBar remaining={profile.credits_remaining} limit={limit} />

          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Resets in {timeUntil(profile.credits_reset_at)}
            {profile.bonus_credits > 0 && <> · +{formatTokens(profile.bonus_credits)} bonus</>}
          </p>
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="gap-2.5 rounded-lg px-3 w-full py-2 text-[13px] font-medium"
          render={<Link href="/settings" />}
        >
          <SettingsIcon size={16} />
          Settings
        </DropdownMenuItem>

        <DropdownMenuItem
          render={<Link href="/settings?section=billing" />}
          className="gap-2.5 w-full rounded-lg px-3 py-2 text-[13px] font-medium"
        >
          <CreditIcon size={16} />
          Billing &amp; usage
        </DropdownMenuItem>

        {profile.email === ADMIN_EMAIL && (
          <DropdownMenuItem
            render={<Link href="/admin" />}
            className="gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium"
          >
            <ShieldIcon size={16} />
            Admin
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem render={<div />}>
          <form action={signOut} className="w-full">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 text-[13px] font-medium"
            >
              <LogOutIcon size={16} />
              Sign out
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

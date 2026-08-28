"use client";

import { useEffect, useState } from "react";
import { AccountMenu } from "@/modules/account/views/ui/account-menu";
import type { SettingsProfile } from "@/modules/account/utils/types";
import { SidebarTriggerButton } from "./sidebar-trigger";
import { MarketingNavLinks } from "@/modules/marketing/views/ui/marketing-nav";

type NavProfile = SettingsProfile;

export function TopNav({ profile }: { profile: NavProfile }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    // 3-column grid, not flex + mx-auto — the side columns are 1fr each so
    // the nav links stay dead-center no matter what's in (or missing from)
    // the side slots (desktop hides both trigger and account menu here).
    // Each child is pinned to an explicit col-start-*: a hidden grid item is
    // dropped from auto-placement entirely, so without this the remaining
    // visible item(s) collapse into column 1 instead of keeping their slot.
    <header className="grid left-0 right-0 absolute top-0 z-10 min-h-16 grid-cols-[1fr_auto_1fr] items-center gap-6 py-4 transition-[background-color,backdrop-filter] duration-500 px-6">
      <SidebarTriggerButton className="col-start-1" />

      <MarketingNavLinks className="col-start-2 justify-self-center" showPricing={false} />

      <div className="col-start-3 flex justify-self-end md:hidden">
        <AccountMenu
          displayName={profile.display_name ?? "Meero User"}
          profile={profile}
          dark={false}
        />
      </div>
    </header>
  );
}

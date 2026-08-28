"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/** Routes that take over the whole screen — no AppSidebar, no inset
 *  margin/border. Client-side on purpose: the root layout doesn't re-run on
 *  a client <Link> navigation (only its `children` slot swaps), so a
 *  server-only pathname check here would only ever reflect the FIRST hard
 *  page load, not later in-app navigation to/from a full-screen route. */
const FULL_SCREEN_ROUTES = new Set(["/settings"]);

export function AppShell({
  sidebar,
  children,
}: {
  /** Already-rendered by the server (needs the signed-in user + a DB
   *  query) — this component only decides whether to place it. */
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const isFullScreen = pathname !== null && FULL_SCREEN_ROUTES.has(pathname);

  return (
    <SidebarProvider>
      {!isFullScreen && sidebar}
      <SidebarInset
        className={
          isFullScreen
            ? "overflow-x-hidden shadow-none! border-0! m-0! rounded-none!"
            : "overflow-x-hidden shadow-none! border"
        }
      >
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

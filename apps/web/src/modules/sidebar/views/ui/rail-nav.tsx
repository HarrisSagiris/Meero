"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { GridIcon, HomeIcon, UsersIcon } from "@/components/icons";

type RailItem = {
  href: string;
  label: string;
  Icon: typeof HomeIcon;
  match: (pathname: string) => boolean;
};

const WORKSPACE: RailItem[] = [
  { href: "/", label: "Home", Icon: HomeIcon, match: (p) => p === "/" },
  {
    href: "/templates",
    label: "Templates",
    Icon: GridIcon,
    match: (p) => p.startsWith("/templates"),
  },
  {
    href: "/community",
    label: "Community",
    Icon: UsersIcon,
    match: (p) => p.startsWith("/community"),
  },
];

/**
 * Icon-only workspace nav — rendered ONLY in the collapsed rail
 * (`group-data-[collapsible=icon]`); the expanded sidebar keeps its real
 * project list instead. Fills what would otherwise be an empty gap between
 * the header and footer.
 */
export function RailNav() {
  const pathname = usePathname() ?? "";

  return (
    <div className="hidden flex-1 flex-col group-data-[collapsible=icon]:flex">
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu className="items-center gap-1">
            {WORKSPACE.map(({ href, label, Icon, match }) => (
              <SidebarMenuItem key={href} title={label}>
                <SidebarMenuButton isActive={match(pathname)} render={<Link href={href} />}>
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </div>
  );
}

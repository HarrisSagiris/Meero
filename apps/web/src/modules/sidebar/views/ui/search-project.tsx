"use client";
import { ArrowUpRight, FilePlus, FolderPlus, PlusCircle, Search } from "lucide-react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import * as React from "react";
import {
  CalculatorIcon,
  CalendarIcon,
  CreditCardIcon,
  SettingsIcon,
  SmileIcon,
  UserIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Project } from "@/lib/types";

export function SearchProject({ projects }: { projects: Project[] | null }) {
  const [open, setOpen] = React.useState(false);
  const path = usePathname();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <SidebarMenuItem className="gap-2 pt-2 grid group-data-[collapsible=icon]:hidden">
        <InputGroup onClick={() => setOpen(true)} className="h-9 border-border! bg-background">
          <InputGroupInput readOnly placeholder="Search your projects.." />
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
        </InputGroup>
        {path.startsWith("/project") && (
          <Button render={<Link href="/" />} className="w-full rounded-md" size="sm">
            <PlusCircle className="size-3.5" /> New Project
          </Button>
        )}
      </SidebarMenuItem>
      <SidebarMenuItem className="hidden justify-center pt-2 group-data-[collapsible=icon]:flex">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Search your projects"
          onClick={() => setOpen(true)}
        >
          <Search />
        </Button>
      </SidebarMenuItem>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <CommandInput placeholder="Type a command or search..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="My Projects">
              {projects
                ?.filter((item, i, arr) => arr.findIndex((t) => t.id === item.id) === i)
                ?.map((item, i) => (
                  <CommandItem
                    className="group flex items-center justify-between"
                    value={`${item.name} ${item.id} ${item.description}`}
                    onSelect={() => {
                      router.push(`/project/${item.id}`);
                      setOpen(false);
                    }}
                    key={i}
                  >
                    <span>{item.name}</span>
                  </CommandItem>
                ))}
              {projects?.length === 0 && <CommandItem>No projects found.</CommandItem>}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}

"use client";

import { EllipsisVertical, ExternalLink, Star, Trash } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Project } from "@/lib/types";
import { startTransition, useState } from "react";
import { deleteProject, toggleStar } from "@/modules/projects/actions/project-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { usePathname } from "next/navigation";

export function ProjectNav({ list }: { list?: Project[] }) {
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);

  function onConfirm() {
    if (!deleteProjectId) return;

    startTransition(() => {
      void deleteProject(deleteProjectId);
    });

    setDeleteProjectId(null);
  }

  const path = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>My Projects</SidebarGroupLabel>

      <SidebarGroupContent>
        <SidebarMenu>
          {list
            ?.filter((e) => e.is_starred != true)
            .map((item) => (
              <SidebarMenuItem key={item.id} title={item.name}>
                <SidebarMenuButton
                  isActive={path === `/project/${item.id}`}
                  render={<Link href={`/project/${item.id}`} />}
                >
                  <span className="truncate">
                    {item.name.slice(0, 30)}
                    {item.name.length > 30 ? "..." : ""}
                  </span>
                </SidebarMenuButton>

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <SidebarMenuAction className="opacity-0 transition group-hover:opacity-100" />
                    }
                  >
                    <EllipsisVertical className="size-3!" />
                  </DropdownMenuTrigger>

                  <DropdownMenuContent className="min-w-fit text-nowrap">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>

                      <DropdownMenuItem
                        render={
                          <button
                            onClick={() =>
                              startTransition(() => toggleStar(item.id, !item.is_starred))
                            }
                          />
                        }
                        className="w-full"
                      >
                        <Star className={cn("size-3!", item.is_starred && "fill-current")} />
                        {item.is_starred ? "Unstar Project" : "Star Project"}
                      </DropdownMenuItem>

                      <DropdownMenuItem render={<Link href={`/project/${item.id}`} />}>
                        <ExternalLink className="size-3!" />
                        Open
                      </DropdownMenuItem>

                      <DropdownMenuItem onClick={() => setDeleteProjectId(item.id)}>
                        <Trash className="size-3!" /> Delete Project
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                <Dialog
                  open={deleteProjectId === item.id}
                  onOpenChange={(open) => {
                    if (!open) {
                      setDeleteProjectId(null);
                    }
                  }}
                >
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Delete Project</DialogTitle>
                      <DialogDescription>
                        Are you sure you want to delete this project?
                      </DialogDescription>
                    </DialogHeader>

                    <DialogFooter>
                      <Button variant="outline" onClick={() => setDeleteProjectId(null)}>
                        Cancel
                      </Button>

                      <Button variant="destructive" onClick={onConfirm}>
                        Delete
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </SidebarMenuItem>
            ))}
          {list?.length === 0 && (
            <div className="px-2">
              <div className="h-20 flex items-center justify-center text-[11px] border-dashed border rounded-md text-muted-foreground">
                No projects yet.
              </div>
            </div>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

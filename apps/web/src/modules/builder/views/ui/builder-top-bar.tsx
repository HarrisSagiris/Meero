"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { renameProject } from "@/modules/projects/actions/project-actions";
import { useBuilderView, type BuilderTab } from "@/modules/builder/providers/builder-view-context";
import { MonitoringBadge } from "@/modules/builder/views/ui/monitoring-badge";
import { VisibilityToggle } from "@/modules/builder/views/ui/visibility-toggle";
import {
  BarChartIcon,
  CodeIcon,
  GlobeIcon,
  HistoryIcon,
  LinkIcon,
  PencilIcon,
  TrendingUpIcon,
} from "@/components/icons";
import { MeeroMark } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import type { Plan } from "@/lib/types";
import { SidebarTriggerButton } from "@/modules/sidebar/views/ui/sidebar-trigger";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * One single-row top bar for the whole builder — a small floating home
 * link back to the dashboard (there's no Chrome-like open-project tab strip
 * above this anymore — see git history for browser-tab-bar.tsx, removed to
 * maximize the panels' vertical space), the compact view pill
 * (Preview/Code/History/Connections) in the middle, and the real per-project
 * actions on the right. The live app's URL/reload/fullscreen controls live
 * inside the Preview tab itself (PreviewPane), not here. The view pill's
 * state comes from BuilderViewProvider, a sibling context, since
 * BuilderCanvas (which actually renders the selected view) sits elsewhere
 * in the tree.
 */
export function BuilderTopBar({
  isOwner,
  isCollaborator,
  projectId,
  projectName,
  plan,
  isPublic,
  liveUrl,
  generating,
  supabaseLinked,
  monitoringActive,
  autonomyMode,
  hasConversionAlert = false,
}: {
  isOwner: boolean;
  isCollaborator: boolean;
  projectId: string;
  projectName: string;
  plan: Plan;
  isPublic: boolean;
  /** The project's real production Vercel release (Pro/Ultra only). */
  liveUrl: string | null;
  generating: boolean;
  supabaseLinked: boolean;
  /** True once this project genuinely has something for Meero's 24/7
   *  monitoring agent to watch — linked Supabase + a real succeeded build.
   *  Never shown as a fake "always on" badge. */
  monitoringActive: boolean;
  /** Manual mode still detects production errors — only auto-firing a fix
   *  is gated — so the badge shows either way, just with a different
   *  tooltip (00028_autonomy_mode.sql). */
  autonomyMode: "solo" | "manual";
  /** An open conversion hypothesis, or a decided-but-unapplied experiment
   *  awaiting the owner's click (00042_conversion_agent.sql) — draws
   *  attention to the "Improvements" tab while inactive (internal name
   *  stays "conversion" throughout the codebase; only the user-facing
   *  label changed). */
  hasConversionAlert?: boolean;
}) {
  const { tab, setTab } = useBuilderView();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-3.5">
      {/* Sized to the chat pane's exact width (BuilderLayout's
          lg:w-[420px]) at lg+ so the switcher still lines up with where the
          canvas panel itself starts below — same alignment the old empty
          spacer gave, just with a real link inside it instead of nothing.
          Below lg it just hugs the icon's own width. */}
      <div className="flex min-w-0 items-center lg:w-[420px]">
        <SidebarTriggerButton className="mr-2" />
        <ProjectNameBox projectId={projectId} name={projectName} editable={isOwner} />
      </div>

      {/* Sits near the left edge of the canvas region — just after the
          chat-width block above — nudged right a touch, rather than floating
          near the right-side actions. */}
      <TabPill
        tab={tab}
        setTab={setTab}
        generating={generating}
        supabaseLinked={supabaseLinked}
        hasConversionAlert={hasConversionAlert}
        className="ml-70"
      />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {isCollaborator && <Badge variant="secondary">Collaborator</Badge>}
        {plan === "free" || !isOwner ? (
          <Badge variant="secondary">{isPublic ? "Public" : "Private"}</Badge>
        ) : (
          <VisibilityToggle projectId={projectId} isPublic={isPublic} />
        )}
        {monitoringActive && <MonitoringBadge autonomyMode={autonomyMode} />}
        {liveUrl && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="This project's real Vercel production release"
            className="flex items-center gap-1.5 rounded-full border border-border bg-gradient-to-r from-white via-secondary to-[#ededed] px-3 py-1.5 text-[13px] font-medium text-foreground shadow-primary/10 transition hover:border-foreground/30 hover:shadow-composer sm:px-4"
          >
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            Live
          </a>
        )}
      </div>
    </header>
  );
}

/**
 * One square-rounded button doing double duty: the logo + "/" + project
 * name is the back-to-dashboard link (like the public read-only header
 * above), and a pencil at the end (owners only) switches it into inline
 * rename instead of navigating — a real `projects.name` write via
 * `renameProject` (plain owner-update RLS, same as is_starred/is_public),
 * not just local state. Non-owners get the same box with no pencil, always
 * just a home link.
 */
function ProjectNameBox({
  projectId,
  name,
  editable,
}: {
  projectId: string;
  name: string;
  editable: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  async function commit() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setValue(name);
      return;
    }
    setSaving(true);
    const result = await renameProject(projectId, trimmed);
    setSaving(false);
    setEditing(false);
    if (result.error) setValue(name);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setValue(name);
      setEditing(false);
    }
  }

  const boxClasses =
    "flex min-w-0 items-center gap-1.5 rounded-lg border border-border py-1 pr-2 pl-2";

  if (editing) {
    return (
      <div>
        {/*<MeeroMark size={16} className="shrink-0 opacity-90" />
        <span aria-hidden className="shrink-0 text-[13px] text-input">
          /
        </span>*/}
        <Input
          ref={inputRef}
          value={value}
          disabled={saving}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  }

  return (
    <div className={`group ${boxClasses} transition hover:border-input hover:bg-muted`}>
      {/*<MeeroMark size={16} className="shrink-0 opacity-90" />
      <span aria-hidden className="shrink-0 text-[13px] text-input">
        /
      </span>*/}
      <span
        onClick={(e) => {
          setEditing(true);
        }}
        className="isolate min-w-0 truncate text-[13px] font-medium text-foreground"
      >
        {name}
      </span>
      {editable && (
        <button
          type="button"
          title="Rename project"
          aria-label="Rename project"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setValue(name);
            setEditing(true);
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
        >
          <PencilIcon className="size-3" />
        </button>
      )}
    </div>
  );
}

/**
 * The compact view switcher — one real "bubble" glides between tabs (same
 * sliding-pill technique as the home hero's Default/Superagent toggle) AND
 * shows the current tab's label, so it has to actually resize as it moves
 * (icon-only tabs are all one size; the active one is wider). Its position
 * and width are measured from the real DOM button via a ref, in
 * useLayoutEffect — synchronous, so it reads the button's FINAL post-click
 * size before the browser paints, never a stale mid-transition value. The
 * buttons themselves resize instantly (no transition of their own); the
 * bubble is the only thing that visibly animates.
 */
function TabPill({
  tab,
  setTab,
  generating,
  supabaseLinked,
  hasConversionAlert = false,
  className = "",
}: {
  tab: BuilderTab;
  setTab: (tab: BuilderTab) => void;
  generating: boolean;
  supabaseLinked: boolean;
  hasConversionAlert?: boolean;
  className?: string;
}) {
  const btnRefs = useRef<Partial<Record<BuilderTab, HTMLButtonElement | null>>>({});
  const [rect, setRect] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const btn = btnRefs.current[tab];
    if (btn) setRect({ left: btn.offsetLeft, width: btn.offsetWidth });
  }, [tab]);

  return (
    <div
      role="tablist"
      aria-label="Builder view"
      className={`relative inline-flex items-center gap-1 rounded-full bg-secondary p-[3.5px] ${className}`}
    >
      <TabButton
        tabRef={(el) => (btnRefs.current.preview = el)}
        active={tab === "preview"}
        onClick={() => setTab("preview")}
        icon={<GlobeIcon size={14} />}
        label="Preview"
      />
      <TabButton
        tabRef={(el) => (btnRefs.current.code = el)}
        active={tab === "code"}
        onClick={() => setTab("code")}
        icon={<CodeIcon size={14} />}
        label="Code"
        dot={generating}
      />
      <TabButton
        tabRef={(el) => (btnRefs.current.history = el)}
        active={tab === "history"}
        onClick={() => setTab("history")}
        icon={<HistoryIcon size={13} />}
        label="History"
      />
      <TabButton
        tabRef={(el) => (btnRefs.current.connections = el)}
        active={tab === "connections"}
        onClick={() => setTab("connections")}
        icon={<LinkIcon size={13} />}
        label="Connections"
        dot={!supabaseLinked}
      />
      <TabButton
        tabRef={(el) => (btnRefs.current.stats = el)}
        active={tab === "stats"}
        onClick={() => setTab("stats")}
        icon={<BarChartIcon size={13} />}
        label="Stats"
      />
      <TabButton
        tabRef={(el) => (btnRefs.current.conversion = el)}
        active={tab === "conversion"}
        onClick={() => setTab("conversion")}
        icon={<TrendingUpIcon size={13} />}
        label="Improvements"
        dot={hasConversionAlert}
      />
    </div>
  );
}

/** One tab button — icon-only (28px square) when inactive, icon+label when
 *  active. Its own size change is instant (no transition here); the
 *  sliding bubble behind it in TabPill is what animates. */
function TabButton({
  tabRef,
  active,
  onClick,
  icon,
  label,
  dot,
}: {
  tabRef: (el: HTMLButtonElement | null) => void;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  /** Small accent dot drawing attention to this tab while inactive. */
  dot?: boolean;
}) {
  return (
    <Button
      ref={tabRef}
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      onClick={onClick}
      variant={active ? "default" : "secondary"}
      size={active ? "sm" : "icon-sm"}
      className={`relative z-10 flex items-center transition-all justify-center rounded-full`}
    >
      {icon}
      {active && <span className="text-[12.5px] font-medium">{label}</span>}
      {dot && !active && (
        <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary" aria-hidden />
      )}
    </Button>
  );
}

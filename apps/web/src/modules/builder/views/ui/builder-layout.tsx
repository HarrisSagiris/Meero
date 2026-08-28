"use client";

import { useState, type ReactNode } from "react";

type MobileTab = "chat" | "build";

/**
 * Responsive shell for the builder: chat + canvas sit side by side from
 * `lg:` up (1024px+), matching the original desktop layout. Below that,
 * only one pane is visible at a time — a real device can't usefully show a
 * 420px chat sidebar next to a phone-frame preview — switched by a pill
 * toggle in place of the desktop side-by-side split.
 */
export function BuilderLayout({ chat, canvas }: { chat: ReactNode; canvas: ReactNode }) {
  const [tab, setTab] = useState<MobileTab>("chat");

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex shrink-0 justify-center border-b border-border px-3 py-2 lg:hidden">
        <div
          role="tablist"
          aria-label="Builder pane"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted p-1"
        >
          <MobileTabButton active={tab === "chat"} onClick={() => setTab("chat")} label="Chat" />
          <MobileTabButton active={tab === "build"} onClick={() => setTab("build")} label="Build" />
        </div>
      </div>

      <div
        className={`${tab === "chat" ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col bg-white lg:flex lg:w-[420px] lg:shrink-0`}
      >
        {chat}
      </div>
      <main
        className={`${tab === "build" ? "block" : "hidden"} min-h-0 min-w-0 flex-1 lg:block lg:my-3 lg:mr-3`}
      >
        {canvas}
      </main>
    </div>
  );
}

function MobileTabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition ${
        active ? "bg-foreground text-white" : "text-secondary-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

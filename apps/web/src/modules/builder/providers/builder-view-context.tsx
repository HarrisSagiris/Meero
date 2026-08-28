"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type BuilderTab = "preview" | "code" | "history" | "connections" | "stats" | "conversion";

const VALID_TABS: BuilderTab[] = [
  "preview",
  "code",
  "history",
  "connections",
  "stats",
  "conversion",
];

const BuilderViewContext = createContext<{
  tab: BuilderTab;
  setTab: (tab: BuilderTab) => void;
} | null>(null);

/**
 * Which of the builder views (Preview/Code/History/Connections/Conversion)
 * is showing — shared between BuilderTopBar (the tab buttons) and BuilderCanvas
 * (the actual view content), since under the server-rendered project page
 * they're siblings, not parent/child, so plain prop-drilling can't connect
 * them the way local state used to (when the tab switcher lived inside
 * BuilderCanvas alone).
 */
export function BuilderViewProvider({
  initialTab = "preview",
  children,
}: {
  initialTab?: BuilderTab;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<BuilderTab>(initialTab);

  // The chat's "connect Supabase" prompt, and the post-build "what's next"
  // card's quick links, route here via this window event — they're several
  // levels deep inside ChatPanel, nowhere near this provider in the tree.
  useEffect(() => {
    function open(e: Event) {
      const detail = (e as CustomEvent<BuilderTab | undefined>).detail;
      setTab(detail && VALID_TABS.includes(detail) ? detail : "connections");
    }
    window.addEventListener("meero:open-connections", open);
    return () => window.removeEventListener("meero:open-connections", open);
  }, []);

  return (
    <BuilderViewContext.Provider value={{ tab, setTab }}>{children}</BuilderViewContext.Provider>
  );
}

export function useBuilderView() {
  const ctx = useContext(BuilderViewContext);
  if (!ctx) {
    throw new Error("useBuilderView must be used within a BuilderViewProvider");
  }
  return ctx;
}

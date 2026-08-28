"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useProjectActivity,
  type LiveFile,
} from "@/modules/builder/providers/project-activity-context";
import ShinyText from "@/components/ui/shiny-text";
import type { BuildFile } from "@/lib/types";

function basename(path: string) {
  return path.split("/").pop() ?? path;
}
function dirname(path: string) {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/**
 * The "Code" tab: the real generated TypeScript/HTML/CSS source for the most
 * recent build, read straight from the RLS-scoped `build_files` table. Never
 * a placeholder — when there's no generated code yet, it says so honestly.
 */
export function CodeView({ files, generating }: { files: BuildFile[]; generating: boolean }) {
  // Default to the app's main screen if present, else any real source file
  // (skipping config/manifests where possible).
  const defaultPath = useMemo(() => {
    const page = files.find((f) => f.path === "app/page.tsx");
    const anySource = files.find((f) => f.path.endsWith(".tsx") || f.path.endsWith(".ts"));
    return (page ?? anySource ?? files[0])?.path ?? null;
  }, [files]);

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const activePath = selectedPath ?? defaultPath;
  const active = files.find((f) => f.path === activePath) ?? null;

  // Before the generated source is persisted, stream the REAL source the
  // codegen agent is writing right now — line by line, straight from the live
  // WebSocket feed. All files stack in ONE continuous, stable view (fixed panel
  // width, the newest lines scrolling into view) so nothing jumps per file.
  if (files.length === 0) {
    return <LiveCodeStream generating={generating} />;
  }

  return (
    <div className="flex h-full min-h-0 min-w-0">
      {/* File list */}
      <aside className="w-[190px] shrink-0 overflow-y-auto border-r border-border bg-white/50 py-2">
        {files.map((f) => {
          const isActive = f.path === activePath;
          const dir = dirname(f.path);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedPath(f.path)}
              title={f.path}
              className={`block w-full px-3 py-1.5 text-left transition ${
                isActive ? "bg-foreground/[0.06]" : "hover:bg-muted"
              }`}
            >
              <span
                className={`block truncate font-mono text-[12px] ${
                  isActive ? "font-semibold text-foreground" : "text-secondary-foreground"
                }`}
              >
                {basename(f.path)}
              </span>
              {dir && (
                <span className="block truncate text-[10px] text-muted-foreground">{dir}</span>
              )}
            </button>
          );
        })}
      </aside>

      {/* File content */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {active && (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
              <span className="truncate font-mono text-[12px] text-secondary-foreground">
                {active.path}
              </span>
              {active.language && (
                <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                  {active.language}
                </span>
              )}
              <div className="ml-auto">
                <CopyButton text={active.content} />
              </div>
            </div>
            <CodeBlock key={active.id} content={active.content} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Live codegen view: the real source streaming in, all files stacked in ONE
 * continuous, stable column. Each file is a section (path header + its source
 * growing line by line); the newest lines scroll into view as they're written.
 * The panel width never changes — long lines scroll horizontally inside their
 * own section — and nothing switches or jumps as each new file starts.
 */
function LiveCodeStream({ generating }: { generating: boolean }) {
  const { activity } = useProjectActivity();
  const liveFiles = activity.files;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Only auto-follow the newest lines when the user is already near the bottom,
  // so scrolling up to read an earlier file doesn't get yanked back down.
  const followRef = useRef(true);

  // Total streamed length — changes on every new token, driving the autoscroll.
  const totalLen = liveFiles.reduce((n, f) => n + (f.content?.length ?? 0), 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [totalLen, liveFiles.length]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
        {generating ? (
          <>
            <span className="size-2 animate-pulse rounded-full bg-foreground" />
            <ShinyText
              text="Writing your app…"
              speed={1.6}
              color="#8a8a8a"
              shineColor="#0a0a0a"
              className="text-[13px] font-medium"
            />
          </>
        ) : (
          <span className="text-[13px] font-medium text-secondary-foreground">No code yet</span>
        )}
        {liveFiles.length > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            {liveFiles.length} {liveFiles.length === 1 ? "file" : "files"}
          </span>
        )}
      </div>

      {liveFiles.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="max-w-[280px] text-[12px] leading-relaxed text-muted-foreground">
            {generating
              ? "The codegen agent is generating a real Next.js + shadcn/ui app. Its source streams in here as it's written — before anything is built."
              : "Describe an app to generate a real project. Every line shown here is the actual source that gets built — nothing simulated."}
          </p>
        </div>
      ) : (
        <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
          {liveFiles.map((f) => (
            <FileSection key={f.path} file={f} />
          ))}
        </div>
      )}
    </div>
  );
}

/** One streamed file: a sticky path header + its source growing line by line. */
function FileSection({ file }: { file: LiveFile }) {
  const coding = file.status === "coding";
  const lines = (file.content ?? "").replace(/\n$/, "").split("\n");
  return (
    <div className="border-b border-border/60">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-white/95 px-4 py-1.5 backdrop-blur">
        {coding ? (
          <span className="size-3.5 shrink-0 animate-spin rounded-full border-[2px] border-input border-t-primary" />
        ) : (
          <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <svg
              width="9"
              height="9"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m4 10.5 4 4 8-9" />
            </svg>
          </span>
        )}
        <span
          className="truncate font-mono text-[12px] text-secondary-foreground"
          title={file.path}
        >
          {file.path}
        </span>
        {coding && (
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">writing…</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <pre className="w-max min-w-full py-2 font-mono text-[12px] leading-[1.6]">
          <code>
            {lines.map((line, i) => {
              const isLast = i === lines.length - 1;
              return (
                <div key={i} className="flex">
                  <span className="sticky left-0 w-11 shrink-0 select-none bg-white pr-3 text-right text-[11px] text-input">
                    {i + 1}
                  </span>
                  <span className="whitespace-pre pr-6 text-foreground">
                    {line || " "}
                    {coding && isLast && (
                      <span className="ml-px inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-foreground" />
                    )}
                  </span>
                </div>
              );
            })}
          </code>
        </pre>
      </div>
    </div>
  );
}

function CodeBlock({ content }: { content: string }) {
  const lines = content.replace(/\n$/, "").split("\n");
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <pre className="w-max min-w-full py-3 font-mono text-[12px] leading-[1.6]">
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              <span className="sticky left-0 w-11 shrink-0 select-none bg-white pr-3 text-right text-[11px] text-input">
                {i + 1}
              </span>
              <span className="whitespace-pre pr-6 text-foreground">{line || " "}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — no-op.
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-secondary-foreground transition hover:bg-muted hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

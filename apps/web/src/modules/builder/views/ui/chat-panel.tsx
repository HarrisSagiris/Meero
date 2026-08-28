"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import { ArrowUpIcon, SupabaseIcon } from "@/components/icons";
import { AutonomyModeToggle } from "@/modules/builder/views/ui/autonomy-mode-toggle";
import { LiveBuildActivity } from "@/modules/builder/views/ui/live-build-activity";
import { MarkdownLite } from "@/modules/builder/views/ui/markdown-lite";
import { useProjectActivity } from "@/modules/builder/providers/project-activity-context";
import { RuntimeErrorsPanel } from "@/modules/builder/views/ui/runtime-errors-panel";
import { MeeroMark } from "@/components/logo";
import ShinyText from "@/components/ui/shiny-text";
import { createClient } from "@/lib/supabase/client";
import { LiveTime } from "@/components/ui/live-time";
import type { BuildFile, Message, SpecAttachment } from "@/lib/types";

const MAX_FILES = 10;
const MAX_FILE_MB = 20;
const ACCEPT = ".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.csv,.json,.docx";

/** Fallback follow-up ideas — only shown if schema.sql isn't available yet
 *  (or genuinely has no real user tables to build suggestions from). Fills
 *  the composer (doesn't auto-send), same as the home composer's starter
 *  ideas. */
const CONTINUE_IDEAS = [
  {
    label: "Add a contact form",
    prompt: "Add a contact form that saves submissions to a new table.",
  },
  {
    label: "Improve mobile layout",
    prompt: "Improve the mobile responsive layout.",
  },
  {
    label: "Refine the color scheme",
    prompt: "Refine the color scheme to feel more polished.",
  },
  { label: "Add a new section", prompt: "Add a new section to the page." },
];

/** Required system tables — never worth suggesting the user "add search to
 *  _meero_runtime_errors". */
const SYSTEM_TABLES = new Set(["_meero_runtime_errors", "_meero_emails"]);

/** Real backend progress labels for the gap between the reply text finishing
 *  and the build widget appearing (graph.py's decide_node/apply_node) — this
 *  is genuine work (a second LLM call, spec/build writes), not just latency,
 *  so it's worth naming rather than leaving the UI silent. */
const STATUS_COPY: Record<string, string> = {
  deciding: "Reviewing your request…",
  applying: "Applying your changes…",
  starting_build: "Starting your build…",
};

/** snake_case table name -> "Title Case" for a readable suggestion label. */
function humanizeTableName(name: string): string {
  return name
    .split("_")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** The REAL table names this specific app's schema.sql actually declares —
 *  the one reliable signal for "what is this app," since every generated
 *  app is a single-page client app (no per-view files to introspect). */
function realTableNames(files: BuildFile[]): string[] {
  const schema = files.find((f) => f.path === "schema.sql")?.content;
  if (!schema) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  const re = /create\s+table\s+if\s+not\s+exists\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  for (const match of schema.matchAll(re)) {
    const raw = match[1].toLowerCase();
    if (SYSTEM_TABLES.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    names.push(raw);
  }
  return names;
}

/** "a" vs "an" for a humanized table name — needed since "Add a Announcements
 *  dashboard" reads wrong for any table starting with a vowel sound. */
function indefiniteArticle(word: string): "a" | "an" {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/** One suggestion template per real table, rotated so several tables never
 *  repeat the same phrasing. Each reads naturally whether the table name is
 *  singular or plural, since we don't attempt to grammatically inflect it. */
const TABLE_SUGGESTION_TEMPLATES: ((table: string) => {
  label: string;
  prompt: string;
})[] = [
  (t) => ({
    label: `Add search to ${t}`,
    prompt: `Add search to the ${t} table.`,
  }),
  (t) => ({
    label: `Add filters to ${t}`,
    prompt: `Add filtering and sorting to ${t}.`,
  }),
  (t) => ({
    label: `Export ${t} to CSV`,
    prompt: `Add a CSV export for ${t}.`,
  }),
  (t) => ({
    label: `Add ${indefiniteArticle(t)} ${t} dashboard`,
    prompt: `Add a summary dashboard for ${t}.`,
  }),
];

/** Follow-up suggestions grounded in this project's REAL schema — never
 *  invented, always drawn from tables that genuinely exist in schema.sql.
 *  Falls back to the generic list only when there's nothing real to draw
 *  from yet. */
function appSpecificIdeas(files: BuildFile[]) {
  const tables = realTableNames(files).map(humanizeTableName);
  if (tables.length === 0) return CONTINUE_IDEAS;
  return tables
    .slice(0, 4)
    .map((t, i) => TABLE_SUGGESTION_TEMPLATES[i % TABLE_SUGGESTION_TEMPLATES.length](t));
}

/** A clarifying question Meero asks, rendered as tappable multiple-choice. */
type QuickQuestion = { question: string; options: string[]; multi?: boolean };

function basename(path: string) {
  return path.split("/").pop() ?? path;
}

/** Small "Built app/page.tsx" chips summarizing the real generated project files. */
function BuiltFiles({ files }: { files: BuildFile[] }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {files.map((f) => (
        <span
          key={f.id}
          title={f.path}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[11.5px] font-medium text-secondary-foreground shadow-primary/10"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-emerald-600"
            aria-hidden
          >
            <path d="m4 10.5 4 4 8-9" />
          </svg>
          Built {basename(f.path)}
        </span>
      ))}
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
      // Clipboard unavailable (permissions/insecure context) — do nothing.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label="Copy message"
      className="rounded-md p-1 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
    >
      {copied ? (
        <svg
          width="13"
          height="13"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="m4 10.5 4 4 8-9" />
        </svg>
      ) : (
        <svg
          width="13"
          height="13"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="7" y="7" width="10" height="10" rx="2" />
          <path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
        </svg>
      )}
    </button>
  );
}

export function ChatPanel({
  projectId,
  messages,
  files = [],
  hasBuiltBefore,
  autoStartPrompt = null,
  supabaseLinked,
  supabaseConnected,
  pendingBuildSpecId = null,
  isOwner,
  autonomyMode,
}: {
  projectId: string;
  messages: Message[];
  files?: BuildFile[];
  /** Whether this project has ANY prior succeeded build — shapes whether the
   *  live build narration reads as "Planning" (a brand-new app) or
   *  "Updating" (an app that already exists). */
  hasBuiltBefore: boolean;
  /** For a freshly created project: the opening prompt Meero should respond to
   *  on its own (reflecting the idea back and asking clarifying questions)
   *  without the user having to send anything. Null when not applicable. */
  autoStartPrompt?: string | null;
  /** Whether this project is bound to a Supabase project (its real backend).
   *  When false, the chat surfaces a connect prompt — a build can't run
   *  without it. */
  supabaseLinked: boolean;
  /** Whether the user has connected their Supabase account at all (vs. just
   *  not having picked a project yet). Shapes the CTA's action. */
  supabaseConnected: boolean;
  /** projects.pending_build_spec_id (00028_autonomy_mode.sql) — set when
   *  Manual mode has a build ready and waiting on a real approval click. */
  pendingBuildSpecId?: string | null;
  /** Owner-only — gates the Solo/Manual autonomy toggle in the composer. */
  isOwner: boolean;
  autonomyMode: "solo" | "manual";
}) {
  const router = useRouter();
  const { activity } = useProjectActivity();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<SpecAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  // Tappable clarifying questions Meero asked (from the last turn's SSE `done`),
  // and the user's selected option(s) per question index.
  const [quickQuestions, setQuickQuestions] = useState<QuickQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  // Which question the one-at-a-time stepper above the composer is showing.
  const [qIndex, setQIndex] = useState(0);
  // A finished build's live-activity card is normally pinned after every
  // message (so it reads as "the latest thing that happened"). But
  // `activity.phase` never resets to null on its own — it's shared state
  // other panels (Preview, Code) rely on for "what did the last build do" —
  // so without this, that card would stay pinned at the bottom FOREVER,
  // and any message sent afterward would render above it (wrong order: the
  // new message is chronologically newer but visually ends up first). Once
  // sendMessage() sees a real new turn start after a build has genuinely
  // finished, it retires that build's id here so its card stops claiming
  // the trailing slot — the build's summary still lives on via the
  // regular BuiltFiles chip attached to its message, in the right spot.
  const [dismissedBuildId, setDismissedBuildId] = useState<string | null>(null);
  // Lets the composer's own Stop control sever the in-flight /chat/stream
  // request client-side (see stopGenerating below) — there's no backend
  // "cancel this chat turn" endpoint, so this is a real abort of the fetch
  // itself, not a fake button.
  const streamAbortRef = useRef<AbortController | null>(null);
  const [stopping, setStopping] = useState(false);

  const latestSpecVersion = messages.reduce((max, m) => Math.max(max, m.spec_version ?? 0), 0);

  const continueIdeas = useMemo(() => appSpecificIdeas(files), [files]);

  // Once the server-rendered messages catch up, drop the local echoes.
  const [prevCount, setPrevCount] = useState(messages.length);
  if (messages.length !== prevCount) {
    setPrevCount(messages.length);
    setPendingUser(null);
    setStreamText("");
  }

  // Keep the newest content in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length, streamText, pendingUser]);

  // Streams the agent's reply for `message` from the orchestrator. Used both
  // for user-sent turns and for Meero's self-started opening message — it does
  // NOT persist a user message (the caller owns that), it only streams the
  // assistant response and then re-syncs the server-rendered conversation.
  async function streamReply(message: string, atts: SpecAttachment[]) {
    setSending(true);
    setError(null);
    setStreamText("");
    setStatusText(null);

    const controller = new AbortController();
    streamAbortRef.current = controller;

    const supabase = createClient();
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!base || !session) {
      setError(
        base
          ? "Session expired — reload and sign in again."
          : "Orchestrator is not configured (NEXT_PUBLIC_ORCHESTRATOR_URL).",
      );
      setSending(false);
      return;
    }

    try {
      const res = await fetch(`${base}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          project_id: projectId,
          message,
          attachments: atts,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`The agent failed to respond (${res.status}).`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const line = event.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (typeof payload.token === "string") {
            setStreamText((t) => t + payload.token);
            setStatusText(null);
          }
          if (typeof payload.status === "string") {
            setStatusText(STATUS_COPY[payload.status] ?? null);
          }
          if (payload.error) {
            setError(String(payload.error));
          }
          // Clarifying questions to render as a one-at-a-time stepper.
          if (payload.done && Array.isArray(payload.questions)) {
            setQuickQuestions(payload.questions as QuickQuestion[]);
            setQIndex(0);
          }
        }
      }
      // Sync the server-rendered conversation (messages, specs, builds).
      router.refresh();
    } catch (e) {
      // A deliberate user-triggered stop (see stopGenerating) — not a real
      // failure, so no error banner.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(
          e instanceof Error
            ? e.message
            : "The orchestrator is unreachable — is the Docker stack running?",
        );
      }
    } finally {
      setSending(false);
      streamAbortRef.current = null;
    }
  }

  // The composer's send button doubles as Stop while Meero is generating —
  // one continuous control for the whole "working" window instead of making
  // the user look elsewhere. While the reply/spec-decide turn is still
  // streaming, this severs the client connection (no backend "cancel this
  // chat turn" endpoint exists, so this is the honest stop available at that
  // stage). Once a real build has actually started, it switches to the same
  // REAL cancel (POST /builds/{id}/cancel — kills the worker, refunds the
  // cost) the build activity card's own Stop control uses.
  async function stopGenerating() {
    if (stopping) return;
    if (activity.active && activity.buildId) {
      setStopping(true);
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
        if (!base || !session) {
          throw new Error("Session expired — reload and sign in again.");
        }
        const res = await fetch(`${base}/builds/${activity.buildId}/cancel`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail || `Stop failed (${res.status}).`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't stop the build.");
      } finally {
        setStopping(false);
      }
      return;
    }
    streamAbortRef.current?.abort();
  }

  // Persists a user message, then streams the reply. Shared by the composer
  // and by submitting answers to Meero's multiple-choice questions. Returns
  // false if the message couldn't be persisted (so the caller can restore it).
  async function sendMessage(text: string, atts: SpecAttachment[]): Promise<boolean> {
    const message = text.trim();
    if (!message || sending || uploading) return false;

    // A real new turn starting after a build genuinely finished — retire
    // its live-activity card so it stops sitting after this new message.
    if (activity.buildId && !activity.active) {
      setDismissedBuildId(activity.buildId);
    }

    setSending(true);
    setError(null);
    setPendingUser(message);
    setStreamText("");
    // A new turn consumes any pending questions.
    setQuickQuestions([]);
    setAnswers({});
    setQIndex(0);

    const supabase = createClient();
    // Persist the user's message (RLS: own project, role 'user' only).
    const { error: insertError } = await supabase.from("messages").insert({
      project_id: projectId,
      role: "user",
      content: message,
    });
    if (insertError) {
      setError(insertError.message);
      setSending(false);
      setPendingUser(null);
      return false;
    }

    await streamReply(message, atts);
    return true;
  }

  async function send() {
    const message = draft.trim();
    if (!message || sending || uploading) return;
    const outgoingAttachments = attachments;
    setDraft("");
    setAttachments([]);
    const ok = await sendMessage(message, outgoingAttachments);
    if (!ok) {
      setDraft(message);
      setAttachments(outgoingAttachments);
    }
  }

  // Toggle a multiple-choice option (single- or multi-select per question).
  function toggleAnswer(qi: number, option: string, multi: boolean) {
    setAnswers((prev) => {
      const current = prev[qi] ?? [];
      if (multi) {
        return {
          ...prev,
          [qi]: current.includes(option)
            ? current.filter((o) => o !== option)
            : [...current, option],
        };
      }
      return { ...prev, [qi]: current.includes(option) ? [] : [option] };
    });
  }

  // Compose the selected answers into one message and send it as a turn.
  // Nothing selected across any question reads the same as an explicit
  // skip — build with sensible defaults rather than doing nothing.
  async function submitAnswers() {
    const parts = quickQuestions
      .map((q, qi) => {
        const sel = answers[qi] ?? [];
        return sel.length ? `${q.question} ${sel.join(", ")}` : null;
      })
      .filter((p): p is string => p !== null);
    const message = parts.length > 0 ? parts.join("\n") : "Just build it with sensible defaults.";
    await sendMessage(message, []);
  }

  // Advance the one-at-a-time stepper; submits on the last question.
  function continueQuestions() {
    if (qIndex >= quickQuestions.length - 1) {
      void submitAnswers();
    } else {
      setQIndex((i) => i + 1);
    }
  }

  // Meero opens the conversation on a brand-new project: respond to the seeded
  // opening prompt on its own (ask clarifying questions), without the user
  // sending anything and without re-inserting their message. Fires once.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!autoStartPrompt || autoStartedRef.current || sending) return;
    autoStartedRef.current = true;
    void streamReply(autoStartPrompt, []);
    // streamReply is stable enough for this one-shot; deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartPrompt]);

  // The runtime-error panel (and anything else) can prefill the composer
  // with a ready-to-send message via a window event — e.g. "ask Meero to
  // fix" a captured production error routes through the normal build path.
  useEffect(() => {
    function onPrefill(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail !== "string" || !detail.trim()) return;
      setDraft(detail);
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ block: "center" });
    }
    window.addEventListener("meero:chat-prefill", onPrefill);
    return () => window.removeEventListener("meero:chat-prefill", onPrefill);
  }, []);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  // Grows the composer with its content (capped) instead of a fixed 2-row
  // box — re-measured whenever the draft changes, including programmatic
  // changes (prefill, clearing after send), not just typing.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  // Real uploads to the RLS-scoped `attachments` bucket (own folder) — same
  // storage the home composer uses. No mock: these are genuinely stored docs.
  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Session expired — reload and sign in again.");
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        if (attachments.length >= MAX_FILES) {
          setError(`Maximum ${MAX_FILES} attachments.`);
          break;
        }
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
          setError(`"${file.name}" exceeds ${MAX_FILE_MB} MB.`);
          continue;
        }
        const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
        const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("attachments").upload(path, file);
        if (upErr) {
          setError(`Upload failed for "${file.name}": ${upErr.message}`);
          continue;
        }
        setAttachments((prev) => [...prev, { path, name: file.name }]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeAttachment(path: string) {
    setAttachments((prev) => prev.filter((a) => a.path !== path));
    const supabase = createClient();
    await supabase.storage.from("attachments").remove([path]);
  }

  // Supabase connect prompt: starts the real OAuth flow when the account
  // isn't connected yet, or routes to the Connections tab to pick a project
  // when it is. A build can't run without a linked Supabase backend, so this
  // is the one thing blocking the user from shipping.
  const [connecting, setConnecting] = useState(false);
  async function connectSupabase() {
    if (supabaseConnected) {
      // Account already connected — they just need to pick a project.
      window.dispatchEvent(new CustomEvent("meero:open-connections"));
      return;
    }
    setConnecting(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      if (!base || !session) throw new Error("Session expired — reload and sign in again.");
      const res = await fetch(
        `${base}/auth/supabase/authorize?project_id=${encodeURIComponent(projectId)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status}).`);
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Supabase connect.");
      setConnecting(false);
    }
  }

  // Manual mode (00028_autonomy_mode.sql): a real build the agent decided is
  // ready, waiting on an explicit click before it actually starts/charges.
  const [approving, setApproving] = useState(false);
  async function respondToPendingBuild(action: "approve-build" | "dismiss-build") {
    setApproving(true);
    setError(null);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
      if (!base || !session) throw new Error("Session expired — reload and sign in again.");
      const res = await fetch(`${base}/projects/${projectId}/${action}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Failed (${res.status}).`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the server.");
    } finally {
      setApproving(false);
    }
  }

  // The live pipeline card owns the "build is happening" story; when it's on
  // screen, suppress the persisted "Built X" chips so they never double up.
  // Excludes a build once sendMessage() has retired it (see
  // dismissedBuildId above) — otherwise a finished build's card would stay
  // pinned after every message sent from here on.
  const buildLive = activity.phase != null && activity.buildId !== dismissedBuildId;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {supabaseLinked && <RuntimeErrorsPanel projectId={projectId} />}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-6 overflow-y-auto px-3 py-5 sm:px-5 sm:py-6"
      >
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="animate-msg flex flex-col items-end gap-1">
              <div className="max-w-[85%] rounded-3xl rounded-br-md bg-foreground px-4 py-2.5 text-white">
                <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">
                  {message.content}
                </p>
              </div>
              <span className="pr-1 text-[10.5px] text-muted-foreground">
                <LiveTime iso={message.created_at} kind="stamp" />
              </span>
            </div>
          ) : (
            <div key={message.id} className="group animate-msg flex gap-2.5">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center">
                <MeeroMark size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[12px] font-semibold text-foreground">Meero</span>
                  <span className="text-[10.5px] text-muted-foreground">
                    <LiveTime iso={message.created_at} kind="ago" />
                  </span>
                </div>
                <MarkdownLite text={message.content} className="text-[14px] text-foreground" />

                {message.spec_version != null && (
                  <div
                    className={`mt-3 flex items-center justify-between rounded-xl border px-3.5 py-2.5 transition-colors ${
                      message.spec_version === latestSpecVersion
                        ? "border-foreground/20 bg-muted/40"
                        : "border-border bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex size-6 items-center justify-center rounded-md bg-foreground text-[10px] font-bold text-white">
                        v{message.spec_version}
                      </span>
                      <p className="text-[12px] text-secondary-foreground">
                        {message.spec_version === latestSpecVersion
                          ? "Current spec — builds use this"
                          : "Earlier spec version"}
                      </p>
                    </div>
                    {message.spec_version === latestSpecVersion && (
                      <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white">
                        LATEST
                      </span>
                    )}
                  </div>
                )}

                {message.spec_version != null &&
                  message.spec_version === latestSpecVersion &&
                  !buildLive && <BuiltFiles files={files} />}

                <div className="mt-1.5 opacity-0 transition group-hover:opacity-100">
                  <CopyButton text={message.content} />
                </div>
              </div>
            </div>
          ),
        )}

        {/* Local echo of the in-flight turn */}
        {pendingUser && (
          <div className="animate-msg flex flex-col items-end gap-1">
            <div className="max-w-[85%] rounded-3xl rounded-br-md bg-foreground px-4 py-2.5 text-white">
              <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">
                {pendingUser}
              </p>
            </div>
          </div>
        )}
        {(sending || streamText) && (
          <div className="animate-msg flex gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center">
              <MeeroMark size={16} />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              {streamText ? (
                <MarkdownLite text={streamText} className="text-[14px] text-foreground" />
              ) : (
                <p className="flex items-center gap-2 text-[14px]">
                  <ThinkingOrb state="composing" size={20} aria-label="Meero is thinking" />
                  <ShinyText
                    text="Meero is thinking…"
                    speed={1.6}
                    color="#8a8a8a"
                    shineColor="#0a0a0a"
                  />
                </p>
              )}
              {/* The reply text is done but the turn is still running behind
                  the scenes (deciding what to do, writing the spec/build) —
                  without this the UI goes silent right until the build
                  widget appears. Real backend progress, not a fake spinner. */}
              {streamText && sending && !buildLive && (
                <p className="mt-2 flex items-center gap-2 text-[13px]">
                  <ThinkingOrb
                    state="composing"
                    size={20}
                    aria-label={statusText ?? "Still working"}
                  />
                  <ShinyText
                    text={statusText ?? "Finishing up…"}
                    speed={1.6}
                    color="#8a8a8a"
                    shineColor="#0a0a0a"
                  />
                </p>
              )}
            </div>
          </div>
        )}

        {/* Live build pipeline — the real-time view of what's happening now */}
        {buildLive && (
          <div className="animate-msg flex gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center">
              <MeeroMark size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <LiveBuildActivity hasBuiltBefore={hasBuiltBefore} />
              {activity.phase === "succeeded" && (
                <div className="animate-msg mt-3 rounded-2xl border border-border bg-muted/40 p-3.5">
                  <p className="text-[12.5px] font-semibold text-foreground">What&apos;s next?</p>
                  <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-secondary-foreground">
                    <li>
                      <span className="font-medium text-foreground">Keep refining —</span> describe
                      any change below and I&apos;ll rebuild just what&apos;s needed.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Check the real code —</span> the{" "}
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("meero:open-connections", {
                              detail: "code",
                            }),
                          )
                        }
                        className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                      >
                        Code tab
                      </button>{" "}
                      has everything that was just generated.
                    </li>
                    <li>
                      <span className="font-medium text-foreground">Ready to go further —</span>{" "}
                      deploy it, connect GitHub, or add a custom domain from{" "}
                      <button
                        type="button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("meero:open-connections", {
                              detail: "connections",
                            }),
                          )
                        }
                        className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
                      >
                        Connections
                      </button>
                      .
                    </li>
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Manual-mode build approval — a real build is ready but Meero is
            waiting on an explicit yes before it starts (and spends a credit). */}
        {pendingBuildSpecId && supabaseLinked && !buildLive && (
          <div className="animate-msg flex gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center">
              <MeeroMark size={16} />
            </span>
            <div className="min-w-0 flex-1 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <p className="text-[13px] font-semibold text-foreground">
                Ready to build — waiting on you
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-secondary-foreground">
                Manual mode is on, so I won&apos;t start (or spend a credit) without your OK.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void respondToPendingBuild("approve-build")}
                  disabled={approving}
                  className="rounded-lg bg-foreground px-3.5 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                >
                  {approving ? "Working…" : "Approve build"}
                </button>
                <button
                  type="button"
                  onClick={() => void respondToPendingBuild("dismiss-build")}
                  disabled={approving}
                  className="rounded-lg border border-border bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-secondary-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Connect-Supabase prompt — a build needs a real backend, so this is
            surfaced right in the conversation until a project is linked. */}
        {!supabaseLinked && !buildLive && (
          <div className="animate-msg flex gap-2.5">
            <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center">
              <MeeroMark size={16} />
            </span>
            <div className="min-w-0 flex-1 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <div className="mb-1.5 flex items-center gap-2">
                <SupabaseIcon size={16} className="text-emerald-600" />
                <span className="text-[13px] font-semibold text-foreground">
                  Connect Supabase to build
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-secondary-foreground">
                Your app needs a real backend — its database and user accounts live in your own
                Supabase project. Connect one and I&apos;ll build the moment we&apos;ve dialed in
                the plan.
              </p>
              <button
                type="button"
                onClick={() => void connectSupabase()}
                disabled={connecting}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-foreground px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                <SupabaseIcon size={14} />
                {connecting
                  ? "Opening Supabase…"
                  : supabaseConnected
                    ? "Choose a Supabase project"
                    : "Connect Supabase"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* One-at-a-time clarifying-question stepper — sits above the composer
          (not in the scrolling thread) so it reads as "what Meero needs from
          you right now" rather than another message to scroll past. */}
      {quickQuestions.length > 0 && !sending && !buildLive && (
        <div className="animate-msg border-t border-border bg-muted/40 px-3 pt-3 sm:px-4">
          {(() => {
            const q = quickQuestions[qIndex];
            const multi = !!q.multi;
            const selected = answers[qIndex] ?? [];
            return (
              <div className="rounded-2xl border border-border bg-white p-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    Question {qIndex + 1} of {quickQuestions.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => void sendMessage("Just build it with sensible defaults.", [])}
                    className="text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    Skip — just build it
                  </button>
                </div>
                <div className="mb-3 h-1 overflow-hidden rounded-full bg-input">
                  <div
                    className="h-full rounded-full bg-foreground transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{
                      width: `${((qIndex + 1) / quickQuestions.length) * 100}%`,
                    }}
                  />
                </div>

                <p className="text-[14px] font-semibold text-foreground">
                  {q.question}
                  {multi && (
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      (pick any that apply)
                    </span>
                  )}
                </p>

                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {q.options.map((opt) => {
                    const isOn = selected.includes(opt);
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => toggleAnswer(qIndex, opt, multi)}
                        aria-pressed={isOn}
                        className={`flex items-center gap-2 rounded-xl border-2 bg-white px-3.5 py-3 text-left text-[13.5px] font-medium transition-all ${
                          isOn
                            ? "border-foreground bg-primary/10 text-foreground"
                            : "border-border text-secondary-foreground hover:border-foreground/40 hover:text-foreground"
                        }`}
                      >
                        <span
                          className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            isOn ? "border-foreground bg-foreground" : "border-input"
                          }`}
                        >
                          {isOn && (
                            <svg
                              width="8"
                              height="8"
                              viewBox="0 0 20 20"
                              fill="none"
                              stroke="white"
                              strokeWidth="3.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden
                            >
                              <path d="m4 10.5 4 4 8-9" />
                            </svg>
                          )}
                        </span>
                        {opt}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  {qIndex > 0 ? (
                    <button
                      type="button"
                      onClick={() => setQIndex((i) => i - 1)}
                      className="text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
                    >
                      Back
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={continueQuestions}
                    className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-[13.5px] font-medium text-white shadow-primary/10 transition hover:bg-primary/85"
                  >
                    {qIndex >= quickQuestions.length - 1 ? "Build it" : "Continue"}
                    <ArrowUpIcon size={14} className="rotate-90" />
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Continue-iteration suggestions — only once there's a real app to
          build on, and only in the steady state (no pending question/build
          approval/live build to compete with). */}
      {!sending &&
        quickQuestions.length === 0 &&
        !pendingBuildSpecId &&
        supabaseLinked &&
        files.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3 sm:px-4">
            {continueIdeas.map((idea) => (
              <button
                key={idea.label}
                type="button"
                onClick={() => {
                  setDraft(idea.prompt);
                  textareaRef.current?.focus();
                }}
                className="rounded-lg border border-border bg-white px-3 py-1 text-[12px] font-medium text-secondary-foreground transition hover:border-foreground hover:text-foreground"
              >
                {idea.label}
              </button>
            ))}
          </div>
        )}

      <div className="px-3 pt-3 pb-4 sm:px-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="rounded-[1.75rem] border border-border bg-transparent p-3 transition-colors duration-200 focus-within:border-foreground/30"
        >
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span
                  key={a.path}
                  title={a.name}
                  className="flex max-w-[180px] items-center gap-1.5 rounded-lg border border-border bg-muted py-1 pr-1 pl-2.5 text-[12px] text-secondary-foreground"
                >
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => removeAttachment(a.path)}
                    className="rounded-md px-1 text-muted-foreground hover:bg-border hover:text-foreground"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            rows={2}
            maxLength={20000}
            disabled={sending}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask Meero to change or refine your app…"
            className="max-h-[200px] w-full resize-none overflow-y-auto bg-transparent px-1.5 py-1 text-[14px] leading-relaxed outline-none placeholder:text-foreground/55"
          />

          {error && (
            <p
              role="alert"
              className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[12px] leading-relaxed text-red-700"
            >
              {error}
            </p>
          )}

          <div className="mt-1 flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || uploading}
              aria-label="Attach documents"
              title="Attach documents (specs, sketches, data samples)"
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-white text-secondary-foreground transition hover:border-foreground hover:text-foreground disabled:opacity-50"
            >
              {uploading ? (
                <span className="size-3.5 animate-spin rounded-full border-2 border-input border-t-primary" />
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M10 4.5v11M4.5 10h11" />
                </svg>
              )}
            </button>

            {isOwner && <AutonomyModeToggle projectId={projectId} mode={autonomyMode} />}

            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
              {draft.trim() ? (
                <>
                  <span className="font-medium text-secondary-foreground">↵</span> Send ·{" "}
                  <span className="font-medium text-secondary-foreground">Shift ↵</span> new line
                </>
              ) : (
                "Meero builds once you've dialed in the plan together"
              )}
            </span>

            {sending || (activity.active && activity.buildId) ? (
              <button
                type="button"
                onClick={() => void stopGenerating()}
                disabled={stopping}
                aria-label="Stop"
                title="Stop"
                className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-white transition hover:bg-red-600 disabled:opacity-40"
              >
                {stopping ? (
                  <span className="size-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <span className="size-2.5 rounded-[3px] bg-current" aria-hidden />
                )}
              </button>
            ) : (
              <button
                type="submit"
                disabled={uploading || !draft.trim()}
                aria-label="Send message"
                className="mr-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:bg-primary/85 disabled:opacity-40"
              >
                <ArrowUpIcon size={14} />
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

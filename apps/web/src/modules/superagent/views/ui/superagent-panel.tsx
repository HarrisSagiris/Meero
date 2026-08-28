"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon, GithubIcon, PullRequestIcon, SlackIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

type SuperagentRepo = {
  full_name: string;
  html_url: string;
  private: boolean;
  default_branch: string;
};

type SuperagentConnection = {
  id: string;
  github_repo_full_name: string;
  github_repo_url: string;
  instructions: string;
  status: string;
  created_at: string;
  slack_channel_id: string | null;
  slack_channel_name: string | null;
};

type SlackChannel = { id: string; name: string; is_private: boolean };

type SuperagentChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  pr_url: string | null;
  created_at: string;
};

async function authHeader(): Promise<{
  base: string;
  headers: Record<string, string>;
} | null> {
  const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!base || !session) return null;
  return { base, headers: { Authorization: `Bearer ${session.access_token}` } };
}

/**
 * Superagent's real UI: connect GitHub (same OAuth App github-button.tsx
 * uses) → pick a real repo (GET /superagent/repos) → creates a REAL
 * webhook (POST /superagent/connections) → then a genuine CHAT with the
 * agent (POST /superagent/connections/{id}/chat), not a one-time
 * "instructions" form. Every reply is real: the same brain that handles a
 * real "@meero" GitHub mention runs synchronously here too, so a message
 * either gets a real conversational answer or a real pull request — never
 * a canned response.
 */
export function SuperagentPanel() {
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [repos, setRepos] = useState<SuperagentRepo[]>([]);
  const [connections, setConnections] = useState<SuperagentConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SuperagentChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [connectingRepo, setConnectingRepo] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  const [slackConnected, setSlackConnected] = useState<boolean | null>(null);
  const [slackTeamName, setSlackTeamName] = useState<string | null>(null);
  const [connectingSlack, setConnectingSlack] = useState(false);
  const [slackChannels, setSlackChannels] = useState<SlackChannel[]>([]);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState("");
  const [linkingChannel, setLinkingChannel] = useState(false);

  async function refresh() {
    const auth = await authHeader();
    if (!auth) {
      setError("Session expired — reload and sign in again.");
      setLoading(false);
      return;
    }
    const [reposRes, connectionsRes, slackRes] = await Promise.all([
      fetch(`${auth.base}/superagent/repos`, { headers: auth.headers }),
      fetch(`${auth.base}/superagent/connections`, { headers: auth.headers }),
      fetch(`${auth.base}/superagent/slack/status`, { headers: auth.headers }),
    ]);
    if (reposRes.status === 422) {
      setGithubConnected(false);
    } else if (reposRes.ok) {
      setGithubConnected(true);
      setRepos(await reposRes.json());
    }
    if (connectionsRes.ok) {
      const rows: SuperagentConnection[] = await connectionsRes.json();
      setConnections(rows);
      if (rows.length === 0) {
        setShowConnectForm(true);
      } else {
        setActiveId((prev) => prev ?? rows[0].id);
      }
    }
    if (slackRes.ok) {
      const status = await slackRes.json();
      setSlackConnected(status.connected);
      setSlackTeamName(status.team_name);
    }
    setLoading(false);
  }

  useEffect(() => {
    // Real data fetch on mount (GitHub connection + repo list) — a
    // textbook valid effect use, not something to derive during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    async function loadMessages() {
      setLoadingMessages(true);
      const auth = await authHeader();
      if (!auth || cancelled) return;
      const res = await fetch(`${auth.base}/superagent/connections/${activeId}/messages`, {
        headers: auth.headers,
      });
      if (!cancelled && res.ok) setMessages(await res.json());
      if (!cancelled) setLoadingMessages(false);
    }
    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  async function connectGithub() {
    setConnecting(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setError("Session expired — reload and sign in again.");
      setConnecting(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/superagent/github/authorize`, {
        headers: auth.headers,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start GitHub connect.");
      setConnecting(false);
    }
  }

  async function connectRepo() {
    if (!selectedRepo) {
      setError("Pick a repo first.");
      return;
    }
    setConnectingRepo(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setError("Session expired — reload and sign in again.");
      setConnectingRepo(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/superagent/connections`, {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ github_repo_full_name: selectedRepo }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setConnections((prev) => [body, ...prev]);
      setActiveId(body.id);
      setMessages([]);
      setSelectedRepo("");
      setShowConnectForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect that repo.");
    } finally {
      setConnectingRepo(false);
    }
  }

  async function disconnect(id: string) {
    if (!window.confirm("Disconnect Superagent from this repo? The webhook is removed too.")) {
      return;
    }
    const auth = await authHeader();
    if (!auth) return;
    const remaining = connections.filter((c) => c.id !== id);
    setConnections(remaining);
    if (activeId === id) {
      setActiveId(remaining[0]?.id ?? null);
      setMessages([]);
      if (remaining.length === 0) setShowConnectForm(true);
    }
    await fetch(`${auth.base}/superagent/connections/${id}`, {
      method: "DELETE",
      headers: auth.headers,
    });
  }

  async function connectSlack() {
    setConnectingSlack(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setError("Session expired — reload and sign in again.");
      setConnectingSlack(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/superagent/slack/authorize`, {
        headers: auth.headers,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start Slack connect.");
      setConnectingSlack(false);
    }
  }

  async function openChannelPicker() {
    setShowChannelPicker(true);
    setError(null);
    if (slackChannels.length > 0) return;
    setLoadingChannels(true);
    const auth = await authHeader();
    if (!auth) {
      setLoadingChannels(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/superagent/slack/channels`, {
        headers: auth.headers,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setSlackChannels(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not list Slack channels.");
    } finally {
      setLoadingChannels(false);
    }
  }

  async function linkChannel() {
    if (!selectedChannel || !activeId) return;
    const channel = slackChannels.find((c) => c.id === selectedChannel);
    if (!channel) return;
    setLinkingChannel(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setLinkingChannel(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/superagent/connections/${activeId}/slack-channel`, {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: channel.id,
          channel_name: channel.name,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setConnections((prev) => prev.map((c) => (c.id === body.id ? body : c)));
      setShowChannelPicker(false);
      setSelectedChannel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link that channel.");
    } finally {
      setLinkingChannel(false);
    }
  }

  async function unlinkChannel(id: string) {
    const auth = await authHeader();
    if (!auth) return;
    setConnections((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, slack_channel_id: null, slack_channel_name: null } : c,
      ),
    );
    await fetch(`${auth.base}/superagent/connections/${id}/slack-channel`, {
      method: "DELETE",
      headers: auth.headers,
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text || !activeId || sending) return;
    setError(null);
    setDraft("");
    setSending(true);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: text,
        pr_url: null,
        created_at: new Date().toISOString(),
      },
    ]);
    const auth = await authHeader();
    if (!auth) {
      setError("Session expired — reload and sign in again.");
      setSending(false);
      return;
    }
    try {
      const res = await fetch(`${auth.base}/superagent/connections/${activeId}/chat`, {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setMessages((prev) => [...prev, body]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Superagent didn't reply — try again.");
    } finally {
      setSending(false);
    }
  }

  const availableRepos = repos.filter(
    (r) => !connections.some((c) => c.github_repo_full_name === r.full_name),
  );
  const active = connections.find((c) => c.id === activeId) ?? null;

  return (
    <div className="w-full rounded-2xl border border-white/35 bg-white/30 p-3 shadow-composer backdrop-blur-md">
      <div className="rounded-xl border border-border bg-white p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="size-5 animate-spin rounded-full border-2 border-input border-t-primary" />
          </div>
        ) : githubConnected === false ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <GithubIcon size={26} />
            <p className="text-[14px] text-secondary-foreground">
              Connect your GitHub account so Superagent can open real pull requests on your repos.
            </p>
            <button
              type="button"
              onClick={() => void connectGithub()}
              disabled={connecting}
              className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-[14px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              <GithubIcon size={16} />
              {connecting ? "Redirecting…" : "Connect GitHub"}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {connections.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {connections.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setActiveId(c.id);
                      setShowConnectForm(false);
                    }}
                    className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                      !showConnectForm && activeId === c.id
                        ? "bg-foreground text-white"
                        : "bg-muted text-secondary-foreground hover:text-foreground"
                    }`}
                  >
                    {c.github_repo_full_name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowConnectForm(true)}
                  className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                    showConnectForm
                      ? "bg-foreground text-white"
                      : "border border-dashed border-input text-muted-foreground hover:text-foreground"
                  }`}
                >
                  + Connect repo
                </button>
              </div>
            )}

            {showConnectForm ? (
              <div className="flex flex-col gap-2.5">
                <label className="text-[12px] font-medium text-secondary-foreground">Repo</label>
                <select
                  value={selectedRepo}
                  onChange={(e) => setSelectedRepo(e.target.value)}
                  className="w-full rounded-xl border border-input bg-white px-3.5 py-2.5 text-[14px] outline-none transition focus:border-foreground"
                >
                  <option value="">Select a repo…</option>
                  {availableRepos.map((r) => (
                    <option key={r.full_name} value={r.full_name}>
                      {r.full_name}
                      {r.private ? " (private)" : ""}
                    </option>
                  ))}
                </select>
                <div className="flex items-center justify-end gap-2">
                  {connections.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowConnectForm(false)}
                      className="rounded-xl px-3.5 py-2.5 text-[13.5px] font-medium text-muted-foreground transition hover:text-foreground"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void connectRepo()}
                    disabled={connectingRepo || !selectedRepo}
                    className="flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-[13.5px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                  >
                    {connectingRepo ? "Connecting…" : "Connect"}
                    <ArrowUpIcon size={13} />
                  </button>
                </div>
              </div>
            ) : active ? (
              <>
                <div className="flex items-center justify-between">
                  <a
                    href={active.github_repo_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] text-muted-foreground hover:underline"
                  >
                    {active.github_repo_full_name}
                  </a>
                  <button
                    type="button"
                    onClick={() => void disconnect(active.id)}
                    className="text-[11.5px] font-medium text-muted-foreground transition hover:text-red-600"
                  >
                    Disconnect
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
                  <SlackIcon size={14} />
                  {active.slack_channel_id ? (
                    <>
                      <span className="text-[12px] font-medium text-secondary-foreground">
                        #{active.slack_channel_name}
                      </span>
                      <button
                        type="button"
                        onClick={() => void unlinkChannel(active.id)}
                        className="text-[11px] font-medium text-muted-foreground transition hover:text-red-600"
                      >
                        Unlink
                      </button>
                    </>
                  ) : slackConnected === false ? (
                    <button
                      type="button"
                      onClick={() => void connectSlack()}
                      disabled={connectingSlack}
                      className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                    >
                      {connectingSlack ? "Redirecting…" : "Connect Slack"}
                    </button>
                  ) : slackConnected && !showChannelPicker ? (
                    <button
                      type="button"
                      onClick={() => void openChannelPicker()}
                      className="text-[12px] font-medium text-muted-foreground transition hover:text-foreground"
                    >
                      Link a Slack channel
                      {slackTeamName ? ` (${slackTeamName})` : ""}
                    </button>
                  ) : null}

                  {showChannelPicker && (
                    <div className="flex w-full items-center gap-2">
                      {loadingChannels ? (
                        <span className="size-3.5 animate-spin rounded-full border-2 border-input border-t-primary" />
                      ) : (
                        <select
                          value={selectedChannel}
                          onChange={(e) => setSelectedChannel(e.target.value)}
                          className="flex-1 rounded-lg border border-input bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-foreground"
                        >
                          <option value="">Select a channel…</option>
                          {slackChannels.map((c) => (
                            <option key={c.id} value={c.id}>
                              #{c.name}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => void linkChannel()}
                        disabled={linkingChannel || !selectedChannel}
                        className="shrink-0 rounded-lg bg-foreground px-2.5 py-1.5 text-[11.5px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
                      >
                        {linkingChannel ? "Linking…" : "Link"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowChannelPicker(false)}
                        className="shrink-0 text-[11.5px] font-medium text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                <div
                  ref={threadRef}
                  className="flex max-h-80 min-h-[9rem] flex-col gap-3 overflow-y-auto py-1"
                >
                  {loadingMessages ? (
                    <div className="flex flex-1 items-center justify-center py-8">
                      <span className="size-4 animate-spin rounded-full border-2 border-input border-t-primary" />
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="flex flex-1 items-center justify-center px-6 text-center text-[13px] text-muted-foreground">
                      Tell Superagent what to do in {active.github_repo_full_name} — a question, a
                      bug to fix, a feature to add. It reads the real repo and either replies, or
                      opens a real PR.
                    </p>
                  ) : (
                    messages.map((m) => <ChatBubble key={m.id} message={m} />)
                  )}
                  {sending && (
                    <div className="flex items-center gap-1.5 self-start rounded-2xl bg-muted px-3.5 py-2.5">
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
                    </div>
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send();
                  }}
                  className="flex items-end gap-2 border-t border-border pt-3"
                >
                  <textarea
                    rows={1}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="Message Superagent…"
                    className="max-h-32 min-h-[2.5rem] w-full resize-none rounded-xl border border-input bg-white px-3.5 py-2.5 text-[14px] leading-relaxed outline-none transition focus:border-foreground"
                  />
                  <button
                    type="submit"
                    disabled={sending || !draft.trim()}
                    aria-label="Send message"
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-white transition hover:bg-neutral-800 disabled:opacity-40"
                  >
                    <ArrowUpIcon size={15} />
                  </button>
                </form>
              </>
            ) : null}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-2 text-[12px] text-red-600">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: SuperagentChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
          isUser ? "bg-foreground text-white" : "bg-muted text-foreground"
        }`}
      >
        {message.content}
      </div>
      {message.pr_url && (
        <a
          href={message.pr_url}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-[11.5px] font-medium text-secondary-foreground shadow-primary/10 transition hover:border-foreground hover:text-foreground"
        >
          <PullRequestIcon size={12} />
          View pull request
        </a>
      )}
    </div>
  );
}

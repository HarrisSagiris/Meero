"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, RefreshIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";

type DnsRecord = { type: string; name: string; value: string };

type DomainState = {
  domain: string | null;
  /** Ownership: Vercel accepted this account may use the name. */
  verified: boolean;
  /** Reachability: the domain's DNS does NOT point at Vercel yet. */
  misconfigured: boolean;
  /** Owned AND pointed — the only state that means the site actually serves. */
  live: boolean;
  dns_records: DnsRecord[];
  detected_a: string[];
  detected_cname: string[];
  nameservers: string[];
  conflicts: { name?: string; type?: string; value?: string }[];
  verification: { type?: string; domain?: string; value?: string }[];
  already_added: boolean;
};

const DOMAIN_RE = /^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})+$/;

/**
 * Real custom-domain management via Vercel's Domains API (Pro/Ultra).
 *
 * Two genuinely different real signals drive everything here, and keeping
 * them apart is the point: `verified` is OWNERSHIP (Vercel accepted this
 * account may use the name) and `misconfigured` is REACHABILITY (whether
 * DNS actually points at Vercel). A domain can be verified and still serve
 * nothing, so only `live` (both true) is ever shown as "Live".
 *
 * Every value — including the DNS records to create — comes from Vercel's
 * own API responses for this specific domain, never a hardcoded guess.
 */
export function DomainManager({
  projectId,
  domain: initialDomain,
  verified: initialVerified,
}: {
  projectId: string;
  domain: string | null;
  verified: boolean;
}) {
  const [state, setState] = useState<DomainState | null>(
    initialDomain
      ? {
          domain: initialDomain,
          verified: initialVerified,
          misconfigured: !initialVerified,
          live: initialVerified,
          dns_records: [],
          detected_a: [],
          detected_cname: [],
          nameservers: [],
          conflicts: [],
          verification: [],
          already_added: true,
        }
      : null,
  );
  const [input, setInput] = useState("");
  // Keyed by the domain it describes, so a result for a domain the user has
  // since edited away from is simply ignored during render — no synchronous
  // "clear the stale value" setState needed when the input changes.
  // `data: null` means "checked, nothing to report" (a failed lookup), which
  // is what stops the spinner from hanging forever.
  const [check, setCheck] = useState<{
    domain: string;
    data: DomainState | null;
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = input.trim().toLowerCase();
  const inputValid = DOMAIN_RE.test(trimmed);
  const activeCheck = check?.domain === trimmed ? check.data : null;
  const checking = inputValid && check?.domain !== trimmed;

  const auth = useCallback(async () => {
    const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!base || !session) {
      setError("Session expired — reload and sign in again.");
      return null;
    }
    return {
      base,
      headers: { Authorization: `Bearer ${session.access_token}` },
    };
  }, []);

  const refresh = useCallback(async () => {
    const a = await auth();
    if (!a) return;
    try {
      const res = await fetch(`${a.base}/projects/${projectId}/domain`, {
        headers: a.headers,
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body) setState(body.domain ? body : null);
    } catch {
      // Best-effort refresh — never disrupt the panel.
    }
  }, [auth, projectId]);

  // One effect covers both needs while a domain isn't fully live: fetch the
  // real status immediately (the server-rendered props only carry domain +
  // verified, not the DNS records or what's currently resolving), then keep
  // re-checking, since DNS propagation can take minutes to hours and should
  // flip the panel to Live on its own. A domain that's already live needs
  // neither — there are no instructions left to show.
  useEffect(() => {
    if (!state?.domain || state.live) return;
    const run = () => void refresh();
    const first = setTimeout(run, 0);
    const id = setInterval(run, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [state?.domain, state?.live, refresh]);

  // Pre-add check: as soon as what they've typed looks like a real domain,
  // ask Vercel what its DNS actually looks like right now, so the "how to
  // connect" instructions appear BEFORE committing to it.
  useEffect(() => {
    if (!inputValid || check?.domain === trimmed) return;
    const timer = setTimeout(async () => {
      const a = await auth();
      if (!a) return;
      try {
        const res = await fetch(
          `${a.base}/projects/${projectId}/domain/check?domain=${encodeURIComponent(trimmed)}`,
          { headers: a.headers },
        );
        const body = await res.json().catch(() => null);
        setCheck({ domain: trimmed, data: res.ok && body ? body : null });
      } catch {
        // A failed pre-check just means no preview — Add still works.
        setCheck({ domain: trimmed, data: null });
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [trimmed, inputValid, check?.domain, auth, projectId]);

  async function addDomain() {
    if (!inputValid) return;
    setPending(true);
    setError(null);
    const a = await auth();
    if (!a) {
      setPending(false);
      return;
    }
    try {
      const res = await fetch(`${a.base}/projects/${projectId}/domain`, {
        method: "POST",
        headers: { ...a.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ domain: trimmed }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
      setState(body);
      setInput("");
      setCheck(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add domain.");
    } finally {
      setPending(false);
    }
  }

  async function removeDomain() {
    setPending(true);
    setError(null);
    const a = await auth();
    if (!a) {
      setPending(false);
      return;
    }
    try {
      const res = await fetch(`${a.base}/projects/${projectId}/domain`, {
        method: "DELETE",
        headers: a.headers,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail || `Failed (${res.status})`);
      }
      setState(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove domain.");
    } finally {
      setPending(false);
    }
  }

  if (!state?.domain) {
    return (
      <div className="rounded-xl border border-border bg-muted/50 px-3.5 py-2.5">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
          CUSTOM DOMAIN
        </span>
        <div className="mt-2 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addDomain();
            }}
            placeholder="yourapp.com"
            disabled={pending}
            className="w-full rounded-lg border border-input bg-white px-2.5 py-1.5 text-[13px] outline-none transition focus:border-foreground disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void addDomain()}
            disabled={pending || !inputValid}
            className="shrink-0 rounded-lg bg-foreground px-3 py-1.5 text-[12.5px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
          >
            {pending ? "Adding…" : "Add"}
          </button>
        </div>

        {checking && (
          <p className="mt-2 text-[11px] text-muted-foreground">Checking this domain…</p>
        )}

        {activeCheck && (
          <div className="mt-2.5">
            {activeCheck.already_added ? (
              <p className="text-[11px] text-secondary-foreground">
                This domain is already attached to this project.
              </p>
            ) : activeCheck.misconfigured ? (
              <>
                <p className="text-[11.5px] font-medium text-foreground">
                  Not pointing here yet — add this at your registrar:
                </p>
                <DnsRecords records={activeCheck.dns_records} />
                <DetectedNow state={activeCheck} />
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  You can hit Add now and set DNS after — this panel keeps checking and flips to
                  Live on its own.
                </p>
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-[11.5px] font-medium text-emerald-700">
                <CheckIcon size={12} />
                DNS already points to Vercel — hit Add to connect it.
              </p>
            )}
          </div>
        )}

        {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted/50 px-3.5 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground">
          CUSTOM DOMAIN
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={pending}
            title="Re-check DNS now"
            className="text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            <RefreshIcon size={12} />
          </button>
          <button
            type="button"
            onClick={() => void removeDomain()}
            disabled={pending}
            className="text-[11px] font-medium text-muted-foreground transition hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <span
          className={`size-1.5 shrink-0 rounded-full ${state.live ? "bg-emerald-500" : "bg-primary"}`}
          aria-hidden
        />
        {state.live ? (
          <a
            href={`https://${state.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[13px] font-medium text-foreground underline decoration-input underline-offset-2 hover:decoration-foreground"
          >
            {state.domain}
          </a>
        ) : (
          <span className="truncate text-[13px] font-medium text-foreground">{state.domain}</span>
        )}
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {state.live ? "Live" : "Waiting on DNS"}
        </span>
      </div>

      {!state.live && (
        <div className="mt-2 space-y-1">
          <Step done={state.verified} label="Domain ownership verified" />
          <Step done={!state.misconfigured} label="DNS pointed at Vercel" />
        </div>
      )}

      {!state.live && state.verification.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[11.5px] font-medium text-foreground">
            Add this TXT record to prove you own the domain:
          </p>
          <DnsRecords
            records={state.verification.map((v) => ({
              type: v.type ?? "TXT",
              name: v.domain ?? "",
              value: v.value ?? "",
            }))}
          />
        </div>
      )}

      {!state.live && state.misconfigured && state.dns_records.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[11.5px] font-medium text-foreground">
            Add this record at your registrar to point the domain here:
          </p>
          <DnsRecords records={state.dns_records} />
          <DetectedNow state={state} />
        </div>
      )}

      {state.conflicts.length > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
          Conflicting DNS records are in the way — remove{" "}
          {state.conflicts.map((c) => `${c.type ?? "?"} ${c.name ?? ""}`.trim()).join(", ")} before
          this can go live.
        </p>
      )}

      {!state.live && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          DNS changes can take a few minutes to a few hours. This re-checks every 15 seconds on its
          own.
        </p>
      )}

      {error && <p className="mt-1.5 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`flex size-3.5 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-emerald-500 text-white" : "border border-input bg-white"
        }`}
        aria-hidden
      >
        {done && <CheckIcon size={8} />}
      </span>
      <span
        className={`text-[11.5px] ${done ? "text-secondary-foreground" : "text-muted-foreground"}`}
      >
        {label}
      </span>
    </div>
  );
}

/** What DNS currently resolves to, so the owner can see the real gap
 *  between what's there and what's needed — not just what to add. */
function DetectedNow({ state }: { state: DomainState }) {
  const current = [...state.detected_a, ...state.detected_cname];
  if (current.length === 0) return null;
  return (
    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
      Currently resolves to{" "}
      <span className="font-mono text-secondary-foreground">{current.join(", ")}</span>
      {" — replace it with the record above."}
    </p>
  );
}

function DnsRecords({ records }: { records: DnsRecord[] }) {
  if (records.length === 0) return null;
  return (
    <div className="mt-1.5 space-y-1.5">
      {records.map((r, i) => (
        <div key={`${r.type}-${r.name}-${i}`} className="rounded-lg bg-white p-2 text-[11px]">
          <div className="flex items-center gap-3">
            <Field label="Type" value={r.type} />
            <Field label="Name" value={r.name} />
          </div>
          <div className="mt-1 flex items-end gap-1.5">
            <Field label="Value" value={r.value} wrap />
            <CopyButton value={r.value} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, wrap }: { label: string; value: string; wrap?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
      <p className={`font-mono text-[11px] text-foreground ${wrap ? "break-all" : "truncate"}`}>
        {value}
      </p>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard can be blocked — the value is visible to select by hand.
        }
      }}
      className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-secondary-foreground transition hover:border-foreground hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, type ReactNode } from "react";
import {
  createCheckoutSession,
  createCreditsCheckout,
  openBillingPortal,
} from "@/modules/billing/actions/billing-actions";
import { updateDisplayName } from "@/modules/account/actions/profile-actions";
import { signOut } from "@/modules/auth/actions/auth-actions";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  GithubIcon,
  LogOutIcon,
  SupabaseIcon,
} from "@/components/icons";
import { UsageBar } from "@/modules/account/views/ui/usage-bar";
import { formatTokens } from "@/lib/format";
import { LiveTime } from "@/components/ui/live-time";
import { PLAN_CARDS, PLAN_LABEL, PLAN_RANK } from "@/modules/billing/utils/plans";
import { PLAN_CREDIT_LIMITS } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import type { SettingsProfile } from "@/modules/account/utils/types";
import type { Profile } from "@/lib/types";

/**
 * Starts a real account-level OAuth connect (no project in scope) —
 * app/main.py's /auth/{provider}/authorize accepts an optional project_id
 * precisely for this. Mirrors github-button.tsx / supabase-button.tsx's own
 * authHeader()+connect(), minus the project_id they always pass.
 */
async function startAccountConnect(provider: "github" | "supabase"): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!base) return "Orchestrator is not configured (NEXT_PUBLIC_ORCHESTRATOR_URL).";
  if (!session) return "Session expired — reload and sign in again.";

  try {
    const res = await fetch(`${base}/auth/${provider}/authorize`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.detail || `Failed (${res.status})`);
    window.location.href = body.url;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : `Could not start ${provider} connect.`;
  }
}

export type SettingsPageProfile = SettingsProfile & {
  avatar_url: string | null;
  github_username: string | null;
  supabase_connected: boolean;
};

type Section = "overview" | "billing" | "credits" | "github" | "supabase";

const SECTIONS: Section[] = ["overview", "billing", "credits", "github", "supabase"];

function resolveSection(raw: string | undefined): Section {
  if (raw && (SECTIONS as string[]).includes(raw)) return raw as Section;
  return "overview";
}

function memberSince(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function SettingsPageView({
  profile,
  initialSection,
  githubStatus,
  supabaseStatus,
}: {
  profile: SettingsPageProfile;
  initialSection?: string;
  githubStatus?: string;
  supabaseStatus?: string;
}) {
  const router = useRouter();
  const [section, setSectionState] = useState<Section>(resolveSection(initialSection));

  function goTo(next: Section) {
    setSectionState(next);
    router.replace(`/settings?section=${next}`, { scroll: false });
  }

  return (
    <div className="flex min-h-[100dvh] w-full">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-white px-4 py-6">
        <Link
          href="/"
          className="mb-5 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeftIcon size={14} />
          Home
        </Link>

        <h1 className="text-xl font-bold tracking-tight text-foreground">Settings</h1>

        <nav className="mt-7 flex-1 space-y-6">
          <NavGroup label="GENERAL">
            <NavItem active={section === "overview"} onClick={() => goTo("overview")}>
              Overview
            </NavItem>
          </NavGroup>

          <NavGroup label="BILLING">
            <NavItem active={section === "billing"} onClick={() => goTo("billing")}>
              Plan &amp; billing
            </NavItem>
            <NavItem active={section === "credits"} onClick={() => goTo("credits")}>
              Credit usage
            </NavItem>
          </NavGroup>

          <NavGroup label="CONNECTIONS">
            <NavItem active={section === "github"} onClick={() => goTo("github")}>
              GitHub
            </NavItem>
            <NavItem active={section === "supabase"} onClick={() => goTo("supabase")}>
              Supabase
            </NavItem>
          </NavGroup>
        </nav>

        <div className="mt-6 flex items-center gap-2.5 rounded-xl border border-border px-2.5 py-2.5">
          <span className="meero-mark flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold text-white">
            {(profile.display_name || profile.email).charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold text-foreground">
              {profile.display_name || profile.email}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{profile.email}</p>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              aria-label="Sign out"
              title="Sign out"
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <LogOutIcon size={14} />
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto bg-muted/30 px-8 py-10">
        <div className="mx-auto max-w-3xl">
          {section === "overview" && <OverviewSection profile={profile} onJump={goTo} />}
          {section === "billing" && <BillingSection profile={profile} />}
          {section === "credits" && <CreditsSection profile={profile} />}
          {section === "github" && <GithubSection profile={profile} status={githubStatus} />}
          {section === "supabase" && <SupabaseSection profile={profile} status={supabaseStatus} />}
        </div>
      </main>
    </div>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[13.5px] font-medium transition ${
        active
          ? "bg-muted text-foreground"
          : "text-secondary-foreground hover:bg-muted/70 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-7">
      <h2 className="text-[26px] font-bold tracking-tight text-foreground">{title}</h2>
      <p className="mt-1 text-[14px] text-secondary-foreground">{description}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  caption,
  onJump,
}: {
  label: string;
  value: string;
  caption?: string;
  onJump?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-white p-4">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
        {onJump && (
          <button
            type="button"
            onClick={onJump}
            aria-label={`Go to ${label}`}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <ExternalLinkIcon size={13} />
          </button>
        )}
      </div>
      <p className="mt-2 text-[22px] font-bold tracking-tight text-foreground">{value}</p>
      {caption && <p className="mt-0.5 text-[12px] text-muted-foreground">{caption}</p>}
    </div>
  );
}

function OverviewSection({
  profile,
  onJump,
}: {
  profile: SettingsPageProfile;
  onJump: (s: Section) => void;
}) {
  const [state, formAction, pending] = useActionState(updateDisplayName, {});
  const limit = PLAN_CREDIT_LIMITS[profile.plan];
  const connectedCount = (profile.github_username ? 1 : 0) + (profile.supabase_connected ? 1 : 0);
  const initial = (profile.display_name || profile.email).charAt(0).toUpperCase();

  return (
    <>
      <SectionHeader title="Overview" description="Manage your account details and settings." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Plan" value={PLAN_LABEL[profile.plan]} onJump={() => onJump("billing")} />
        <StatCard
          label="Credits this week"
          value={formatTokens(profile.credits_remaining)}
          caption={`of ${formatTokens(limit)} left`}
          onJump={() => onJump("credits")}
        />
        <StatCard
          label="Connections"
          value={`${connectedCount}/2`}
          caption="GitHub & Supabase"
          onJump={() => onJump("github")}
        />
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-white p-5">
        <p className="mb-4 text-[13px] font-semibold text-foreground">General</p>

        <div className="flex items-center gap-4">
          <span className="meero-mark flex size-14 shrink-0 items-center justify-center rounded-2xl text-xl font-semibold text-white">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-foreground">
              {profile.display_name || profile.email}
            </p>
            <p className="truncate text-[13px] text-muted-foreground">
              Member since {memberSince(profile.created_at)}
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-5 border-t border-border pt-5 sm:grid-cols-2">
          <div>
            <label
              htmlFor="settings-email"
              className="mb-1.5 block text-[12px] font-medium text-secondary-foreground"
            >
              Email
            </label>
            <input
              id="settings-email"
              value={profile.email}
              disabled
              className="w-full rounded-xl border border-border bg-muted px-3.5 py-2.5 text-[14px] text-secondary-foreground"
            />
          </div>

          <form action={formAction}>
            <label
              htmlFor="settings-name"
              className="mb-1.5 block text-[12px] font-medium text-secondary-foreground"
            >
              Display name
            </label>
            <div className="flex gap-2">
              <input
                id="settings-name"
                name="displayName"
                defaultValue={profile.display_name ?? ""}
                maxLength={80}
                required
                className="w-full rounded-xl border border-input bg-white px-3.5 py-2.5 text-[14px] outline-none transition focus:border-foreground"
              />
              <button
                type="submit"
                disabled={pending}
                className="shrink-0 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
            {state.error && <p className="mt-2 text-[12px] text-red-600">{state.error}</p>}
            {state.saved && <p className="mt-2 text-[12px] text-emerald-700">Saved.</p>}
          </form>
        </div>
      </div>
    </>
  );
}

function ManageBillingButton() {
  const [state, formAction, pending] = useActionState(openBillingPortal, {});
  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-border bg-white px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-muted disabled:opacity-50"
      >
        {pending ? "Opening…" : "Manage billing"}
      </button>
      {state.error && <p className="mt-2 text-[11px] text-red-600">{state.error}</p>}
    </form>
  );
}

function UpgradeButton({
  plan,
  currentPlan,
}: {
  plan: "pro" | "ultra";
  currentPlan: Profile["plan"];
}) {
  const [state, formAction, pending] = useActionState(createCheckoutSession, {});
  const isDowngrade = PLAN_RANK[plan] < PLAN_RANK[currentPlan];
  const label = `${isDowngrade ? "Downgrade" : "Upgrade"} to ${PLAN_LABEL[plan]}`;
  return (
    <form action={formAction}>
      <input type="hidden" name="plan" value={plan} />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-foreground px-3 py-2 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Redirecting…" : label}
      </button>
      {state.error && <p className="mt-2 text-[11px] text-red-600">{state.error}</p>}
    </form>
  );
}

function BuyTokensButton() {
  const [state, formAction, pending] = useActionState(createCreditsCheckout, {});
  return (
    <form action={formAction}>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-foreground px-3 py-2 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Redirecting…" : "Buy 250,000 tokens — $5"}
      </button>
      {state.error && <p className="mt-2 text-[11px] text-red-600">{state.error}</p>}
    </form>
  );
}

function CheckDot() {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
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
  );
}

function BillingSection({ profile }: { profile: SettingsPageProfile }) {
  const limit = PLAN_CREDIT_LIMITS[profile.plan];

  return (
    <>
      <SectionHeader
        title="Plan & billing"
        description="What each plan includes, and how to change yours."
      />

      <div className="rounded-2xl border border-border bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
              Current plan
            </p>
            <p className="mt-0.5 text-[19px] font-semibold tracking-tight text-foreground">
              {PLAN_LABEL[profile.plan]}
            </p>
          </div>
          {profile.stripe_customer_id && <ManageBillingButton />}
        </div>

        <div className="mt-5">
          <UsageBar remaining={profile.credits_remaining} limit={limit} size="lg" />
        </div>
        <p className="mt-2.5 text-[12px] text-muted-foreground">
          Resets in <LiveTime iso={profile.credits_reset_at} kind="until" />
          {profile.bonus_credits > 0 && (
            <>
              {" "}
              ·{" "}
              <span className="font-medium text-secondary-foreground">
                {formatTokens(profile.bonus_credits)} bonus tokens
              </span>{" "}
              (never expire, used after your weekly allowance)
            </>
          )}
        </p>
      </div>

      <div className="mt-6">
        <p className="mb-3 text-[12px] font-semibold tracking-wide text-muted-foreground">PLANS</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {PLAN_CARDS.map((card) => {
            const isCurrent = card.plan === profile.plan;
            return (
              <div
                key={card.plan}
                className={`flex flex-col rounded-2xl border p-5 ${
                  isCurrent ? "border-foreground shadow-primary/10" : "border-border bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-foreground">
                    {PLAN_LABEL[card.plan]}
                  </p>
                  {isCurrent && (
                    <span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold text-white">
                      CURRENT
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[24px] font-bold tracking-tight text-foreground">
                  {card.price}
                  <span className="text-[13px] font-medium text-muted-foreground">
                    {" "}
                    {card.period}
                  </span>
                </p>
                <p className="mt-1 text-[12px] text-muted-foreground">{card.tagline}</p>

                <ul className="mt-5 flex-1 space-y-2.5 text-[12.5px] text-secondary-foreground">
                  <li className="flex items-center gap-2">
                    <CheckDot />
                    {formatTokens(PLAN_CREDIT_LIMITS[card.plan])} tokens / week
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckDot />
                    {card.model}
                  </li>
                  {card.features.map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckDot />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-5">
                  {isCurrent ? (
                    <span className="block rounded-lg border border-border bg-muted/60 px-3 py-2 text-center text-[12.5px] font-medium text-muted-foreground">
                      Your current plan
                    </span>
                  ) : card.plan === "free" ? (
                    <span className="block rounded-lg px-3 py-2 text-center text-[12.5px] text-muted-foreground">
                      Downgrade from account settings
                    </span>
                  ) : (
                    <UpgradeButton plan={card.plan as "pro" | "ultra"} currentPlan={profile.plan} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function CreditsSection({ profile }: { profile: SettingsPageProfile }) {
  const limit = PLAN_CREDIT_LIMITS[profile.plan];

  return (
    <>
      <SectionHeader
        title="Credit usage"
        description="How weekly token budgets work, and when they refresh."
      />

      <div className="rounded-2xl border border-border bg-white p-5">
        <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
          This week&apos;s allowance
        </p>
        <div className="mt-3">
          <UsageBar remaining={profile.credits_remaining} limit={limit} size="lg" />
        </div>
        <p className="mt-2.5 text-[12px] text-muted-foreground">
          Resets <LiveTime iso={profile.credits_reset_at} kind="until" /> from now — every Sunday at
          00:00 UTC.
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[12px] font-medium tracking-wide text-muted-foreground uppercase">
              Bonus tokens
            </p>
            <p className="mt-0.5 text-[19px] font-semibold tracking-tight text-foreground">
              {formatTokens(profile.bonus_credits)}
            </p>
            <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
              Never expire — spent only after your weekly allowance runs out. Buy a one-time top-up
              any time.
            </p>
          </div>
          <BuyTokensButton />
        </div>
      </div>
    </>
  );
}

function StatusBanner({ status }: { status?: string }) {
  if (status !== "connected" && status !== "error") return null;
  const ok = status === "connected";
  return (
    <div
      role="alert"
      className={`mb-4 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium ${
        ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      {ok ? "Connected." : "Something went wrong connecting — try again."}
    </div>
  );
}

function GithubSection({ profile, status }: { profile: SettingsPageProfile; status?: string }) {
  const connected = !!profile.github_username;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setPending(true);
    setError(null);
    const err = await startAccountConnect("github");
    if (err) setError(err);
    setPending(false);
  }

  return (
    <>
      <SectionHeader
        title="GitHub"
        description="Where your build history can live as real commits."
      />
      <StatusBanner status={status} />

      <div className="rounded-2xl border border-border bg-white p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <GithubIcon size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-foreground">
              {connected ? `Connected as @${profile.github_username}` : "Not connected"}
            </p>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {connected
                ? "Every project you publish commits straight to its repo's main branch — publish from any project's Connections tab, no need to reconnect."
                : "Connect once here — every project can then publish to GitHub from its own Connections tab without asking again."}
            </p>
          </div>
          {connected ? (
            <a
              href={`https://github.com/${profile.github_username}`}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[13px] font-medium text-foreground transition hover:bg-muted"
            >
              View profile
              <ExternalLinkIcon size={13} />
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={pending}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {pending ? "Redirecting…" : "Connect GitHub"}
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
      </div>
    </>
  );
}

function SupabaseSection({ profile, status }: { profile: SettingsPageProfile; status?: string }) {
  const connected = profile.supabase_connected;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setPending(true);
    setError(null);
    const err = await startAccountConnect("supabase");
    if (err) setError(err);
    setPending(false);
  }

  return (
    <>
      <SectionHeader title="Supabase" description="The real backend every generated app runs on." />
      <StatusBanner status={status} />

      <div className="rounded-2xl border border-border bg-white p-5">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <SupabaseIcon size={18} className={connected ? "text-emerald-600" : undefined} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-foreground">
              {connected ? "Connected" : "Not connected"}
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {connected
                ? "Your account is linked. Each new project still gets its own dedicated Supabase project from its own Connections tab, without asking to reconnect."
                : "Connect once here — Meero can then create and link a real Supabase project for any new app automatically, no repeat sign-in."}
            </p>
          </div>
          {!connected && (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={pending}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
            >
              {pending ? "Redirecting…" : "Connect Supabase"}
            </button>
          )}
        </div>
        {error && <p className="mt-3 text-[12px] text-red-600">{error}</p>}
      </div>
    </>
  );
}

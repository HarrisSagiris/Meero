/** Row types mirroring supabase/migrations/00001_init.sql */

// Every build is the same thing now: a real, secure, self-contained web
// application. The value is kept as a distinct type (rather than removed)
// since historical rows from before the pivot may still carry "scene" (and
// older ones "ios" | "android" | "expo").
export type BuildPlatform = "web";

export type BuildStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type Plan = "free" | "pro" | "ultra";

// Weekly TOKEN budgets — kept in sync with plan_daily_tokens() in
// supabase/migrations/00010_token_billing.sql. The allowance refreshes every
// Sunday at 00:00 UTC (see 00012_weekly_token_reset.sql). Credits are a token
// allowance (chat deducts real tokens; builds deduct a flat cost), not an
// interaction count.
export const PLAN_CREDIT_LIMITS: Record<Plan, number> = {
  free: 100000,
  pro: 2000000,
  ultra: 10000000,
};

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  plan: Plan;
  credits_remaining: number;
  credits_reset_at: string;
  /** Real, non-expiring credits from a one-time purchase — spent only
   *  after the weekly plan allowance runs out. */
  bonus_credits: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_subscription_status: string | null;
  /** Set once the user connects their GitHub account (OAuth). */
  github_username: string | null;
  /** True once the user connects their own Supabase account (OAuth) —
   *  the backend every generated app runs against. */
  supabase_connected: boolean;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  is_starred: boolean;
  /** Free-plan projects are ALWAYS true (DB-enforced, see
   *  00015_marketplace.sql) — Pro/Ultra default false, opt-in. Public
   *  projects are readable by any signed-in user and clonable from the
   *  marketplace. */
  is_public: boolean;
  /** Set if this project was created via a marketplace clone. */
  clone_of: string | null;
  /** Set once this project has been published to a real GitHub repo. */
  github_repo_full_name: string | null;
  github_repo_url: string | null;
  /** Real screenshot of the project's live preview, captured by the web
   *  worker after a successful build of a public project (00020). Null
   *  until the first successful public build. */
  screenshot_url: string | null;
  /** Real, LLM-generated short title for the public gallery
   *  (src/components/landing/public-gallery.tsx) — written only by the
   *  orchestrator (00043_project_display_title.sql). Null until generated;
   *  the gallery falls back to `name` (the raw-prompt-derived one) until
   *  then. Never shown anywhere else — `name` stays the real, owner-
   *  editable project name. */
  display_title: string | null;
  /** Which of the owner's own Supabase projects this app builds against —
   *  its real database + auth. Written only by the orchestrator after a
   *  real Management API call confirmed them (00017_byo_supabase.sql).
   *  The anon key is public by design (it ships in the served bundle). */
  supabase_project_ref: string | null;
  supabase_url: string | null;
  supabase_anon_key: string | null;
  /** Real in-flight auto-provisioning state for a brand-new Supabase
   *  project the orchestrator is creating on the owner's behalf so
   *  connecting an account is the only step (00045_supabase_auto_provision.sql).
   *  Null once `supabase_project_ref` is set (or if nothing was ever
   *  auto-provisioned) — `'provisioning'` while the background poller
   *  waits for it to come ACTIVE, `'failed'` with a real error in
   *  `supabase_provisioning_error` if it never did. */
  supabase_provisioning_status: "provisioning" | "failed" | null;
  supabase_provisioning_error: string | null;
  /** The project's most recent REAL Vercel production release URL —
   *  written only by the orchestrator after Vercel reports READY
   *  (trigger-protected, see 00016_web_pivot.sql). */
  live_url: string | null;
  /** A real custom domain attached via Vercel's Domains API
   *  (00026_custom_domains.sql) — null until the owner adds one.
   *  `custom_domain_verified` is only true once Vercel's own DNS
   *  verification actually passed, never optimistically. */
  custom_domain: string | null;
  custom_domain_verified: boolean;
  /** Solo mode (default) builds the moment the chat agent decides the app
   *  is ready; Manual mode parks it on `pending_build_spec_id` and waits
   *  for a real "Approve build" click instead (00028_autonomy_mode.sql). */
  autonomy_mode: "solo" | "manual";
  pending_build_spec_id: string | null;
  /** Off by default (00042_conversion_agent.sql) — gates the orchestrator's
   *  conversion-detection/experiment loop only (app/conversion_agent.py).
   *  The behavior tracker every generated app ships always records
   *  regardless of this flag, exactly like the error reporter does. */
  conversion_agent_enabled: boolean;
  /** Pro/Ultra-only choice of which model builds this project's code
   *  (00048_project_model_preference.sql) — null means the plan default
   *  (codegen_worker.py's model_for_plan()). The DB layer forces this back
   *  to null for free-plan projects regardless of what's written here,
   *  same "product rule enforced for every role" pattern as is_public. */
  preferred_model: "claude-sonnet-5" | "gpt-5.6-terra" | null;
  created_at: string;
  updated_at: string;
}

export interface SpecAttachment {
  path: string;
  name: string;
}

export interface Spec {
  id: string;
  project_id: string;
  version: number;
  prompt: string;
  parsed_spec: Record<string, unknown> | null;
  attachments: SpecAttachment[];
  created_by: string;
  created_at: string;
}

export interface Message {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  spec_version: number | null;
  created_at: string;
}

export interface Build {
  id: string;
  project_id: string;
  spec_id: string;
  platform: BuildPlatform;
  status: BuildStatus;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  worker_id: string | null;
  log_url: string | null;
  error: string | null;
  /** The live app's own URL (served through the orchestrator's /preview
   *  proxy) — the user's real generated code, iframed directly. */
  preview_url: string | null;
  /** The real Vercel production URL, set only after the Ultra-only release
   *  action genuinely succeeds. */
  deploy_url: string | null;
  /** Set when this build is Meero's one automatic AI fix attempt after
   *  `retry_of` genuinely failed to bundle — never a mock retry. */
  retry_of: string | null;
  /** Set when this build's source was copied from an EARLIER succeeded
   *  build via the version-history "Restore" action
   *  (00030_build_rollback.sql) rather than freshly generated — a real
   *  rebuild of old source, not a pointer flip. */
  restored_from: string | null;
  /** True when this fix build was triggered by a captured PRODUCTION
   *  runtime error (00021_runtime_auto_fix.sql) rather than a build/compile
   *  failure — ships as a reviewable GitHub PR instead of a commit to main. */
  is_runtime_fix?: boolean;
  /** True when this build launched, graduated, or reverted a client-bucketed
   *  A/B experiment (00042_conversion_agent.sql) — see
   *  app/conversion_agent.py. Always commits straight to main, never a PR
   *  (an experiment must actually be live to collect data). */
  is_conversion_experiment?: boolean;
  conversion_experiment_id?: string | null;
  /** Real, just-run "is your app ready?" checklist (00022_readiness_checks.sql)
   *  — see app/readiness_check.py. Null until the first successful build. */
  readiness_checks?: ReadinessCheck[] | null;
  /** The growing partial AppPlan straight from the planner LLM's own
   *  structured-output stream (00046_build_plan_preview.sql) — written on
   *  every chunk by codegen_worker.py's on_plan callback, including the
   *  last (the complete, final plan), so a page refresh at any point
   *  during planning or generation still shows real plan content instead
   *  of nothing. Shape matches LivePlan in project-activity-context.tsx
   *  (title/summary/views/auth/tables/design/security/mood, every field
   *  optional since it fills in progressively). Null before planning
   *  starts. */
  plan_preview?: Record<string, unknown> | null;
  /** Plain-English "what was wrong, what changed" for a fix build
   *  (00025_targeted_fix.sql) — see codegen.py's FixResult — or for a normal
   *  chat iteration grounded in the app's previous code (codegen_worker.py's
   *  generate_project(..., previous_files=...) path). Null on a first
   *  generation (nothing to diff against) or a build that never needed a fix. */
  fix_explanation?: string | null;
  /** Real diff of what a build actually changed — see codegen.py's
   *  diff_files. `targeted: true` means only changed_paths were sent to
   *  and regenerated by the model; every other file was carried forward
   *  byte-for-byte, never touched. */
  fix_diff?: {
    targeted: boolean;
    changed_paths: string[];
    diffs: Record<string, string>;
  } | null;
}

export type ReadinessCheck = {
  key: string;
  label: string;
  passed: boolean | null;
  detail?: string | null;
};

/** One DETECTED conversion issue (dead clicks, CTA below fold, form
 *  abandonment, funnel drop-off, device gap, high bounce, exit page, ...),
 *  mirrored from supabase/migrations/00042_conversion_agent.sql +
 *  00044_conversion_kpis.sql. Written only by the orchestrator's conversion
 *  agent (app/conversion_agent.py); a hypothesis may or may not ever become
 *  an experiment (see status). */
export interface ConversionHypothesis {
  id: string;
  project_id: string;
  issue_type:
    | "cta_below_fold"
    | "low_ctr"
    | "dead_click"
    | "rage_click"
    | "form_abandonment"
    | "pricing_drop_off"
    | "signup_drop_off"
    | "device_gap"
    | "high_bounce"
    | "exit_page";
  page_path: string;
  element_selector: string | null;
  description: string;
  proposed_fix: string;
  evidence: Record<string, unknown>;
  status: "open" | "dismissed" | "experimenting" | "resolved";
  created_at: string;
  updated_at: string;
}

/** One LAUNCHED client-bucketed A/B experiment, mirrored from
 *  supabase/migrations/00042_conversion_agent.sql. `experiment_key` matches
 *  the value the launch build writes into `_meero_behavior_events` on the
 *  app owner's OWN Supabase — never a literal foreign key, since the two
 *  databases are different Postgres instances. */
export interface ConversionExperiment {
  id: string;
  project_id: string;
  hypothesis_id: string;
  experiment_key: string;
  goal_event: string;
  launch_build_id: string | null;
  graduation_build_id: string | null;
  status: "running" | "winner_a" | "winner_b" | "inconclusive" | "reverted";
  started_at: string;
  decided_at: string | null;
}

/** One EVALUATION pass of a running experiment (several accumulate before a
 *  final decision — a real audit trail of the significance math, never a
 *  single overwritten "current" row), mirrored from
 *  supabase/migrations/00042_conversion_agent.sql. ci_low_pct/ci_high_pct
 *  (00044_conversion_kpis.sql) are the real 95% confidence interval around
 *  lift_pct — see orchestrator/app/conversion_agent.py's
 *  _lift_confidence_interval. */
export interface ConversionResult {
  id: string;
  experiment_id: string;
  exposures_a: number;
  exposures_b: number;
  conversions_a: number;
  conversions_b: number;
  p_value: number | null;
  lift_pct: number | null;
  ci_low_pct: number | null;
  ci_high_pct: number | null;
  decision: "continue" | "winner_a" | "winner_b" | "inconclusive";
  evaluated_at: string;
}

/** Singleton row, mirrored from supabase/migrations/00019_admin_signup_cap.sql.
 *  World-readable; only the one admin account (RLS-checked by email) can
 *  write it via the /admin dashboard. */
export interface AppSettings {
  id: true;
  /** null = unlimited. Enforced in the handle_new_user() trigger, not just
   *  the UI, so it holds regardless of how a signup happens. */
  signup_cap: number | null;
  updated_at: string;
}

/** Mirrored from supabase/migrations/00031_news_posts.sql. World-readable
 *  when `published`; only the one admin account (RLS-checked by email) can
 *  write it via the /admin dashboard. Shown as a top announcement bar
 *  (news-bar.tsx) and listed at /news. */
export interface NewsPost {
  id: string;
  slug: string;
  title: string;
  body: string;
  published: boolean;
  /** Public Storage object URL (00032_news_images.sql) — optional. */
  image_url: string | null;
  created_at: string;
  updated_at: string;
}

/** Mirrored from supabase/migrations/00047_creator_referrals.sql. The link
 *  itself — meero.im/{slug} — minted by the one admin account via
 *  /admin. Click/signup counts are read separately from
 *  creator_referral_events, not stored on this row. */
export interface CreatorReferral {
  id: string;
  slug: string;
  creator_name: string;
  active: boolean;
  created_at: string;
}

/** One generated source file, mirrored from supabase 00006_build_files.sql.
 *  Written only by the orchestrator; read-only (RLS) to the project owner. */
export interface BuildFile {
  id: string;
  build_id: string;
  project_id: string;
  path: string;
  content: string;
  language: string | null;
  seq: number;
  created_at: string;
}

export interface BuildArtifact {
  id: string;
  build_id: string;
  kind: "source_archive" | "web_bundle" | "deployment" | "log";
  storage_path: string;
  size_bytes: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Ultra-only Vercel release progress, pushed over the same WebSocket as
 *  build events but under a distinct type (`build.deploy_phase`) since a
 *  release never changes whether the base build succeeded. */
export type DeployPhase = "deploying" | "succeeded" | "failed";

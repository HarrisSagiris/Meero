from functools import lru_cache
from typing import Literal

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# The real production domains — meero.im for the frontend, its api.
# subdomain for the orchestrator (a long-running Python/Redis service, so
# it needs its own host — Vercel doesn't run it). Change these two lines if
# the domain ever changes; every derived URL below follows automatically.
PROD_FRONTEND_URL = "https://meero.im"
PROD_API_URL = "https://api.meero.im"


class Settings(BaseSettings):
    """Orchestrator configuration. Loaded from env / orchestrator/.env.

    Single-flag environment switch: set APP_ENV=prod (vs the default
    "local") and every *_url / allowed_origins field below that's left
    BLANK auto-derives the real meero.im / api.meero.im value instead of
    the localhost one — see `_derive_env_urls()`. Set any one of them
    explicitly in .env to override just that field regardless of APP_ENV
    (e.g. a staging domain) — blank is what opts a field into the
    APP_ENV-driven default.
    """

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # The single flag. "local" (the default) keeps every URL below on
    # localhost; "prod" switches all of them to the real meero.im domain
    # in one move — see the docstring above.
    app_env: Literal["local", "prod"] = "local"

    # Supabase — service role key bypasses RLS; this process is trusted infra.
    supabase_url: str
    supabase_service_role_key: str

    # Codegen + chat model — free-plan users stay on OpenAI's cheap model
    # (openai_model_free); Pro/Ultra now get Claude Sonnet via Anthropic
    # (owner decision, 2026-08-09, superseding the earlier all-OpenAI choice
    # from 2026-07-16 — see app/agent/codegen.py's llm(), which dispatches
    # to ChatOpenAI vs ChatAnthropic purely by which model string
    # model_for_plan() hands back, so this is the only place plan→model
    # routing lives). openai_model is llm()'s own safety-net default when no
    # model is explicitly passed in (should not happen in practice — every
    # real call site passes one) AND the model a Pro/Ultra owner gets when
    # they pick "GPT-5.6 Terra" in the composer's model selector
    # (00048_project_model_preference.sql) instead of the Claude default.
    openai_api_key: str = ""
    openai_model: str = "gpt-5.6-terra"
    # gpt-5.6-luna is the budget tier of the GPT-5.6 family — the real cheap
    # sibling of gpt-5.6-terra, used for every free-plan build/chat.
    openai_model_free: str = "gpt-5.6-luna"

    # Anthropic — Pro/Ultra's real codegen + chat model. Blank default, same
    # "not required unless actually used" convention as openai_api_key (a
    # context like deploy_worker.py that never calls any LLM doesn't need
    # it either).
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-5"

    # Infra
    redis_url: str = "redis://localhost:6379/0"
    artifacts_bucket: str = "artifacts"
    # Stuck-build reaper (crash-safety backstop for the at-most-once queue).
    # A build "running" past this long, or "queued" without a worker past this
    # long, is failed with a retry message. Keep running_timeout comfortably
    # above the worker's realistic max per-build wall-clock so a slow-but-alive
    # build is never reaped.
    build_running_timeout_s: int = 3600
    build_queued_timeout_s: int = 1800
    reaper_interval_s: int = 120
    # PUBLIC bucket the web worker uploads the built Next.js static export
    # to; the builder iframes previews/<build_id>/index.html through the
    # /preview proxy. Must be public-read.
    previews_bucket: str = "previews"
    # PUBLIC bucket for project screenshots (see 00020_project_screenshots.sql)
    # — served directly from Storage's own public object URL (images don't
    # hit the text/html-mangling behavior that forces /preview to proxy).
    screenshots_bucket: str = "screenshots"
    workspace_dir: str = "./workspace"
    # Blank = derive from app_env (see _derive_env_urls below): localhost
    # locally, the real meero.im / api.meero.im domain in prod.
    allowed_origins: str = ""
    frontend_url: str = ""
    # This orchestrator's own PUBLIC base URL, as reachable from a user's
    # browser — same value as the frontend's NEXT_PUBLIC_ORCHESTRATOR_URL.
    # Used to build absolute preview URLs (app/main.py's /preview route).
    public_base_url: str = ""
    # How the web worker's OWN container reaches the /preview route it just
    # published, to screenshot it — the docker-compose internal service
    # address (http://api:8000), NOT public_base_url: "localhost" inside the
    # web-worker container isn't the api container, and round-tripping
    # through the public domain/nginx for a same-host request is pointless.
    orchestrator_internal_url: str = "http://api:8000"

    # Real Next.js build — the web worker runs `next build` (static export)
    # against the LLM-generated app/, components/, lib/ source. Generated
    # apps may import only the vendored toolchain (Next, React, the
    # shadcn/ui Radix primitives, lucide-react, and @supabase/supabase-js —
    # their whole backend: the user's own linked Supabase), installed once
    # at image-build time into app_vendor_dir; no npm install ever runs per
    # build, and nothing else is installed, so that pinned set is the
    # app's entire supply chain.
    node_bin: str = "node"
    npm_bin: str = "npm"
    # Directory containing the worker's own node_modules (Next/React/
    # Tailwind/shadcn deps/@supabase/supabase-js pre-installed) that
    # generated apps build against.
    app_vendor_dir: str = "./vendor/app"
    # How long a real `next build` may run before it's treated as a hung
    # build and failed.
    build_timeout_s: int = 600
    # How long a single OpenAI call (plan/generate/fix) may run before it's
    # treated as hung and fails just that one build. codegen-worker runs a
    # single-replica blocking loop (one job at a time) with no other
    # backstop — an unbounded LLM call (the SDK's own default is ~10
    # minutes) would freeze EVERY other user's build behind it, not just
    # the one that's actually slow.
    openai_timeout_s: float = 300.0

    # Supabase connect — a registered Supabase OAuth App (supabase.com →
    # org settings → OAuth Apps). Users connect their OWN Supabase account;
    # Meero then lists their projects, links one per Meero project, and
    # applies each build's generated schema.sql to it via the real
    # Management API. Blank = clear 503 from the connect endpoints.
    supabase_oauth_client_id: str = ""
    supabase_oauth_client_secret: str = ""
    # Blank = derive from app_env. Must exactly match the callback URL
    # registered on the Supabase OAuth App itself (an external dashboard
    # setting APP_ENV can't reach — update it by hand when you flip to prod).
    supabase_oauth_redirect_uri: str = ""

    # Real Vercel deployments — the ultra-only "Release to production" action
    # ships the EXACT bundle the live preview serves through Vercel's actual
    # REST API (create deployment → poll until READY). Leave the token blank
    # to run without this feature — the deploy endpoint reports a clear 503
    # instead of silently pretending to release.
    vercel_token: str = ""
    # Optional: deploy into a Vercel team instead of the token's personal scope.
    vercel_team_id: str = ""
    # How long the deploy worker waits for Vercel to reach READY before
    # reporting a real timeout failure.
    deploy_timeout_s: int = 600

    # Stripe billing — leave blank to run without billing enabled; the
    # billing endpoints report a clear 503 instead of failing at import.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_pro: str = ""
    stripe_price_ultra: str = ""
    # One-time credit top-up (real $5 Stripe Price, mode=payment) — real
    # bonus credits, added via profiles.bonus_credits (00009_credit_topups.sql).
    stripe_price_credits_topup: str = ""
    # Blank = derive from app_env.
    billing_success_url: str = ""
    billing_cancel_url: str = ""
    billing_portal_return_url: str = ""

    # GitHub publish — a per-user OAuth App. Users connect their own GitHub
    # account; Meero then creates a real repo on their account, pushes the
    # initial commit, and opens a REAL pull request for every later
    # successful build (branch → commit → PR via the Git Data API).
    github_oauth_client_id: str = ""
    github_oauth_client_secret: str = ""
    # Blank = derive from app_env. Must exactly match the callback URL
    # registered on the GitHub OAuth App itself (an external dashboard
    # setting APP_ENV can't reach — update it by hand when you flip to prod).
    github_oauth_redirect_uri: str = ""
    # Every commit's author/committer identity (owner decision, 2026-07-28):
    # commits and PRs always show as "Meero", never the connected user's own
    # GitHub name, even though they're pushed with the user's own OAuth
    # token. This is a real, cosmetic-only commit field GitHub always
    # respects — it does NOT make "Meero" a real GitHub actor: PR/comment
    # @mentions and automated reviews need an actual GitHub App (its own
    # bot identity, logo, and a webhook endpoint), which requires a human to
    # register the app on github.com first — see github_publish.py's
    # module docstring for what's real today vs. what that would need.
    github_bot_name: str = "Meero"
    github_bot_email: str = "bot@meero.dev"

    # Superagent / Slack — a real Slack App (Events API + OAuth v2), same
    # "external dashboard, one-time human setup" shape as GitHub above: a
    # Slack App has to be created at https://api.slack.com/apps by a human
    # (no API for that), with:
    #   - OAuth & Permissions → Redirect URL → {api}/auth/slack/callback
    #     and Bot Token Scopes → app_mentions:read, chat:write,
    #     channels:read, groups:read
    #   - Event Subscriptions → Request URL → {api}/webhooks/slack/events
    #     (Slack POSTs a real `url_verification` challenge here the moment
    #     you save the URL — app/main.py answers it automatically, no
    #     manual step) → Subscribe to bot events → app_mention
    # Leave these blank to run without Slack — slack_configured below
    # gates every Slack code path off cleanly, same pattern as
    # resend_api_key: nothing pretends a connection exists.
    slack_client_id: str = ""
    slack_client_secret: str = ""
    slack_signing_secret: str = ""
    # Blank = derive from app_env, same as github_oauth_redirect_uri —
    # must exactly match the Redirect URL registered on the Slack App.
    slack_oauth_redirect_uri: str = ""

    # Transactional email — generated apps can request a real send by
    # inserting a row into their own `_meero_emails` table (schema.sql,
    # documented in prompts.py); an in-process poller (see
    # _start_email_poller in main.py) reads pending rows back via the
    # Management API (same real, no-fake pattern as runtime-error
    # telemetry) and sends them through Resend. Leave the API key blank to
    # run without this feature — the poller just skips its pass, and
    # nothing pretends a send happened. Requires a Resend account with a
    # verified sending domain: https://resend.com/domains.
    resend_api_key: str = ""
    resend_from_email: str = "Meero Apps <apps@meero.im>"
    email_poll_interval_s: float = 30.0
    # Per-project cap (counted from real `status = 'sent'` rows in the last
    # hour, not separately tracked state) — a signed-up user of a generated
    # app can freely insert `_meero_emails` rows, so this is the one real
    # backstop against a compromised/malicious account burning the project
    # owner's Resend quota.
    email_rate_limit_per_project_per_hour: int = 50

    # Runtime monitor — the always-on background agent that autonomously
    # detects + fixes captured production runtime errors (see
    # app/runtime_monitor.py). Mirrors the email poller's shape exactly.
    # Unlike resend_configured/vercel_configured, this needs no new external
    # credential to gate on, so it's a plain kill-switch instead — deploy
    # with it false until the feature's been manually verified end-to-end,
    # then flip it on.
    runtime_monitor_enabled: bool = True
    runtime_monitor_poll_interval_s: float = 45.0
    # Per-project cap, counted from real `is_autonomous_fix` build rows in
    # the last hour (db.count_recent_autonomous_fixes), not tracked state —
    # same pattern as email_rate_limit_per_project_per_hour.
    runtime_monitor_max_fixes_per_project_per_hour: int = 3
    # How many distinct unresolved errors get batched into ONE fix build's
    # prompt, capped so the prompt (and the diff the LLM has to reason
    # about) stays bounded even if a bug is spamming errors.
    runtime_monitor_max_errors_per_batch: int = 5

    # Conversion agent — the background agent that detects conversion
    # issues from real visitor behavior (app/conversion_agent.py) and runs
    # verified client-bucketed A/B experiments to fix them. UNLIKE
    # runtime_monitor, this is off by default PER PROJECT
    # (projects.conversion_agent_enabled — a fully opt-in feature); this
    # flag is a second, coarser deploy-time kill switch on top of that one,
    # same "deploy false until manually verified end-to-end" convention as
    # runtime_monitor_enabled. The behavior tracker itself is unconditional
    # (see codegen.py's _REQUIRED_FILES) and keeps recording regardless of
    # either flag, exactly like the error reporter does.
    conversion_agent_enabled: bool = True
    conversion_agent_poll_interval_s: float = 300.0
    # Experiments run for days, not hours — cap on a weekly window, counted
    # from real is_conversion_experiment build rows (mirrors
    # runtime_monitor_max_fixes_per_project_per_hour's "derive from real
    # data" convention, just on a longer timescale).
    conversion_agent_max_experiments_per_project_per_week: int = 2
    # Minimum distinct sessions recorded across the app in the trailing
    # conversion_agent_traffic_window_days before the agent will auto-launch
    # an experiment at all — a coarse "is there enough traffic here" gate,
    # checked at LAUNCH time.
    conversion_agent_min_sessions_before_experiment: int = 200
    conversion_agent_traffic_window_days: int = 14
    # Per-variant minimum exposures before an evaluation pass will even
    # attempt the significance test — a separate, finer statistical-power
    # gate checked at EVALUATION time (independent of the launch gate: an
    # app can clear the launch gate on aggregate traffic but still take a
    # while to accumulate exposures split evenly across two variants).
    conversion_agent_min_exposures_per_variant: int = 100
    # Minimum runtime, in days, before ANY decision (winner or
    # inconclusive) is made, regardless of exposure counts — avoids a
    # weekday/weekend traffic-mix bias deciding things after a few hours.
    conversion_agent_min_runtime_days: int = 7
    # Hard ceiling — an experiment that never reaches significance is
    # marked inconclusive and reverted rather than running forever.
    conversion_agent_max_runtime_days: int = 21
    # Two-tailed significance threshold for the hand-rolled z-test (p below
    # this to declare a winner).
    conversion_agent_significance_p_value: float = 0.05
    # Bounded batch size, same "keep the LLM's diff bounded" philosophy as
    # runtime_monitor_max_errors_per_batch.
    conversion_agent_max_hypotheses_per_batch: int = 3

    @model_validator(mode="after")
    def _derive_env_urls(self) -> "Settings":
        """The single-flag payoff: fills in every *_url / allowed_origins
        field still left blank with the real meero.im (prod) or localhost
        (local) value, based on app_env alone. A field set explicitly in
        .env is never touched here — blank is what opts it into this
        derivation, so a one-off override (e.g. a staging domain) still
        works normally."""
        frontend = PROD_FRONTEND_URL if self.app_env == "prod" else "http://localhost:3000"
        api = PROD_API_URL if self.app_env == "prod" else "http://localhost:8000"

        self.frontend_url = self.frontend_url or frontend
        self.public_base_url = self.public_base_url or api
        self.allowed_origins = self.allowed_origins or frontend
        self.github_oauth_redirect_uri = (
            self.github_oauth_redirect_uri or f"{api}/auth/github/callback"
        )
        self.slack_oauth_redirect_uri = (
            self.slack_oauth_redirect_uri or f"{api}/auth/slack/callback"
        )
        self.supabase_oauth_redirect_uri = (
            self.supabase_oauth_redirect_uri or f"{api}/auth/supabase/callback"
        )
        self.billing_success_url = (
            self.billing_success_url or f"{frontend}/?checkout=success"
        )
        self.billing_cancel_url = (
            self.billing_cancel_url or f"{frontend}/?checkout=cancelled"
        )
        self.billing_portal_return_url = self.billing_portal_return_url or f"{frontend}/"
        return self

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def stripe_configured(self) -> bool:
        return bool(self.stripe_secret_key and self.stripe_price_pro and self.stripe_price_ultra)

    @property
    def credits_topup_configured(self) -> bool:
        return bool(self.stripe_secret_key and self.stripe_price_credits_topup)

    @property
    def github_oauth_configured(self) -> bool:
        return bool(self.github_oauth_client_id and self.github_oauth_client_secret)

    @property
    def slack_configured(self) -> bool:
        return bool(
            self.slack_client_id and self.slack_client_secret and self.slack_signing_secret
        )

    # Auto-provisioning (00045) — connecting a Supabase account is the only
    # step; the orchestrator creates a real brand-new project on the user's
    # behalf rather than making them pick an existing one. Region/plan are
    # config, not hardcoded, since which regions/plans an org can actually
    # use varies by account. Poll interval mirrors the email
    # poller/runtime monitor's shape; timeout is generous — real Supabase
    # project creation is usually under a minute but can take longer.
    supabase_new_project_region: str = "us-east-1"
    supabase_new_project_plan: str = "free"
    supabase_provision_poll_interval_s: float = 15.0
    supabase_provision_timeout_s: int = 600

    @property
    def supabase_oauth_configured(self) -> bool:
        return bool(self.supabase_oauth_client_id and self.supabase_oauth_client_secret)

    @property
    def vercel_configured(self) -> bool:
        return bool(self.vercel_token)

    @property
    def resend_configured(self) -> bool:
        return bool(self.resend_api_key and self.resend_from_email)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


# --------------------------------------------------------------------------
# Token billing constants (see 00010_token_billing.sql, 00012_weekly_token_reset.sql).
# Credits are a weekly TOKEN budget (refreshes Sunday 00:00 UTC); chat turns
# deduct real OpenAI tokens, builds deduct a flat cost.
# Kept here (not in main.py) so the chat agent (app/agent/graph.py) can charge
# builds without importing main.py and creating a circular import.
# --------------------------------------------------------------------------

# Flat token-equivalent cost of one web-app build (codegen + a real
# `next build`). Every plan runs the exact same pipeline here, so there's a
# single flat cost.
WEB_BUILD_COST = 8000

# Real Vercel production release (Pro & Ultra) — a separate, explicit
# action: real deploy compute + bandwidth on real infrastructure (Vercel
# runs its own `next build`), not LLM tokens.
DEPLOY_COST = 20000

# Marketplace clone: an instant copy of a public project's real files/spec
# (no new LLM call, no new bundle) — flat cost is a credit sink on the
# cloner, not a payout to the original creator (real creator payouts are the
# not-yet-built "crypto transactions" direction).
CLONE_COST = 2000

# One conversion-experiment action (launch, graduation, or revert) — each is
# a real fix_project() codegen call + a real `next build`, same shape as a
# runtime fix, so it's charged the same flat cost.
CONVERSION_EXPERIMENT_COST = WEB_BUILD_COST

# Charged for a chat turn only when the model returns no usage_metadata, so a
# turn is never accidentally free.
CHAT_MIN_CHARGE = 1500

# Real $5 one-time top-up → this many bonus tokens (profiles.bonus_credits).
# A genuine paid perk sized to actually be worth the transaction (roughly
# 12x the free plan's weekly budget, a bit over half the pro plan's weekly
# budget) — not the old 5,000,000 "unlimited for a week" giveaway amount,
# which handed out far more usage than a $5 charge covers.
CREDITS_TOPUP_TOKENS = 250000

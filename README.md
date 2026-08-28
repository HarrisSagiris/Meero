# Meero

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![CI](https://github.com/HarrisSagiris/Meero/actions/workflows/ci.yml/badge.svg)](https://github.com/HarrisSagiris/Meero/actions/workflows/ci.yml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Describe a web application in natural language → get a **real, secure, FULL-STACK Next.js + TypeScript + Tailwind + shadcn/ui app** running live in your browser — real Postgres tables, real row-level security, real user accounts, all on **your own Supabase project**. Connect your Supabase account once; every build applies its generated schema to your actual database via the Supabase Management API and the app runs against it. Every generated app carries a small, mechanically-guaranteed "Created by Meero" badge. The **Pro and Ultra plans** unlock a one-click **production release**: a genuine Vercel deployment (Vercel running its own real `next build`) with a real public URL. Connect GitHub and every successful build is **committed straight to `main`** on your own repo (runtime self-heal fixes come as a reviewable PR). Nothing is simulated anywhere in the pipeline.

**Meero is open source (MIT) and self-hostable** — you bring your own Supabase project and API keys, and run the whole stack with `make up`. New here? Read this file, then [`CONTRIBUTING.md`](CONTRIBUTING.md), then [`AGENTS.md`](AGENTS.md) for the design-decision log.

## Status

| Piece | State |
| --- | --- |
| Next.js App Router frontend (home, builder, auth) | ✅ Done |
| Supabase Auth — email/password + Google OAuth, cookie sessions | ✅ Done |
| Postgres schema (`profiles`, `projects`, `specs`, `builds`, `build_artifacts`) with RLS on every table | ✅ Done |
| FastAPI orchestrator: build API, Redis queues, WebSocket status | ✅ Done (code) |
| Supabase connect — real OAuth + Management API (project picker, per-build schema apply) | ✅ Done (code) — needs a Supabase OAuth App |
| Codegen agent — LLM structured outputs (OpenAI on Free, Anthropic Claude on Pro/Ultra) → complete, security-validated Next.js + shadcn/ui apps (schema.sql with RLS, pinned dependency versions, required "Created by Meero" badge) | ✅ Done (code) |
| Web worker — schema → your Supabase, then a real `next build` (static export) against the vendored toolchain → live preview | ✅ Done (code) |
| LangGraph chat agent — streamed replies, spec merge, real build triggers | ✅ Done (code) |
| Builder **Code** tab — Preview/Code switcher showing the real generated source as it's written | ✅ Done (code) |
| Plans & weekly token credits (Free 20k, Pro 400k, Ultra 2M) with real Stripe billing | ✅ Done (code) — needs your Stripe keys |
| Production release (Pro & Ultra) — real Vercel REST API deployment worker | ✅ Done (code) — needs a real `VERCEL_TOKEN` |
| GitHub integration — real repo created on connect, then a commit to `main` per successful build (runtime self-heal fixes arrive as a PR) | ✅ Done (code) — needs a GitHub OAuth App |
| Custom domains (Pro & Ultra) — real Vercel Domains API, live DNS verification | ✅ Done (code) — needs `VERCEL_TOKEN` |
| Team/collaborator invites — an existing Meero user gets full chat/build access to a project, billed to the owner | ✅ Done |
| Transactional email — generated apps request real sends via their own `_meero_emails` table; an in-process poller dispatches through Resend | ✅ Done (code) — needs a real `RESEND_API_KEY` |
| Solo mode vs. Manual mode — Manual mode makes the chat agent wait for a real "Approve build" click (and the AI fix wait for a real "Auto-fix" click) instead of firing on its own | ✅ Done |
| Conversion optimization agent (beta) — every app tracks real visitor behavior; an opt-in background agent detects conversion issues and runs verified client-bucketed A/B experiments to fix them | ✅ Done (code) |

The builder UI reports facts honestly: the preview pane shows real build state only. Nothing is mocked anywhere — a build only reads "succeeded" after a real `next build` on real infrastructure, and a release only reads "live" after Vercel genuinely reports the deployment READY.

## Every app is real Next.js + shadcn/ui — and carries a Meero badge

Generated apps are genuine Next.js (App Router) projects — `app/layout.tsx`, `app/page.tsx`, real shadcn/ui components under `components/ui/`, Tailwind, TypeScript — built with a real `next build --output export` locally and, on release, by Vercel's own build. Every app also renders a small, fixed "Created by Meero" badge: required and validated at generation time (`components/meero-badge.tsx` must exist and be rendered from the root layout), with a static fallback the build worker injects into the actual HTML if that marker is ever somehow missing — so it's on 100% of apps, not just the ones the model remembered to add it to.

## Security is a product feature

Every generated app is **secure by construction**, and the rules are mechanically enforced (a violation fails codegen before a byte reaches the build or your database — see `_validate_bundle()` and `_validate_schema_sql()` in `apps/orchestrator/app/agents/codegen.py`):

- **A fixed, pinned dependency set** — Next, React, the shadcn/ui Radix primitives, Tailwind, `lucide-react`, and `@supabase/supabase-js` (the app's entire backend surface), plus local imports. Codegen must pin `package.json` to exact vendored version strings — checked byte-for-byte — so nothing untested ever reaches a real `npm install`.
- **RLS is the real authorization boundary** — the anon key ships in the browser by design, so every table a generated app creates MUST enable row-level security with at least one policy (owner-scoped via `auth.uid()` by default). `schema.sql` is validated statement-by-statement: idempotent `CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER TABLE … ENABLE ROW LEVEL SECURITY / ADD COLUMN IF NOT EXISTS`, and policy statements only — no drops, truncates, grants, roles, functions, or extensions can ever reach your database.
- **Real auth, not hand-rolled crypto** — end-user sessions come from Supabase Auth (`signUp`/`signInWithPassword`/`onAuthStateChange`), never homemade password handling.
- **No raw network access** — no `fetch`/`XMLHttpRequest`/`WebSocket` in generated source; all remote I/O goes through supabase-js, and the Supabase URL/key (and the app's own serving path) enter only as build-time-substituted placeholders (never hardcoded, never in the stored source or GitHub pushes).
- **No XSS sinks** — `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, and `new Function` are banned outright; everything renders through normal JSX, which React escapes automatically.
- **A locked-down CSP** — every generated `app/layout.tsx` carries a `Content-Security-Policy` meta tag with `connect-src` limited to the linked Supabase project (Next's static export needs `script-src 'self' 'unsafe-inline'` for its own hydration payload — React's escaping is the XSS boundary there, not the CSP).
- **Sandboxed preview** — the builder iframes the app with a restrictive `sandbox` attribute on top of all of the above.

## Conversion Optimization (Beta)

Every generated app carries a required, mechanically-guaranteed client behavior tracker (`components/meero-behavior-tracker.tsx` — validated at codegen time exactly like the "Created by Meero" badge and the runtime error reporter), plus an orchestrator background agent (`apps/orchestrator/app/services/conversion/conversion_agent.py`) that turns what it records into real, verified UI improvements.

**What's collected.** The tracker records anonymous visitor interaction events — clicks, scroll depth, dead clicks (a click on something that looks interactive but isn't), rage clicks (repeated rapid clicks suggesting something feels broken), form field *metadata* (which field, what type — never a field's value), and named funnel milestones (`signup_start`, `checkout_start`, etc.) — into a `_meero_behavior_events` table in the **app owner's own Supabase project**, the same "your own database" model every other piece of generated telemetry uses. No PII, no raw form values, no page text, no IP addresses (there's no server layer in a static-exported app to capture one from — an architectural fact, not a policy choice). Click coordinates are normalized to a 0–1 fraction of each visitor's own viewport so they stay comparable across different screen sizes.

**How to enable/disable.** Data collection itself is always on, unconditional, for every generated app — same as the runtime error reporter. What's actually optional is the *agent*: a project-level "Autonomous optimization" toggle in the builder's **Conversion** tab (owner-only, off by default) controls whether Meero analyzes that data and proposes/runs experiments. Turning it off stops the agent, not the tracker — there's currently no way to disable data collection itself per project (a known limitation, not something this version promises).

**How improvements are proposed and verified.** The agent polls Supabase-linked, opted-in projects on a timer, looking for patterns — dead/rage clicks clustering on one element, a CTA with a low click-through rate among visitors who scrolled the whole page, form abandonment, steep drop-off between funnel steps — and turns a strong-enough signal into a hypothesis. Once there's enough real traffic (configurable, `conversion_agent_min_sessions_before_experiment`), it runs that hypothesis as a genuine client-bucketed A/B experiment: one real codegen build ships BOTH the original UI and the proposed fix in the same static export, and a deterministic per-visitor bucket (no server, just `localStorage`) decides which one each visitor sees — the same "no server" constraint that shapes every other part of this pipeline. The experiment runs for a real minimum duration and traffic volume, then a two-proportion z-test (p < 0.05 by default) decides whether the fix actually wins, loses, or the result is inconclusive — never a hunch, never a small-sample guess. A winning fix is then shipped permanently via another real build that removes the A/B branching; a losing or inconclusive one is reverted the same way. In Manual autonomy mode, launching an experiment and applying its result both wait for an explicit click instead of firing automatically — same underlying mechanism either way.

**How to review experiments.** The **Improvements** tab (per project — internally still "conversion" throughout the codebase; only the user-facing label reads plainer) shows detected issues awaiting action, running and decided experiments with a real lift chart and significance numbers, a lift-over-time trend as more evaluation passes come in, and a real click-heatmap overlay (a genuine headless-browser screenshot of the app's own live page, with recorded clicks and dead clicks plotted on top) per page.

**Where the data lives.** Raw behavior events live in the app owner's own Supabase — theirs to query or delete directly. Meero's own bookkeeping about what it detected and tried (`conversion_hypotheses`/`conversion_experiments`/`conversion_results`, `supabase/migrations/00042_conversion_agent.sql`) lives in Meero's database and is deleted along with the project.

## Setup

### 1. Create a Supabase project

1. Go to [database.new](https://database.new) and create a project (any region, note the database password).
2. Dashboard → **Project Settings → API**: copy the **Project URL** and the **anon/publishable key**.

### 2. Configure env

```bash
cp apps/web/.env.example apps/web/.env.local          # web: Supabase URL + anon key
cp apps/orchestrator/.env.example apps/orchestrator/.env   # orchestrator: service-role key, OPENAI_API_KEY, …
# Windows PowerShell: Copy-Item apps/web/.env.example apps/web/.env.local
```

Then edit each file. `docker compose` also auto-loads a root `.env` — copy
`apps/web/.env.example` to `./.env` too if you run the stack with `make up`.

### 3. Apply the database migrations

Option A — SQL editor (fastest): open Dashboard → **SQL Editor**, and run each file in `supabase/migrations/` **in order** — paste the contents, run, repeat:

- [00001_init.sql](supabase/migrations/00001_init.sql) — core schema (profiles, projects, specs, builds, build_artifacts)
- [00002_platforms_attachments.sql](supabase/migrations/00002_platforms_attachments.sql) through [00015_marketplace.sql](supabase/migrations/00015_marketplace.sql) — chat messages, billing/credits, preview URLs, generated file storage, auto-fix retries, GitHub publish, credit top-ups, token billing, marketplace (historical migrations from earlier product iterations — still part of the schema's history, keep applying them in order)
- [00016_web_pivot.sql](supabase/migrations/00016_web_pivot.sql) — adds the `'web'` build platform, the new `build_artifacts.kind` vocabulary (`source_archive`/`web_bundle`/`deployment`/`log`), `builds.deploy_url`, and the trigger-protected `projects.live_url`
- [00017_byo_supabase.sql](supabase/migrations/00017_byo_supabase.sql) — the full-stack pivot: `supabase_connections` (service-role-only OAuth tokens), `profiles.supabase_connected`, and the trigger-protected per-project Supabase link (`supabase_project_ref`/`supabase_url`/`supabase_anon_key`)

Option B — Supabase CLI:

```bash
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

### 4. Configure auth

**Email confirmation (server-side flow):** Dashboard → **Authentication → Emails → Confirm signup**, replace the confirmation link with:

```
{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
```

Also set **Authentication → URL Configuration → Site URL** to `http://localhost:3000` (change when deploying).

**Google OAuth:**

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an OAuth client (Web application).
2. Authorized redirect URI: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`.
3. Dashboard → **Authentication → Sign In / Providers → Google**: enable it and paste the client ID + secret.

### 5. Storage buckets

Nothing to do — the migrations create the private `attachments` (user uploads, RLS-scoped per user) and `artifacts` (build outputs, orchestrator-only) buckets, plus the public `previews` bucket (live app bundles, served through the orchestrator's own proxy — see below).

### 6. Run everything (Docker)

Prereqs: root `.env` filled (web / compose), `apps/orchestrator/.env` filled (Supabase service-role key + `OPENAI_API_KEY`), Docker running.

```bash
make up
```

(`make up` reads `APP_ENV` from `.env` — see [§12](#12-going-to-production-meeroim) for the one-flag switch to a real deploy — and is equivalent to `docker compose build && docker compose up -d` when `APP_ENV=local`, which is the default.)

That starts seven services:

| Service | Port | What |
| --- | --- | --- |
| `web` | 3000 | Next.js app (production build) |
| `api` | 8000 | FastAPI orchestrator + WebSocket |
| `codegen-worker` | — | Codegen agent (plans the app, generates the full Next.js + shadcn/ui + schema.sql project) |
| `web-worker` | — | Schema → your Supabase, real `next build` (static export) against the vendored toolchain → live preview (every plan) + commit to GitHub `main` |
| `deploy-worker` | — | Real Vercel REST API production releases, Vercel building the real Next.js source (Pro & Ultra action) |
| `superagent-worker` | — | Repo-file selection + patch generation for the self-heal / superagent flow (OpenAI + GitHub API) |
| `redis` | 6379 | Job queues + event bus |

Open http://localhost:3000, sign up, create a project, describe an app. Check health at http://localhost:8000/health; tail logs with `docker compose logs -f web-worker`.

> **Dev alternative (hot reload):** `npm run dev` for the web app, `docker compose up -d redis`, then in `apps/orchestrator/` (with the venv activated — `. .venv/bin/activate`, or `.venv\Scripts\activate` on Windows): `python -m uvicorn app.main:app --port 8000`, `python -m app.workers.codegen_worker`, and `python -m app.workers.web_worker` (needs the vendored Next.js toolchain at `APP_VENDOR_DIR` — see `apps/orchestrator/Dockerfile` for the exact `npm install` list, which must match `app/agents/codegen.py`'s `VENDORED_PACKAGE_VERSIONS`).

### 7. Link your Supabase (the generated apps' backend)

Generated apps run on **your own Supabase project** — its Postgres is their database, its Auth is their login. One-time platform setup:

1. Register a **Supabase OAuth App**: [supabase.com/dashboard](https://supabase.com/dashboard) → your organization → **Settings → OAuth Apps** → Add application. The authorization callback URL must exactly match `SUPABASE_OAUTH_REDIRECT_URI` — for local dev, `http://localhost:8000/auth/supabase/callback`.
2. Copy the **Client ID** + **Client Secret** into `apps/orchestrator/.env` (`SUPABASE_OAUTH_CLIENT_ID` / `SUPABASE_OAUTH_CLIENT_SECRET`) and restart the `api` service.

Each user then clicks the Supabase button in the builder header: a real OAuth connect, then a picker listing their actual Supabase projects — one is linked per Meero project. Every build applies its generated `schema.sql` to that project's real database through the Management API (`/v1/projects/{ref}/database/query`), and linking relaxes signup email confirmation on that project so the generated app's real Supabase Auth sessions work instantly (a deliberate, documented v1 tradeoff). Until a project is linked, builds fail fast with a clear "link Supabase" message — never a fake success.

### 8. The live app pipeline (heavier than a static bundler — budget real CPU/RAM)

Every plan runs the same pipeline: `codegen-worker` plans the app and writes a complete, security-validated Next.js project (`package.json` through `schema.sql` — tables always shipped with RLS policies, dependencies pinned to exactly the vendored versions), then `web-worker` applies the schema to your linked Supabase, substitutes the `__SUPABASE_*__`/`__BASE_PATH__` placeholders with the linked project's real values, runs a real `next build --output export` against the pre-vendored Next/React/Tailwind/shadcn/Supabase toolchain (installed once at image build — no `npm install` ever runs per build), and uploads the whole resulting `out/` directory to the `previews` Storage bucket. The build's `preview_url` always points at the orchestrator's own `/preview/{build_id}/{path}` proxy, never Storage's public object URL directly (Storage forces `text/html` down to `text/plain` and blocks script execution on every public object — a real, verified guardrail, not a style choice — so the app could never actually run if the browser loaded it straight from there).

### 9. Production release (real Vercel deployments — Pro & Ultra)

A separate, explicitly user-triggered action per build (`POST /builds/{id}/deploy`) — never automatic, never blocking the live preview. It ships the build's **real Next.js source** (the same generated files, substituted for your Supabase project) through Vercel's real REST API with `framework: "nextjs"`, so Vercel installs the pinned dependencies and runs its own genuine `next build` — poll until Vercel reports `READY`, then persist the real production URL onto the build and the project. Each Meero project maps to one stable Vercel project name, so repeat releases keep the same production domain.

Setup: create a token at vercel.com → **Settings → Tokens**, set `VERCEL_TOKEN` (and optionally `VERCEL_TEAM_ID`) in `apps/orchestrator/.env`, restart the `api` and `deploy-worker` services. Until it's set, the release button returns a clear "isn't configured" error instead of hanging or faking a deployment.

### 10. Plans, weekly token credits, and Stripe billing

Every chat turn deducts the real OpenAI tokens it consumed; every app build deducts a flat `WEB_BUILD_COST` (codegen + a real `next build` — same for every plan); the Pro/Ultra production release deducts a separate, larger flat `DEPLOY_COST` (real deploy compute + bandwidth). Credits are a **weekly token budget**, refreshing every Sunday at 00:00 UTC — enforced atomically by Postgres functions (`credits_available()` gates before running, `charge_credits()` reconciles the true cost after), called only by the orchestrator's service-role client.

| Plan | Price | Tokens/week | Model | Builds |
| --- | --- | --- | --- | --- |
| Free | — | 20k | `OPENAI_MODEL_FREE` (cheaper) | Full-stack app on your Supabase |
| Pro | $9.99/mo | 400k | `OPENAI_MODEL` (flagship) | + one-click Vercel release |
| Ultra | $24.99/mo | 2M | `OPENAI_MODEL` (flagship) | + one-click Vercel release |

To enable **real** upgrades via Stripe Checkout:

1. In the [Stripe Dashboard](https://dashboard.stripe.com/products), create two recurring Products/Prices: "Meero Pro" at $9.99/mo and "Meero Ultra" at $24.99/mo. Copy each Price ID (`price_...`).
2. In `apps/orchestrator/.env`, set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ULTRA`, and the `BILLING_*` return URLs.
3. Add a webhook endpoint in Stripe pointing at `https://YOUR-ORCHESTRATOR-HOST/billing/webhook`, subscribed to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.created`, and `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Restart the `api` service. Until these are set, the Settings → Billing modal's upgrade buttons return a clear "Stripe isn't configured" error instead of failing silently.

### One-time credit top-up ($5 → 250k tokens)

A real, one-time (not recurring) $5 Stripe Checkout (`mode=payment`) granting `CREDITS_TOPUP_TOKENS` (250k) real bonus tokens. These land in `profiles.bonus_credits` — a separate pool from the weekly plan allowance, spent only after that runs out, and never wiped by the weekly reset.

1. In Stripe, create a **one-time** (not recurring) Product/Price for the top-up. Copy its Price ID.
2. Set `STRIPE_PRICE_CREDITS_TOPUP` in `apps/orchestrator/.env` (reuses `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` from above).
3. Restart the `api` service. Until it's set, the checkout returns a clear "Credit top-ups aren't configured" error instead of failing silently.

The account menu (top-right, click to expand) has **Settings** (display name) and **Billing & usage** (plan, live credit count, upgrade/manage-billing buttons) — both read straight from the `profiles` row via RLS.

### 11. GitHub integration → commits to `main` (leave blank to run without it)

The GitHub icon in the builder header lets a user connect their own GitHub account. **Connecting immediately creates a real private repo** (README-initialized so `main` exists) and links the project. After that, **every successful build — and every auto-fix — is committed straight to `main`** as one real commit (blobs → tree → commit → ref via GitHub's Git Data API), giving a clean linear trace. The one exception: a **runtime self-heal fix** (a captured production error → a speculative fix) arrives as a reviewable pull request instead, since it hasn't passed a real compile the way a normal build has. Pushed source always carries the `__SUPABASE_*__` placeholders, never real values.

1. [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**.
2. **Authorization callback URL** must exactly match `GITHUB_OAUTH_REDIRECT_URI` — for local dev, `http://localhost:8000/auth/github/callback`.
3. Copy the **Client ID**, generate a **Client Secret**, and set both plus `GITHUB_OAUTH_REDIRECT_URI` and `FRONTEND_URL` in `apps/orchestrator/.env`.
4. Restart the `api` service. Until these are set, the GitHub button returns a clear "GitHub isn't configured" error instead of failing silently.

### 12. Going to production (meero.im)

Meero runs on **meero.im** (frontend) and **api.meero.im** (the orchestrator — a long-running Python/Redis service, so it needs its own host; Vercel doesn't run it). Switching from local dev to the real domain is one flag, not a dozen manual edits:

1. In `apps/orchestrator/.env`, set `APP_ENV=prod`. Every URL the orchestrator itself derives — `frontend_url`, `public_base_url`, `allowed_origins` (CORS), the GitHub/Supabase OAuth callback URLs, and the Stripe billing return URLs — switches from localhost to `https://meero.im` / `https://api.meero.im` in one move (see `_derive_env_urls()` in `app/config.py`). Any of those left as an explicit value in `.env` instead of blank keeps that one override regardless of `APP_ENV` — useful for a staging domain.
2. In the root `.env`, set `APP_ENV=prod` too, then run `make build` / `make up` instead of raw `docker compose` commands. Next.js inlines `NEXT_PUBLIC_ORCHESTRATOR_URL` into the client bundle at **build time**, so it can't be a runtime toggle the way the orchestrator's own settings are — `make` handles this by automatically layering `docker-compose.prod.yml` (which bakes in `https://api.meero.im`) whenever `APP_ENV=prod`.
3. Point real DNS at wherever you host each piece: `meero.im` → your Next.js host, `api.meero.im` → your orchestrator host. TLS termination for both is on you (a reverse proxy, your host's built-in HTTPS, etc.) — nothing here provisions certificates.
4. **Update the external dashboards by hand** — `APP_ENV` can only change what Meero's own code does; these live outside this repo and won't move on their own:
   - **GitHub OAuth App** ([github.com/settings/developers](https://github.com/settings/developers)) → its Authorization callback URL to `https://api.meero.im/auth/github/callback`.
   - **Supabase OAuth App** (your org's Settings → OAuth Apps) → its callback URL to `https://api.meero.im/auth/supabase/callback`.
   - **Your own Supabase project's Auth settings** → Site URL to `https://meero.im`, and add `https://meero.im/**` to the redirect URL allow-list (email confirmation / OAuth links need this to work off localhost).
   - **Stripe webhook** → add (or point) the endpoint at `https://api.meero.im/billing/webhook`.
5. Rebuild and restart: `make build && make up` (or `make restart` once it's already running).

### 13. Transactional email (leave `RESEND_API_KEY` blank to run without it)

Generated apps can send real email — a welcome message, a contact-form notification to the site owner, an order confirmation — by inserting a row into their own `_meero_emails` table (only if the spec actually calls for it; most apps don't create this table at all). An in-process background poller on the `api` service (`_start_email_poller` in `apps/orchestrator/app/main.py`, no separate worker/Docker service needed) scans every Supabase-linked project every `EMAIL_POLL_INTERVAL_S`, reads real `status = 'pending'` rows back via the Management API (same pattern as the runtime-error telemetry the auto-fix pipeline reads), and sends each one through Resend's real REST API — writing the true `sent`/`failed` outcome back onto the row it came from. A per-project hourly send cap (`EMAIL_RATE_LIMIT_PER_PROJECT_PER_HOUR`), counted from real sent rows rather than separately tracked state, is the backstop against a malicious signed-up end-user of a generated app burning its owner's Resend quota.

1. Create a [Resend](https://resend.com) account, verify a sending domain (**Domains**), and generate an API key (**API Keys**).
2. In `apps/orchestrator/.env`, set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` (must be on the verified domain, e.g. `Meero Apps <apps@meero.im>`).
3. Restart the `api` service. Until `RESEND_API_KEY` is set, the poller's pass is a genuine no-op — rows stay `pending`, nothing pretends a send happened.

## Architecture

```
Browser (Next.js chat UI)                 User's OWN Supabase project
   │  Supabase Auth cookies                (generated app's Postgres,
   │  WebSocket build status                RLS, and Auth — linked via
   │  <iframe> live app ───────────────────▶ real OAuth + Mgmt API)
   ▼                                                ▲
Meero Supabase (Auth + Postgres w/ RLS)             │ schema.sql per build
                                                    │
FastAPI orchestrator ── Redis queue ──▶ web-worker ─┘
        │                                (real `next build` static
        │                                 export — any Linux host,
        │                                 more CPU/RAM than a bundler)
        │                     /preview proxy → live app in browser
        │                     · commit to the user's GitHub repo (main)
        │
        └────────▶ deploy-worker (ships real Next.js source; Vercel
                   runs its OWN real `next build` — Pro & Ultra,
                   separate action → real production URL)
```

Key constraints baked into the design:

- The web worker needs no special hardware — just Node.js and the vendored Next.js/React/Tailwind/shadcn/Supabase toolchain (installed once at image build; never per build) — but a real `next build` is real CPU/RAM work, budget accordingly (see the `web-worker` resource limits in `docker-compose.yml`).
- The deploy worker needs only outbound HTTPS to api.vercel.com — still just a plain Linux host.
- Meero never runs AI-generated server code: the generated apps' entire backend is the user's own Supabase (PostgREST + Auth + RLS), driven from the browser.
- The service-role key lives only in the orchestrator; the web app uses the anon key and is fully constrained by RLS.
- `builds`/`build_artifacts` are read-only to end users; only the orchestrator writes them.
- `queues.publish_event()` degrades gracefully if Redis is unreachable from a given worker host — the browser falls back to polling (`BuildStatusListener`) instead of instant WebSocket push. Supabase is always the source of truth either way.

## Scripts

Run from the repo root — it's an npm workspace driven by Turborepo.

- `npm run dev` — web dev server (hot reload)
- `npm run build` — production build (`apps/web`)
- `npm run lint` — ESLint (`apps/web`)
- `npm run format` / `npm run format:check` — Biome formatter (write / check)
- `npm run check` / `npm run check:ci` — Biome linter + formatter (write / check)

For the orchestrator: `ruff check apps/orchestrator`,
`python -m compileall -q apps/orchestrator/app`, and
`python apps/orchestrator/scripts/check_vendored_versions.py`.

## Contributing

Contributions are welcome. Start with [`CONTRIBUTING.md`](CONTRIBUTING.md) for
local setup, the coding standards CI enforces, and the project-specific rules a
reviewer will hold a PR to (chief among them: **never mock a pipeline stage**).

- **Bugs / features:** open an issue with the matching template.
- **Questions:** use GitHub Discussions.
- **Security:** never a public issue — see [`SECURITY.md`](SECURITY.md).

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © 2026 harris.dev

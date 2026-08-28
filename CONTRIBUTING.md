# Contributing to Meero

Thanks for your interest in improving Meero. This document covers how to get a
local environment running, the coding standards CI enforces, and the few
project-specific rules that a reviewer will hold a PR to.

By submitting a contribution you agree that your work is licensed under the
project's [MIT License](LICENSE).

---

## Ways to contribute

- **Bug reports** — open an issue with the "Bug report" template. Include which
  service is involved (`web`, `api`, `codegen-worker`, `web-worker`,
  `deploy-worker`, `superagent-worker`) and real logs.
- **Features / ideas** — open an issue with the "Feature request" template
  first so the approach can be agreed before code is written.
- **Security issues** — do **not** open a public issue. See [SECURITY.md](SECURITY.md).
- **Pull requests** — see the workflow below.

---

## Repo layout

```
apps/web            Next.js 16 (App Router) + TypeScript + Tailwind v4 — the platform UI
apps/orchestrator   Python FastAPI + Redis queues + workers (codegen / web / deploy / superagent)
supabase/migrations Numbered SQL migrations for Meero's own database (RLS on every table)
deploy/             nginx configs + a from-scratch VPS deploy walkthrough
```

`AGENTS.md` is the design-decision and architecture-context log — read the
relevant section before changing a subsystem. It is authoritative where it
conflicts with older prose in `README.md`.

---

## Local setup

Prerequisites: **Node 22** (`.nvmrc`), **Python 3.12+**, **Docker**, and a free
[Supabase](https://supabase.com) project for Meero's own backend.

```bash
nvm use                 # picks up .nvmrc → Node 22
npm ci                  # installs the whole workspace from package-lock.json
```

Full environment configuration (Supabase, applying the migrations, optional
OpenAI / Anthropic / Stripe / GitHub / Vercel / Resend keys) is documented in
[`README.md` → Setup](README.md#setup). The short version:

```bash
cp apps/web/.env.example apps/web/.env.local
cp apps/orchestrator/.env.example apps/orchestrator/.env
# fill in at minimum: NEXT_PUBLIC_SUPABASE_URL / ANON_KEY (web),
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / OPENAI_API_KEY (orchestrator)
```

Run everything with Docker:

```bash
make up          # docker compose build && up -d  (APP_ENV=local)
make logs
```

Or run the web app with hot reload and the orchestrator directly:

```bash
npm run dev                                    # apps/web on :3000
docker compose up -d redis
cd apps/orchestrator
python -m venv .venv && . .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8000
python -m app.workers.codegen_worker           # in a second shell
python -m app.workers.web_worker               # in a third shell (needs the vendored toolchain — see apps/orchestrator/Dockerfile)
```

---

## Coding standards (what CI checks)

CI runs on every push and PR — see `.github/workflows/ci.yml`. It must be green
before a PR is merged.

| Area | Command | Notes |
| --- | --- | --- |
| Formatting (whole repo) | `npm run format:check` | [Biome](https://biomejs.dev). Fix with `npm run format`. |
| Web lint | `npm run lint -w apps/web` | ESLint (`eslint-config-next`). Zero errors required; warnings are being worked down — don't add new ones. |
| Web types | `npx -w apps/web tsc --noEmit` | Strict TypeScript. |
| Web build | `npm run build -w apps/web` | Real `next build`. |
| Orchestrator lint | `ruff check apps/orchestrator --select E9,F` | Syntax + pyflakes (undefined names, unused imports). Run the full `ruff check apps/orchestrator` locally too — the wider ruleset has known debt that new code shouldn't add to. |
| Orchestrator compiles | `python -m compileall -q apps/orchestrator/app` | |
| Vendored versions in sync | `python apps/orchestrator/scripts/check_vendored_versions.py` | See below. |

> `npm run check` (Biome's linter, not just the formatter) currently reports
> pre-existing findings in `apps/web`. It is **not** a merge gate yet, but new
> code should not add violations — run it locally on files you touch.

---

## Project-specific rules a reviewer will enforce

These come from `AGENTS.md` and are non-negotiable:

1. **Never mock, fake, stub, or simulate a pipeline stage.** Every build applies
   real SQL to a real database, runs a real `next build`, and a release goes
   through Vercel's real API. UI must report true state ("No app yet", "Link
   Supabase to build"), never placeholder output.

2. **Generated apps stay secure by construction.** The validators in
   `apps/orchestrator/app/agents/codegen.py` (`_validate_bundle`,
   `_validate_schema_sql`) and the marker/badge/error-reporter requirements are
   the security boundary. Don't weaken a check "to make codegen pass more
   often" — the auto-fix path exists for that.

3. **Keep `VENDORED_PACKAGE_VERSIONS` in sync across all three sources**
   (`app/agents/codegen.py`, `app/agents/prompts.py`, `apps/orchestrator/Dockerfile`).
   Run `python apps/orchestrator/scripts/check_vendored_versions.py` after any
   change to the generated-app toolchain.

4. **Database migrations are additive and immutable.** Add a new numbered file
   in `supabase/migrations/` (`NNNNN_short_name.sql`); never edit one that has
   already been applied. Every new table must `enable row level security` and
   ship at least one policy in the same migration.

5. **Secrets never reach the browser or the repo.** The service-role key lives
   only in the orchestrator. Generated/pushed source always carries the
   `__SUPABASE_*__` / `__BASE_PATH__` placeholders, never real values.

---

## Pull request workflow

1. Fork and branch from `main` (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
2. Make the change. Keep it focused — one concern per PR.
3. Run the CI commands above locally.
4. Update `CHANGELOG.md` under `## [Unreleased]` if the change is user-facing.
5. Open the PR using the template. Link the issue it closes, and describe how
   you tested it end to end (a feature is "done" only when a real signed-up
   Supabase user can use it).
6. CI must pass and a maintainer must approve before merge. Maintainers squash-merge.

---

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.

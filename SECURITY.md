# Security Policy

## Supported versions

Meero is pre-1.0 and ships from `main`. Security fixes land on `main` and in the
latest `0.x` tag. There is no back-porting to older tags.

| Version | Supported |
| --- | --- |
| `main` / latest `0.x` | ✅ |
| anything older | ❌ |

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a security
problem.**

Report it privately through GitHub:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (GitHub Private Vulnerability Reporting).
2. Include: affected component (`web`, `api`, one of the workers, a generated-app
   validator, a migration/RLS policy), a description of the impact, and the
   minimal steps or proof-of-concept to reproduce.

You'll get an acknowledgement within a few days. We aim to ship a fix or a
mitigation within **90 days** of a valid report and will coordinate a disclosure
date with you. Credit is given in the release notes unless you ask otherwise.

## Scope

**In scope**

- Bypassing a generated-app security validator (`_validate_bundle`,
  `_validate_schema_sql`, the badge / error-reporter / `window.__meeroSupabase`
  markers) in `apps/orchestrator/app/agents/codegen.py`.
- A generated `schema.sql` that can create a table without RLS, or an RLS policy
  that leaks another user's rows.
- Privilege escalation against Meero's own database — writing a
  trigger-protected column (`plan`, `credits_*`, `*_connected`,
  `supabase_project_ref`, `github_repo_*`, `live_url`, …) from a non-service-role
  client.
- Leaking the service-role key, an OAuth token from `supabase_connections` /
  `github_connections`, or any secret to the browser or into pushed source.
- AuthN/AuthZ flaws in the orchestrator API or the `apps/web` server actions
  (accessing another user's project, builds, messages, or collaborators).
- XSS / injection in the platform UI or in generated apps.

**Out of scope**

- Vulnerabilities in a **self-hosted deployment's own** misconfiguration —
  exposed `.env`, a Redis or orchestrator port published to the public internet
  (see `deploy/README.md`), missing TLS, weak Supabase project settings.
- The deliberate, documented v1 tradeoff where linking a Supabase project calls
  `disable_email_confirm()` so generated-app signups work instantly.
- The generated-app anon key being public — this is by design; RLS is the
  authorization boundary.
- Findings that require a compromised maintainer machine, physical access, or a
  already-compromised Supabase/GitHub/Vercel account.
- Rate-limiting / brute-force reports without a concrete impact.
- Automated scanner output with no demonstrated exploit.

## Security model

The short version (full detail in `AGENTS.md` → "Absolute rules"):

- The **service-role key lives only in the orchestrator.** The web app uses the
  anon key and is fully constrained by RLS.
- **Every table** — Meero's own and every table a generated app creates — has
  RLS enabled with at least one policy before any data is written.
- Generated code may import only a fixed, version-pinned vendored toolchain, has
  no raw network access (all I/O via `supabase-js`), and no XSS sinks — enforced
  mechanically at codegen time, with a static fallback badge injected by the
  build worker as a backstop.
- Meero never runs AI-generated server code; a generated app's entire backend is
  the user's own Supabase (PostgREST + Auth + RLS), driven from the browser.

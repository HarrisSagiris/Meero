# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] — 2026-08-28

Initial public open-source release.

### Added

- **Meero platform** — describe a web app in natural language and get a real,
  secure, full-stack Next.js (App Router) + TypeScript + Tailwind + shadcn/ui
  application running live in the browser, with the user's own linked Supabase
  project as the entire backend (real Postgres + RLS + Supabase Auth).
- **Codegen + chat agents** (`apps/orchestrator`) over OpenAI (free plan) and
  Anthropic (Pro/Ultra), with mechanical security validation of every generated
  bundle and `schema.sql`.
- **Live build pipeline** — schema applied to the linked Supabase, a real
  `next build` static export against a pre-vendored toolchain, served through
  the orchestrator's `/preview` proxy.
- **Production release** (Pro/Ultra) — real Vercel REST API deployments.
- **GitHub integration** — connecting creates the repo and commits every
  successful build straight to `main`; runtime self-heal fixes arrive as a PR.
- **Supabase connect** — OAuth + auto-provisioning of a fresh project via the
  Management API.
- **Billing** — weekly token credits with real Stripe checkout, plus a one-time
  top-up.
- **Marketplace** — public projects and re-pointed clones.
- Team/collaborator invites, custom domains, transactional email via Resend,
  autonomous runtime self-healing, a plain-English readiness checklist, a
  conversion-optimization agent (beta), and Solo vs. Manual autonomy modes.
- Self-host tooling — `docker-compose.yml` / `docker-compose.prod.yml`,
  `Makefile` single-flag environment switch, and a from-scratch VPS +
  nginx walkthrough in `deploy/`.

### Open-source preparation

- Added `LICENSE` (MIT), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`,
  issue/PR templates, GitHub Actions CI, and Dependabot.
- Added a comprehensive `.gitignore`, `.editorconfig`, and `.nvmrc`.
- Removed unused dependencies and unreferenced media; normalized the tree to the
  project's Biome formatting config.

[Unreleased]: https://github.com/HarrisSagiris/Meero/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HarrisSagiris/Meero/releases/tag/v0.1.0

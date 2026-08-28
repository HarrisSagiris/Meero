"""Meero codegen agent by Harrisdev

Turns a stored spec (natural-language prompt describing a web application)
into a real, SECURE, FULL-STACK web app via LLM structured outputs — OpenAI
for the free plan, Claude Sonnet (Anthropic) for Pro/Ultra (see llm() below
for the provider dispatch):

  1. plan   — spec prompt → AppPlan (views, auth, tables+RLS, design, security)
  2. files  — AppPlan     → complete Next.js + TypeScript + Tailwind +
              shadcn/ui project (app/layout.tsx, app/page.tsx, components/ui/*,
              lib/supabase.ts, schema.sql, …)

The app's entire backend is the user's own linked Supabase project, reached
exclusively through @supabase/supabase-js — real Postgres tables with RLS,
real Supabase Auth sessions. The output is written to disk verbatim, its
schema.sql is applied to the user's real database, and the frontend is
built by a real worker (`next build`, static export); nothing here
fabricates build results. Security is enforced mechanically, not just
prompted: `_validate_bundle()` rejects any generated file containing an XSS
sink (dangerouslySetInnerHTML/eval/document.write/…), a raw network call, a
non-allowlisted import, a missing "Created by Meero" badge, or a
schema.sql statement outside the safe DDL allowlist — before a single byte
reaches the build or the user's database.
"""

import difflib
import json
import re
import time
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Callable

from langchain_anthropic import ChatAnthropic
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field



from app.agents import prompts
from app.config import get_settings
from app.errors import SCHEMA_ERROR_MARKER, BuildCanceled

# A real, user-initiated stop (POST /builds/{id}/cancel) — passed by the
# worker, checked before the LLM call starts and throttled inside the
# streaming loop. `None` means "never cancel" (e.g. codegen paths that don't
# yet plumb one through).
ShouldCancel = Callable[[], bool]

# How often the streaming loop re-checks should_cancel(). A tighter interval
# makes Stop feel snappier but adds Redis round-trips per token chunk;
# OpenAI can stream many chunks/second, so throttle instead of checking every one.
_CANCEL_POLL_INTERVAL_S = 0.5

# Reports a real file as codegen streams it: (path, status, content). While a
# file is being written its status is "coding" and `content` is the real,
# still-growing source produced so far (re-sent each chunk so the UI can render
# it appearing line by line); "done" fires with the final content once the next
# file starts (or the stream ends). Best-effort — never allowed to affect the
# actual generated result, only this live progress signal.
OnFile = Callable[[str, str, str], None]

# Reports the plan as it streams in: the real, growing partial AppPlan dict
# (title/summary/views/auth/tables/design/security/mood — whichever fields
# the model has written so far). Same best-effort contract as OnFile — never
# allowed to affect the actual planning result, only this live progress
# signal.
OnPlanUpdate = Callable[[dict], None]

# Markers that must never appear in generated app code. Two families:
#
# 1. Raw network access — ALL remote I/O goes through @supabase/supabase-js
#    (the app's whole backend); raw fetch/XHR/WebSocket or hardcoded URLs
#    would bypass that boundary and open an exfiltration channel. The
#    Supabase URL/key enter only via the __SUPABASE_*__ placeholders,
#    substituted by the build worker — never literals.
# 2. XSS/injection sinks — "secure by construction" is a hard product rule:
#    generated apps render exclusively through normal JSX (React escapes all
#    interpolated values automatically), so the sinks that would ever make
#    that exploitable are banned outright. "innerHTML" as a substring also
#    catches "dangerouslySetInnerHTML".
FORBIDDEN_MARKERS = (
    # raw network (vendored packages' internals are not scanned)
    "fetch(",
    "XMLHttpRequest",
    "WebSocket(",
    "navigator.sendBeacon",
    "http://",
    "https://",
    # XSS / code-injection sinks
    "innerHTML",
    "outerHTML",
    "insertAdjacentHTML",
    "document.write",
    "eval(",
    "new Function",
    "javascript:",
)

# Exact top-level package names generated code may import, beyond its own
# local modules. This — plus the Radix/Next/React subpath families below —
# is the app's ENTIRE dependency surface: the same set vendored once into
# the worker image (see Settings.app_vendor_dir), so nothing here can ever
# require a per-build install.
ALLOWED_PACKAGES = (
    "next",
    "react",
    "react-dom",
    "@supabase/supabase-js",
    "lucide-react",
    "class-variance-authority",
    "clsx",
    "tailwind-merge",
    "tailwindcss-animate",
    # Config-file-only deps: tailwind.config.ts commonly does
    # `import type { Config } from "tailwindcss"`, and postcss.config.mjs
    # imports/references postcss + autoprefixer as plugins. All three are
    # vendored (see VENDORED_PACKAGE_VERSIONS) but were missing from this
    # import allowlist, which meant every generated app's own
    # tailwind.config.ts failed validation — fixed 2026-07-25.
    "tailwindcss",
    "postcss",
    "autoprefixer",
)

# Prefixes covering subpath imports of the above families (e.g.
# "next/link", "next/navigation", "react-dom/client",
# "@radix-ui/react-dialog").
ALLOWED_PACKAGE_PREFIXES = (
    "next/",
    "react/",
    "react-dom/",
    "@radix-ui/",
)

# Substituted with the linked Supabase project's real values by the build
# worker (stored source and GitHub pushes keep the placeholders, so repos
# stay portable and marketplace clones can be re-pointed at the cloner's
# own Supabase).
SUPABASE_URL_PLACEHOLDER = "__SUPABASE_URL__"
SUPABASE_ANON_KEY_PLACEHOLDER = "__SUPABASE_ANON_KEY__"
SUPABASE_WS_URL_PLACEHOLDER = "__SUPABASE_WS_URL__"

# Substituted with the real path the app is served under (the orchestrator's
# /preview/{build_id} proxy for live previews; the empty string for a Vercel
# release, which serves from the domain root) — see next.config.mjs's
# basePath/assetPrefix.
BASE_PATH_PLACEHOLDER = "__BASE_PATH__"

# Exact versions vendored ONCE at worker-image build time (see the
# app_vendor_dir stage in orchestrator/Dockerfile — keep the two in sync).
# The same literal table is hardcoded into the prompt text in
# app/agent/prompts.py's _SHARED_CODEGEN_RULES — keep all three in sync.
# codegen must pin package.json to exactly these: the local build worker
# ignores package.json entirely (it symlinks the pre-installed
# node_modules directly, never runs npm install), but a real Vercel
# release DOES run `npm install` from package.json, so its resolved
# dependency tree must match what was actually built and tested locally.
VENDORED_PACKAGE_VERSIONS: dict[str, str] = {
    "next": "^14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "typescript": "^5.5.4",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@types/node": "^20.14.10",
    "tailwindcss": "^3.4.7",
    "postcss": "^8.4.40",
    "autoprefixer": "^10.4.19",
    "tailwindcss-animate": "^1.0.7",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.4.0",
    "lucide-react": "^0.407.0",
    "@supabase/supabase-js": "^2.45.0",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-dialog": "^1.1.1",
    "@radix-ui/react-dropdown-menu": "^2.1.1",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-select": "^2.1.1",
    "@radix-ui/react-checkbox": "^1.1.1",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-avatar": "^1.1.0",
    "@radix-ui/react-popover": "^1.1.1",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-switch": "^1.1.0",
    "@radix-ui/react-toast": "^1.2.1",
}

# Every generated app must render this exact attribute from
# components/meero-badge.tsx — the mechanical guarantee behind the
# "Created by Meero" badge (belt-and-suspenders: the build worker also
# injects a static fallback into the built HTML if this is ever missing).
MEERO_BADGE_MARKER = "data-meero-badge"

# components/meero-error-reporter.tsx — the mechanical guarantee behind
# autonomous production self-healing: every generated app carries a client
# error reporter that writes real runtime errors to a `_meero_runtime_errors`
# table in the USER's OWN Supabase (via supabase-js — the only remote I/O
# generated apps may do; they can't fetch the orchestrator directly). The
# orchestrator then reads those errors back via the Management API and opens
# an auto-fix pull request. Enforced like the badge: required file + marker +
# rendered in layout. The telemetry TABLE is likewise required in schema.sql
# (see MEERO_ERRORS_TABLE / _validate_schema_sql).
MEERO_ERROR_REPORTER_MARKER = "data-meero-error-reporter"
MEERO_ERRORS_TABLE = "_meero_runtime_errors"

# components/meero-behavior-tracker.tsx — the mechanical guarantee behind
# the autonomous conversion-optimization agent: every generated app carries
# a client behavior tracker that writes anonymous visitor events (clicks,
# scroll depth, dead/rage clicks, form interactions, funnel/experiment
# events) to a `_meero_behavior_events` table in the USER's OWN Supabase,
# via supabase-js only, exactly like the error reporter. The orchestrator's
# conversion agent (app/conversion_agent.py) reads this back via the
# Management API to detect issues and run verified client-bucketed A/B
# experiments. Enforced like the badge/reporter: required file + marker +
# rendered in layout, plus a required table (unconditional, unlike the
# OPTIONAL _meero_emails table below) with specific required columns.
MEERO_BEHAVIOR_TRACKER_MARKER = "data-meero-behavior-tracker"
MEERO_BEHAVIOR_EVENTS_TABLE = "_meero_behavior_events"
_MEERO_BEHAVIOR_EVENTS_REQUIRED_COLUMNS = (
    "session_id",
    "event_type",
    "page_path",
    "experiment_key",
    "variant",
)

# lib/supabase.ts — the mechanical guarantee behind the "is your app ready?"
# readiness checklist: every app exposes its real Supabase client on
# window.__meeroSupabase (browser-only) so app/readiness_check.py can drive
# genuine signup/login/RLS-isolation checks against the LIVE app without
# knowing anything about its specific UI. Enforced like the badge/reporter:
# required marker in a required file.
MEERO_WINDOW_HOOK_MARKER = "__meeroSupabase"

# `_meero_emails` — the mechanical contract behind real transactional email
# (welcome emails, contact forms, order confirmations, …). Unlike the badge/
# error-reporter/window-hook, this is OPTIONALla only apps whose spec
# genuinely needs to send mail create this table (see prompts.py's concrete
# example). When present, its shape is fixed so the orchestrator's poller
# (app/workers or the in-process email poller — see app/main.py's
# _start_email_poller) can rely on exact column names: it reads real
# `status = 'pending'` rows back via the Management API (same
# read-the-user's-own-database pattern as MEERO_ERRORS_TABLE) and sends them
# through Resend, writing the real result back to `status`/`error`. Never a
# required file — it's a table shape, validated only if the app actually
# creates it.
MEERO_EMAILS_TABLE = "_meero_emails"
_MEERO_EMAILS_REQUIRED_COLUMNS = ("to_email", "subject", "body", "status")

# Literal strings excused from the network-marker scan before it runs.
# XML namespace identifiers are opaque strings, never fetched — inline SVG
# (the only sanctioned way to ship icons/imagery) legitimately carries them.
# meero.im is the one hardcoded outbound link the required badge component
# is allowed to carry (a plain <a>/<Link> browser navigation target, not a
# network call the generated JS makes) — see MEERO_BADGE_MARKER. (Was
# meero.dev — a stale placeholder domain the badge template in prompts.py
# still pointed at even after the real meero.im domain was bought
# 2026-07-25; fixed alongside that template, so both stay in sync.)
_SAFE_URL_EXCEPTIONS = (
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1999/xlink",
    "http://www.w3.org/1998/Math/MathML",
    "https://meero.im",
)


class ViewSpec(BaseModel):
    name: str
    purpose: str = Field(description="what this view/section is for")
    features: str = Field(description="concrete interactions it supports; 'static content' if none")
    layout: str = Field(description="how it's arranged visually")


class AppPlan(BaseModel):
    title: str = Field(description="Short, PascalCase-friendly title")
    summary: str
    views: list[ViewSpec]
    auth: str = Field(
        description="what requires a signed-in Supabase Auth session vs. what (if anything) is usable anonymously"
    )
    tables: str = Field(
        description="each Postgres table: exact columns with types, and its RLS ownership rule (e.g. auth.uid() = user_id)"
    )
    design: str = Field(
        description="a SPECIFIC domain-appropriate primary/accent color pairing (never a reflexive indigo-on-white default), typography feel via scale/weight (no custom font files available), spacing/layout system, responsive behavior — concrete enough to execute consistently, e.g. 'deep emerald + warm gold accents, soft gradients, generous whitespace' rather than 'clean and modern'"
    )
    security: str = Field(
        description="concrete risks for THIS app (cross-user data access, stored XSS, anonymous writes, …) and how the schema + code avoid them"
    )
    mood: str


class GeneratedFile(BaseModel):
    path: str
    content: str


class ProjectBundle(BaseModel):
    files: list[GeneratedFile]


class CodegenError(Exception):
    """Raised when generated output violates Meero's hard rules."""


class TargetedFix(BaseModel):
    """Structured output for a SCOPED fix — only the file(s) an error
    concretely implicates, not the whole project. See fix_project."""

    explanation: str = Field(
        description="1-3 plain sentences for a non-technical reader: what "
        "was actually wrong, and what you changed to fix it."
    )
    insufficient: bool = Field(
        default=False,
        description="True ONLY if fixing this error genuinely requires "
        "changing a file that wasn't provided — never guess a partial fix "
        "when the real cause lies elsewhere.",
    )
    files: list[GeneratedFile] = Field(default_factory=list)


@dataclass
class FixResult:
    """Everything fix_project produces: the full resulting project (so
    every downstream caller — write_bundle, replace_build_files — keeps
    working unchanged), plus what actually changed and why, for real
    diff/explanation UI. `targeted=True` means only changed_paths were
    regenerated and sent to the model; every other file was carried forward
    byte-for-byte, never touched. `targeted=False` means the error couldn't
    be confidently scoped (or the model itself said the fix needed a file
    outside the given scope) and the WHOLE project was regenerated instead —
    changed_paths/diffs are still computed by comparing old vs new, so the
    UI can show real "what changed" even for a full regenerate."""

    bundle: ProjectBundle
    explanation: str
    changed_paths: list[str]
    diffs: dict[str, str]
    targeted: bool


def model_for_plan(plan: str | None, preferred_model: str | None = None) -> str:
    """Free-plan users get the cheap OpenAI model; Pro/Ultra get Claude
    Sonnet via Anthropic by default (owner decision, 2026-08-09 — supersedes
    the all-OpenAI choice from 2026-07-16), or GPT-5.6 Terra if they've
    explicitly chosen it in the composer's model selector
    (`projects.preferred_model`, 00048_project_model_preference.sql, bumped
    to gpt-5.6-terra in 00049). This is the ONLY place plan→model
    routing lives; llm() below dispatches provider purely from the string
    this returns, so nothing else needs to know which plan maps to which
    vendor.

    `preferred_model` is trusted here ONLY after being re-validated against
    the real allowed set and the caller's real plan — defense in depth on
    top of the DB trigger (`projects_enforce_model_gating`) that already
    guarantees a free-plan project can never persist a non-null value."""
    settings = get_settings()
    if plan in ("pro", "ultra") and preferred_model in (
        settings.anthropic_model,
        settings.openai_model,
    ):
        return preferred_model
    return settings.anthropic_model if plan in ("pro", "ultra") else settings.openai_model_free


# Anthropic's Messages API requires max_tokens on every request (unlike
# OpenAI, which has a workable server-side default) — this is what llm()
# below falls back to for the handful of call sites that don't pass an
# explicit max_tokens (plain chat replies, the ChatAction/AppPlan structured
# calls). Generous enough for a full structured AppPlan or a long chat
# reply without being wastefully large.
_ANTHROPIC_DEFAULT_MAX_TOKENS = 8192


def llm(max_tokens: int | None = None, model: str | None = None) -> BaseChatModel:
    """LangChain chat model bound to the configured model for whichever plan
    called model_for_plan() — OpenAI for free, Claude Sonnet (Anthropic) for
    Pro/Ultra. Provider is dispatched purely by the model NAME (a "claude"
    prefix), so every call site in this file and app/agent/graph.py stays
    identical regardless of which plan is calling — none of them need to
    know or care which vendor is behind the model they asked for.

    `stream_usage=True` (OpenAI only — Anthropic's API always includes
    usage in streaming responses natively, so ChatAnthropic has no
    equivalent flag and doesn't need one) makes streamed responses emit a
    final chunk carrying `usage_metadata` (input/output/total tokens),
    which the chat agent uses to bill real token usage — see
    app/agent/graph.py and app/main.py. Both ChatOpenAI and ChatAnthropic
    populate the same standardized `usage_metadata` field LangChain defines,
    so graph.py's `_usage_tokens()` reads it identically either way.

    `timeout` is a real reliability backstop, not a nicety: codegen-worker
    runs a single-replica blocking loop, one job at a time, with no other
    guard against a hung request. Without this, a single stalled LLM call
    would freeze every other user's build behind it in the queue forever
    (the SDK's own default timeout is ~10 minutes) instead of just failing
    the one build that's actually stuck.
    """
    settings = get_settings()
    resolved_model = model or settings.openai_model

    if resolved_model.startswith("claude"):
        return ChatAnthropic(
            model_name=resolved_model,
            api_key=settings.anthropic_api_key,
            timeout=settings.openai_timeout_s,
            max_tokens_to_sample=max_tokens or _ANTHROPIC_DEFAULT_MAX_TOKENS,
        )
    kwargs: dict = {}
    if max_tokens is not None:
        kwargs["max_tokens"] = max_tokens
    return ChatOpenAI(
        model=resolved_model,
        api_key=settings.openai_api_key,
        stream_usage=True, 
        timeout=settings.openai_timeout_s,
        **kwargs,
    )


_TITLE_SYSTEM_PROMPT = (
    "You write short, punchy product names for apps, based on a one-line "
    "description of what someone wants built. Reply with ONLY the title — "
    "2 to 5 words, Title Case, no quotes, no trailing punctuation, no "
    "generic filler words like 'App' or 'Platform' unless genuinely part of "
    "the name."
)


def generate_display_title(prompt_text: str) -> str | None:
    """A real, cheap LLM call (always the free-tier model — this is a tiny
    task regardless of the project owner's plan) turning a raw build prompt
    into a short display title for the public gallery
    (src/components/landing/public-gallery.tsx), instead of showing the
    prompt itself. Returns None on any failure or nonsense output — the
    caller falls back to the project's existing name, never a blank title."""
    settings = get_settings()
    try:
        response = llm(max_tokens=20, model=settings.openai_model_free).invoke(
            [
                ("system", _TITLE_SYSTEM_PROMPT),
                ("user", prompt_text[:500]),
            ]
        )
    except Exception:
        return None
    title = str(response.content or "").strip().strip("\"'").strip()
    if not title or len(title) > 60 or "\n" in title:
        return None
    return title


# Hand-written JSON schema mirroring AppPlan, for the same reason
# _BUNDLE_STREAM_SCHEMA exists: a *dict* schema makes LangChain use its
# streaming JSON parser, yielding progressively-completed partial dicts as
# tokens arrive — the Pydantic class path only ever yields the FINAL object.
# This is what lets the chat show the plan appearing field by field
# ("Planning the app…" no longer sits on a blank screen for 10-20s).
_PLAN_STREAM_SCHEMA = {
    "title": "AppPlan",
    "description": "The build plan for the app.",
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Short, PascalCase-friendly title"},
        "summary": {"type": "string"},
        "views": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "purpose": {"type": "string", "description": "what this view/section is for"},
                    "features": {
                        "type": "string",
                        "description": "concrete interactions it supports; 'static content' if none",
                    },
                    "layout": {"type": "string", "description": "how it's arranged visually"},
                },
                "required": ["name", "purpose", "features", "layout"],
            },
        },
        "auth": {
            "type": "string",
            "description": "what requires a signed-in Supabase Auth session vs. what (if anything) is usable anonymously",
        },
        "tables": {
            "type": "string",
            "description": "each Postgres table: exact columns with types, and its RLS ownership rule (e.g. auth.uid() = user_id)",
        },
        "design": {
            "type": "string",
            "description": "a SPECIFIC domain-appropriate primary/accent color pairing (never a reflexive indigo-on-white default), typography feel via scale/weight (no custom font files available), spacing/layout system, responsive behavior",
        },
        "security": {
            "type": "string",
            "description": "concrete risks for THIS app (cross-user data access, stored XSS, anonymous writes, …) and how the schema + code avoid them",
        },
        "mood": {"type": "string"},
    },
    "required": ["title", "summary", "views", "auth", "tables", "design", "security", "mood"],
}


def _plan_chunk_to_dict(chunk: object) -> dict:
    """Best-effort read of a streamed plan chunk (a plain dict from the
    JSON-schema streaming parser in the normal case) into a plain dict safe
    to publish over the WS. Never raises — an unrecognized shape just
    reports nothing rather than breaking the live progress signal."""
    if isinstance(chunk, dict):
        return chunk
    if hasattr(chunk, "model_dump"):
        try:
            dumped = chunk.model_dump()
            return dumped if isinstance(dumped, dict) else {}
        except Exception:
            return {}
    return {}


def plan_app(
    prompt: str,
    model: str | None = None,
    should_cancel: ShouldCancel | None = None,
    on_plan: OnPlanUpdate | None = None,
) -> AppPlan:
    if should_cancel is not None and should_cancel():
        raise BuildCanceled()
    messages = [
        ("system", prompts.PLAN_SYSTEM),
        ("user", prompts.PLAN_USER_TEMPLATE.format(prompt=prompt)),
    ]

    if on_plan is not None:
        try:
            structured = llm(model=model).with_structured_output(
                _PLAN_STREAM_SCHEMA, method="function_calling"
            )
            final: object = None
            last_cancel_check = time.monotonic()
            for chunk in structured.stream(messages):
                if should_cancel is not None:
                    now = time.monotonic()
                    if now - last_cancel_check >= _CANCEL_POLL_INTERVAL_S:
                        last_cancel_check = now
                        if should_cancel():
                            raise BuildCanceled()
                final = chunk
                try:
                    on_plan(_plan_chunk_to_dict(chunk))
                except Exception:
                    pass  # progress reporting must never affect codegen
            if final is not None:
                plan = (
                    final
                    if isinstance(final, AppPlan)
                    else AppPlan.model_validate(_plan_chunk_to_dict(final))
                )
                if plan.views:
                    return plan
        except BuildCanceled:
            raise
        except Exception:
            pass  # fall through to the plain, non-streaming call below

    plan = llm(model=model).with_structured_output(AppPlan).invoke(messages)
    if not isinstance(plan, AppPlan):
        raise CodegenError("Planner returned no parseable plan.")
    if not plan.views:
        raise CodegenError("Planner returned an app with no views.")
    return plan


def _validate_path(path: str) -> None:
    p = PurePosixPath(path)
    if p.is_absolute() or ".." in p.parts or "\\" in path:
        raise CodegenError(f"Unsafe file path in generated output: {path!r}")


# schema.sql may only contain these statement shapes (checked per statement,
# after comment stripping). Idempotent, additive DDL + RLS — nothing that
# could destroy the user's data or widen access on their own database.
_SCHEMA_ALLOWED_PREFIXES = (
    "create table if not exists",
    "create index if not exists",
    "create unique index if not exists",
    "alter table",
    "drop policy if exists",
    "create policy",
)

# Banned anywhere in schema.sql, regardless of statement shape.
_SCHEMA_FORBIDDEN = (
    "drop table",
    "drop schema",
    "drop database",
    "truncate",
    "grant ",
    "revoke ",
    "create role",
    "alter role",
    "drop role",
    "create extension",
    "alter database",
    "security definer",
    "create function",
    "create or replace function",
    "do $$",
    "$$",
    "pg_",
    "copy ",
)


def _normalize_table_name(raw: str) -> str:
    name = raw.strip().strip(";").replace('"', "")
    if name.startswith("public."):
        name = name[len("public.") :]
    return name.lower()


# Table-constraint keywords that begin a top-level item in a create-table body
# but are NOT a column name — used to skip them when collecting column names.
_TABLE_CONSTRAINT_KW = frozenset(
    {"primary", "foreign", "unique", "check", "constraint", "exclude", "like"}
)
# The only verbs a single CREATE POLICY may target (Postgres allows exactly
# one, or none = ALL — never a comma-separated list like `for insert, update`).
_POLICY_VERB_RE = re.compile(r"\bfor\s+(all|select|insert|update|delete)\b")
# A comma immediately after the verb == an illegal multi-verb list.
_POLICY_MULTI_VERB_RE = re.compile(
    r"\bfor\s+(?:all|select|insert|update|delete)\s*,"
)


def _paren_body(s: str) -> str | None:
    """The text inside the FIRST balanced (...) in `s`, or None. Depth-aware,
    so nested parens (e.g. a column's own `check (x in ('a','b'))`) don't end
    the span early."""
    start = s.find("(")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(s)):
        if s[i] == "(":
            depth += 1
        elif s[i] == ")":
            depth -= 1
            if depth == 0:
                return s[start + 1 : i]
    return None


def _split_top_level_commas(s: str) -> list[str]:
    """Split on commas that sit at paren-depth 0 — so a create-table body
    splits into column/constraint items without breaking inside a nested
    `(...)` (a `references t (id)`, an `in ('a','b')`, etc.)."""
    parts: list[str] = []
    depth = 0
    cur: list[str] = []
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    if cur:
        parts.append("".join(cur))
    return parts


def _columns_from_create_table(stmt_lower: str) -> set[str]:
    """The declared column names of a normalized `create table if not exists
    t ( ... )` statement — the first token of each top-level item that isn't a
    table constraint. Best-effort: anything it can't confidently read as a
    plain column is simply skipped (never guessed), so the column-existence
    check it feeds stays false-positive-free."""
    body = _paren_body(stmt_lower)
    if body is None:
        return set()
    cols: set[str] = set()
    for part in _split_top_level_commas(body):
        tokens = part.strip().split()
        if not tokens:
            continue
        first = tokens[0].strip('"')
        if first in _TABLE_CONSTRAINT_KW:
            continue
        if re.fullmatch(r"[a-z_][a-z0-9_]*", first):
            cols.add(first)
    return cols


def _validate_policy_statement(
    statement: str, stmt_lower: str, own_table: str | None, columns: set[str]
) -> None:
    """Catch the two invalid-RLS-policy shapes that otherwise pass codegen and
    only fail when applied to the user's REAL Postgres (a cryptic
    `syntax error at or near ","` or `column "..." does not exist`): an illegal
    FOR clause, and an owner check against a column the table doesn't have.
    Each message spells out the correct form, so the same-build self-correction
    can actually fix it instead of looping on the raw DB error."""
    # 1. FOR clause: exactly one verb, and the right USING/WITH CHECK pairing.
    if _POLICY_MULTI_VERB_RE.search(stmt_lower):
        raise CodegenError(
            f"schema.sql policy {statement[:80]!r}… uses a multi-verb FOR "
            f"clause like `for insert, update` — Postgres CREATE POLICY takes "
            f"EXACTLY ONE of for select / for insert / for update / for delete "
            f"(or for all). Write a SEPARATE `create policy` for each verb "
            f"(each with its own `drop policy if exists` first)."
        )
    verb_match = _POLICY_VERB_RE.search(stmt_lower)
    verb = verb_match.group(1) if verb_match else "all"
    has_using = bool(re.search(r"\busing\s*\(", stmt_lower))
    has_check = bool(re.search(r"\bwith\s+check\s*\(", stmt_lower))
    if verb == "insert" and has_using:
        raise CodegenError(
            f"schema.sql policy {statement[:80]!r}… is `for insert` but has a "
            f"USING clause — an INSERT policy takes WITH CHECK only, never "
            f"USING. Use `for insert to authenticated with check (<expr>)`."
        )
    if verb == "insert" and not has_check:
        raise CodegenError(
            f"schema.sql policy {statement[:80]!r}… is `for insert` with no "
            f"WITH CHECK clause — an INSERT policy needs `with check (<expr>)` "
            f"(e.g. `with check (auth.uid() = user_id)`)."
        )
    if verb in ("select", "delete") and has_check:
        raise CodegenError(
            f"schema.sql policy {statement[:80]!r}… is `for {verb}` but has a "
            f"WITH CHECK clause — a {verb.upper()} policy takes USING only. "
            f"Use `for {verb} to authenticated using (<expr>)`."
        )

    # 2. Owner check against a real column. Only for DIRECT comparisons
    #    (`auth.uid() = <col>`) with NO subquery — a membership policy that
    #    reads another table always has a `(select ... from ...)`, whose
    #    columns legitimately aren't on `own_table`, so those are left alone.
    if not own_table or not columns:
        return
    has_subquery = bool(re.search(r"\(\s*select\b", stmt_lower)) or " from " in stmt_lower
    if has_subquery:
        return
    suspects: set[str] = set()
    for m in re.finditer(r"auth\.uid\(\)\s*=\s*([a-z_][a-z0-9_.]*)", stmt_lower):
        suspects.add(m.group(1))
    for m in re.finditer(r"([a-z_][a-z0-9_.]*)\s*=\s*auth\.uid\(\)", stmt_lower):
        suspects.add(m.group(1))
    for suspect in suspects:
        col = suspect
        if "." in suspect:
            prefix, _, rest = suspect.partition(".")
            if _normalize_table_name(prefix) != own_table:
                continue  # qualified to another table — out of scope here
            col = rest
        if col not in columns:
            raise CodegenError(
                f"schema.sql policy {statement[:80]!r}… checks "
                f"`auth.uid() = {suspect}`, but table {own_table!r} has no "
                f"{col!r} column (its columns are: "
                f"{', '.join(sorted(columns)) or 'none'}). Either add "
                f"`{col} uuid not null default auth.uid()` to that table's "
                f"`create table`, or reference the column that actually holds "
                f"the owner (a table keyed on auth.users uses its own `id`, so "
                f"check `auth.uid() = id`)."
            )


def _validate_schema_sql(content: str) -> None:
    """Statement-level allowlist for the generated migration. This runs
    against the user's OWN database, so it's held to the same standard as
    the JS validation: destructive or privilege-changing SQL never leaves
    codegen, and every created table must ship RLS + at least one policy
    (Meero's own product rule, applied to generated apps)."""
    no_comments = re.sub(r"--[^\n]*", "", content)
    lowered = no_comments.lower()
    for marker in _SCHEMA_FORBIDDEN:
        if marker in lowered:
            if marker in ("create function", "create or replace function", "security definer"):
                raise CodegenError(
                    f"schema.sql contains forbidden SQL marker {marker.strip()!r} — "
                    f"functions/triggers are never allowed in schema.sql (a bigger "
                    f"attack surface than plain DDL), no exceptions. If this was "
                    f"meant to auto-create a per-user row (e.g. a profiles table) "
                    f"on signup, do that from the CLIENT instead: insert the row "
                    f"directly after supabase.auth.signUp() succeeds, under the "
                    f"new user's own session — a normal owner-scoped RLS policy "
                    f"already covers it, no trigger needed."
                )
            if marker == "create extension":
                raise CodegenError(
                    "schema.sql contains forbidden SQL marker 'create extension' — "
                    "extensions are never allowed and never actually needed. "
                    "gen_random_uuid() already works on Supabase with zero setup "
                    "(no pgcrypto/uuid-ossp required) — use that for every id "
                    "column. For search, use plain ilike '%term%' or the built-in "
                    "to_tsvector/to_tsquery instead of pg_trgm. The Management API "
                    "call that applies this migration can't grant extension "
                    "privileges anyway, so create extension would fail even if it "
                    "were allowed."
                )
            raise CodegenError(
                f"schema.sql contains forbidden SQL marker {marker.strip()!r} — "
                f"only additive, idempotent table/index/policy DDL is allowed."
            )

    statements = [s.strip() for s in no_comments.split(";") if s.strip()]
    for statement in statements:
        first_line = " ".join(statement.lower().split())
        if not first_line.startswith(_SCHEMA_ALLOWED_PREFIXES):
            if first_line.startswith("create type"):
                raise CodegenError(
                    f"schema.sql statement {statement[:80]!r}… uses 'create type "
                    f"... as enum', which isn't allowed. Use a text column with a "
                    f"real check constraint instead, e.g. status text not null "
                    f"default 'pending' check (status in ('pending', 'active', "
                    f"'done')) — equivalent, and idempotent-safe unlike an enum "
                    f"type."
                )
            raise CodegenError(
                f"schema.sql statement {statement[:80]!r}… isn't in the allowed "
                f"set (create table/index if not exists, alter table, "
                f"drop policy if exists, create policy)."
            )
        if first_line.startswith("alter table") and not (
            "enable row level security" in first_line
            or "add column if not exists" in first_line
        ):
            raise CodegenError(
                f"schema.sql alter statement {statement[:80]!r}… must be either "
                f"'enable row level security' or 'add column if not exists'."
            )
        if first_line.startswith("create table") and "if not exists" not in first_line:
            raise CodegenError(
                "schema.sql create table statements must use IF NOT EXISTS "
                "(the migration re-applies on every build)."
            )

    # Statement ORDER matters and the checks above only look at each
    # statement in isolation: Postgres requires a table to already exist
    # before anything references it — a foreign key (`references other`), a
    # policy created `on` it, or a policy's own USING/WITH CHECK subquery
    # (`from other`/`join other`). Real failure mode this catches at codegen
    # time instead of against the user's live database: "relation ... does
    # not exist" when applying schema.sql, because e.g. a table's policy
    # checks membership via a second table that's declared later in the
    # file. auth.*/storage.* are Supabase's own always-present schemas, so
    # references to those are never flagged.
    _own_table_patterns = (
        re.compile(r"^create\s+table\s+if\s+not\s+exists\s+([a-zA-Z0-9_.\"]+)"),
        re.compile(r"^alter\s+table\s+(?:if\s+exists\s+)?([a-zA-Z0-9_.\"]+)"),
        re.compile(r"^drop\s+policy\s+if\s+exists\s+.+?\s+on\s+([a-zA-Z0-9_.\"]+)", re.DOTALL),
        re.compile(r"^create\s+policy\s+.+?\s+on\s+([a-zA-Z0-9_.\"]+)", re.DOTALL),
    )
    _reference_re = re.compile(r"\breferences\s+([a-zA-Z0-9_.\"]+)")
    _from_join_re = re.compile(r"\b(?:from|join)\s+([a-zA-Z0-9_.\"]+)")

    def _is_builtin(name: str) -> bool:
        return name.startswith("auth.") or name.startswith("storage.")

    declared: set[str] = set()
    # Real column names per table, accumulated as create table / add column
    # statements are seen — feeds the policy owner-column check below. Ordering
    # (create table before its policies) is already enforced above, so a
    # policy's table is always populated here by the time we reach it.
    table_columns: dict[str, set[str]] = {}
    _add_column_re = re.compile(
        r"^alter\s+table\s+(?:if\s+exists\s+)?[a-zA-Z0-9_.\"]+\s+"
        r"add\s+column\s+if\s+not\s+exists\s+([a-zA-Z0-9_\"]+)"
    )
    for statement in statements:
        stmt_lower = " ".join(statement.lower().split())
        is_create_table = stmt_lower.startswith("create table")
        own_table = None
        for pattern in _own_table_patterns:
            m = pattern.match(stmt_lower)
            if m:
                own_table = _normalize_table_name(m.group(1))
                break

        if (
            own_table
            and not is_create_table
            and not _is_builtin(own_table)
            and own_table not in declared
        ):
            raise CodegenError(
                f"schema.sql statement {statement[:80]!r}… targets table "
                f"{own_table!r} before it's created — move "
                f"`create table if not exists {own_table} (...)` earlier in "
                f"schema.sql, before this statement."
            )

        for ref_match in _reference_re.finditer(stmt_lower):
            ref = _normalize_table_name(ref_match.group(1))
            if ref != own_table and not _is_builtin(ref) and ref not in declared:
                raise CodegenError(
                    f"schema.sql statement {statement[:80]!r}… references "
                    f"table {ref!r} via a foreign key before {ref!r} is "
                    f"created — move `create table if not exists {ref} "
                    f"(...)` earlier in schema.sql, before anything that "
                    f"references it."
                )

        if stmt_lower.startswith("create policy"):
            for fj_match in _from_join_re.finditer(stmt_lower):
                other = _normalize_table_name(fj_match.group(1))
                if other != own_table and not _is_builtin(other) and other not in declared:
                    raise CodegenError(
                        f"schema.sql's policy on {own_table!r} reads from "
                        f"table {other!r} in its USING/WITH CHECK clause "
                        f"before {other!r} is created — move `create table "
                        f"if not exists {other} (...)` earlier in "
                        f"schema.sql, before this policy."
                    )
            _validate_policy_statement(
                statement, stmt_lower, own_table, table_columns.get(own_table, set())
            )

        if is_create_table and own_table:
            declared.add(own_table)
            table_columns[own_table] = _columns_from_create_table(stmt_lower)
        elif own_table and (add_col := _add_column_re.match(stmt_lower)):
            table_columns.setdefault(own_table, set()).add(
                add_col.group(1).strip('"')
            )

    # Every created table must enable RLS and carry at least one policy.
    created = {
        _normalize_table_name(m.group(1))
        for m in re.finditer(
            r"create\s+table\s+if\s+not\s+exists\s+([a-zA-Z0-9_.\"]+)", lowered
        )
    }
    rls_enabled = {
        _normalize_table_name(m.group(1))
        for m in re.finditer(
            r"alter\s+table\s+(?:if\s+exists\s+)?([a-zA-Z0-9_.\"]+)\s+enable\s+row\s+level\s+security",
            lowered,
        )
    }
    with_policy = {
        _normalize_table_name(m.group(1))
        for m in re.finditer(
            r"create\s+policy\s+.+?\s+on\s+([a-zA-Z0-9_.\"]+)", lowered, re.DOTALL
        )
    }
    for table in sorted(created):
        if table not in rls_enabled:
            raise CodegenError(
                f"schema.sql creates table {table!r} without enabling row level "
                f"security on it — every table gets RLS, no exceptions."
            )
        if table not in with_policy:
            raise CodegenError(
                f"schema.sql creates table {table!r} with no policies — RLS is "
                f"the app's real authorization boundary; every table needs at "
                f"least one policy."
            )

    # The runtime-error telemetry table is mandatory — it's what the client
    # error reporter writes to and what the orchestrator reads back to open
    # auto-fix PRs. Its own RLS + insert policy are covered by the loop above.
    if MEERO_ERRORS_TABLE not in created:
        raise CodegenError(
            f"schema.sql must create the {MEERO_ERRORS_TABLE!r} table (the "
            f"runtime error telemetry the self-healing pipeline depends on) — "
            f"with RLS and an insert policy for anon + authenticated."
        )

    # The visitor-behavior telemetry table is likewise mandatory — it's what
    # the required behavior tracker writes to and what the conversion agent
    # depends on for detection and experiment evaluation. Unlike the
    # runtime-errors table, this one has several load-bearing columns the
    # orchestrator's readback queries rely on by name, so check those too.
    if MEERO_BEHAVIOR_EVENTS_TABLE not in created:
        raise CodegenError(
            f"schema.sql must create the {MEERO_BEHAVIOR_EVENTS_TABLE!r} "
            f"table (the visitor-behavior telemetry the conversion agent "
            f"depends on) — with RLS and an insert policy for anon + "
            f"authenticated."
        )
    behavior_create_stmt = next(
        (
            s
            for s in statements
            if s.lower().lstrip().startswith("create table if not exists")
            and MEERO_BEHAVIOR_EVENTS_TABLE in s.lower()
        ),
        None,
    )
    missing_behavior_cols = [
        c
        for c in _MEERO_BEHAVIOR_EVENTS_REQUIRED_COLUMNS
        if not behavior_create_stmt or c not in behavior_create_stmt.lower()
    ]
    if missing_behavior_cols:
        raise CodegenError(
            f"schema.sql's {MEERO_BEHAVIOR_EVENTS_TABLE!r} table is missing "
            f"required column(s) {', '.join(missing_behavior_cols)} — the "
            f"conversion agent depends on this exact shape."
        )

    # Optional transactional-email table — only validated (for the fixed
    # column shape the poller relies on) if the app actually created it.
    if MEERO_EMAILS_TABLE in created:
        create_stmt = next(
            (
                s
                for s in statements
                if s.lower().lstrip().startswith("create table if not exists")
                and MEERO_EMAILS_TABLE in s.lower()
            ),
            None,
        )
        missing_cols = [
            c
            for c in _MEERO_EMAILS_REQUIRED_COLUMNS
            if not create_stmt or c not in create_stmt.lower()
        ]
        if missing_cols:
            raise CodegenError(
                f"schema.sql's {MEERO_EMAILS_TABLE!r} table is missing required "
                f"column(s) {', '.join(missing_cols)} — the transactional-email "
                f"poller depends on this exact shape (to_email text, subject "
                f"text, body text, status text default 'pending')."
            )


def _is_allowed_import(spec: str) -> bool:
    if spec.startswith(".") or spec.startswith("@/"):
        return True
    if spec in ALLOWED_PACKAGES:
        return True
    return spec.startswith(ALLOWED_PACKAGE_PREFIXES)


# Every one of these must exist for `next build` (static export) to even
# start, or for the app to have a real backend/badge at all.
_REQUIRED_FILES = (
    "package.json",
    "next.config.mjs",
    "tsconfig.json",
    "tailwind.config.ts",
    "postcss.config.mjs",
    "app/globals.css",
    "app/layout.tsx",
    "app/page.tsx",
    "components/meero-badge.tsx",
    "components/meero-error-reporter.tsx",
    "components/meero-behavior-tracker.tsx",
    "lib/utils.ts",
    "lib/supabase.ts",
    "schema.sql",
)


def _validate_bundle(bundle: ProjectBundle) -> None:
    if not bundle.files:
        raise CodegenError("Codegen returned an empty project.")
    for f in bundle.files:
        _validate_path(f.path)
        # Dynamic route segments (a bracketed folder like app/post/[id]/) are
        # incompatible with `output: "export"` unless they declare
        # generateStaticParams() — and they genuinely can't, since the params
        # (a post id, etc.) live in the user's Supabase and only exist at
        # runtime, not build time. `next build` fails hard on this ("Page
        # ... is missing generateStaticParams()"). Catch it at codegen so the
        # error is attributed here (and the auto-fix retry gets the real
        # alternative) instead of burning a full build first. Route GROUPS
        # (parentheses, e.g. app/(auth)/) are fine — only square brackets
        # denote a dynamic segment.
        if f.path.startswith("app/") and ("[" in f.path or "]" in f.path):
            raise CodegenError(
                f"Generated file {f.path!r} uses a dynamic route segment "
                "([param]), which breaks the static export (`output: "
                '"export"`) — its params live in the user\'s Supabase at '
                "runtime, so they can't be known at build time. Build the "
                "whole app inside app/page.tsx as a single-page client app: "
                "show detail/sub-views with client-side React state (or a "
                "query param read via useSearchParams), never a Next.js "
                "dynamic route folder."
            )
        if f.path == "schema.sql":
            _validate_schema_sql(f.content)
            continue
        if "next/font" in f.content:
            raise CodegenError(
                f"Generated file {f.path!r} imports next/font — it fetches "
                "font files over the network at `next build` time, and the "
                "build worker runs the real build fully offline against a "
                "pre-vendored toolchain with no install/fetch step, so this "
                "silently breaks the build. Use Tailwind's built-in "
                "font-sans (native system-ui stack) or font-serif instead, "
                "and get a distinctive feel via type scale and font-weight "
                "contrast rather than a custom font file."
            )
        scrubbed = f.content
        for exception in _SAFE_URL_EXCEPTIONS:
            scrubbed = scrubbed.replace(exception, "")
        lowered = scrubbed.lower()
        for marker in FORBIDDEN_MARKERS:
            if marker.lower() in lowered:
                raise CodegenError(
                    f"Generated file {f.path!r} contains forbidden "
                    f"marker {marker!r} (all remote I/O goes through "
                    f"@supabase/supabase-js, and no XSS/injection sinks are "
                    f"allowed in generated apps)."
                )
        # Every import must be local (relative or the "@/" alias) or one of
        # the vendored packages. Nothing else is installed on the worker, so
        # anything else fails the real `next build` anyway; catch it here so
        # the error is attributed to codegen, not the build.
        if f.path.endswith((".ts", ".tsx", ".js", ".mjs")):
            for match in re.finditer(r"""from\s+["']([^"']+)["']""", f.content):
                spec = match.group(1)
                if not _is_allowed_import(spec):
                    raise CodegenError(
                        f"Generated file {f.path!r} imports {spec!r} — only "
                        f"local modules and the vendored Next/React/"
                        f"shadcn/Supabase toolchain are allowed."
                    )
    paths = {f.path for f in bundle.files}
    missing = set(_REQUIRED_FILES) - paths
    if missing:
        raise CodegenError(
            f"App bundle is missing required file(s): {', '.join(sorted(missing))}."
        )

    badge = next(f for f in bundle.files if f.path == "components/meero-badge.tsx")
    if MEERO_BADGE_MARKER not in badge.content:
        raise CodegenError(
            "components/meero-badge.tsx doesn't render the required "
            f"{MEERO_BADGE_MARKER!r} marker — every app must carry the "
            "'Created by Meero' badge."
        )
    layout = next(f for f in bundle.files if f.path == "app/layout.tsx")
    if "meero-badge" not in layout.content.lower():
        raise CodegenError(
            "app/layout.tsx doesn't render <MeeroBadge /> — every app must "
            "carry the 'Created by Meero' badge."
        )

    reporter = next(
        f for f in bundle.files if f.path == "components/meero-error-reporter.tsx"
    )
    if MEERO_ERROR_REPORTER_MARKER not in reporter.content:
        raise CodegenError(
            "components/meero-error-reporter.tsx doesn't carry the required "
            f"{MEERO_ERROR_REPORTER_MARKER!r} marker — every app must ship the "
            "runtime error reporter (autonomous self-healing telemetry)."
        )
    if "meero-error-reporter" not in layout.content.lower():
        raise CodegenError(
            "app/layout.tsx doesn't render <MeeroErrorReporter /> — every app "
            "must ship the runtime error reporter."
        )

    tracker = next(
        f for f in bundle.files if f.path == "components/meero-behavior-tracker.tsx"
    )
    if MEERO_BEHAVIOR_TRACKER_MARKER not in tracker.content:
        raise CodegenError(
            "components/meero-behavior-tracker.tsx doesn't carry the required "
            f"{MEERO_BEHAVIOR_TRACKER_MARKER!r} marker — every app must ship "
            "the behavior tracker (conversion-optimization telemetry)."
        )
    if "meero-behavior-tracker" not in layout.content.lower():
        raise CodegenError(
            "app/layout.tsx doesn't render <MeeroBehaviorTracker /> — every "
            "app must ship the behavior tracker."
        )

    supabase_client = next(f for f in bundle.files if f.path == "lib/supabase.ts")
    if MEERO_WINDOW_HOOK_MARKER not in supabase_client.content:
        raise CodegenError(
            "lib/supabase.ts doesn't expose the client on "
            f"{MEERO_WINDOW_HOOK_MARKER!r} — every app must do this so the "
            "platform's automated readiness checks can run."
        )

    package_json = next(f for f in bundle.files if f.path == "package.json")
    try:
        declared = json.loads(package_json.content)
    except json.JSONDecodeError as exc:
        raise CodegenError(f"package.json isn't valid JSON: {exc}") from exc
    for section in ("dependencies", "devDependencies"):
        for name, version in (declared.get(section) or {}).items():
            pinned = VENDORED_PACKAGE_VERSIONS.get(name)
            if pinned is None:
                raise CodegenError(
                    f"package.json depends on {name!r}, which isn't part of "
                    f"the vendored toolchain — a real npm install would "
                    f"fetch an untested package."
                )
            if version != pinned:
                raise CodegenError(
                    f"package.json pins {name!r} to {version!r}, but the "
                    f"vendored (tested) version is {pinned!r} — copy the "
                    f"version string exactly."
                )

    next_config = next(f for f in bundle.files if f.path == "next.config.mjs")
    if BASE_PATH_PLACEHOLDER not in next_config.content:
        raise CodegenError(
            "next.config.mjs doesn't use the __BASE_PATH__ placeholder for "
            "basePath/assetPrefix — the built app wouldn't resolve its own "
            "assets when served from the live preview path."
        )

    all_code = "\n".join(
        f.content for f in bundle.files if f.path.endswith((".ts", ".tsx"))
    )
    if (
        SUPABASE_URL_PLACEHOLDER not in all_code
        or SUPABASE_ANON_KEY_PLACEHOLDER not in all_code
    ):
        raise CodegenError(
            "Generated code never creates the Supabase client from the "
            "__SUPABASE_URL__ / __SUPABASE_ANON_KEY__ placeholders — the app "
            "would have no backend."
        )


def _files_from_chunk(chunk: object) -> list[dict] | None:
    """Best-effort read of the (possibly still-partial) `files` list from a
    streamed structured-output chunk, which may arrive as a dict or a
    partially-populated Pydantic model depending on how much has streamed
    in so far."""
    if isinstance(chunk, dict):
        files = chunk.get("files")
    else:
        files = getattr(chunk, "files", None)
    return files if isinstance(files, list) else None


def _entry_field(entry: object, name: str) -> str | None:
    """Read one field of a streamed file entry, which may be a dict or a
    partially-populated Pydantic model."""
    value = entry.get(name) if isinstance(entry, dict) else getattr(entry, name, None)
    return value if isinstance(value, str) else None


# Hand-written JSON schema for the streaming codegen call. Passing a *dict*
# schema (rather than the ProjectBundle Pydantic class) makes LangChain use its
# streaming JSON parser, which yields progressively-completed partial dicts as
# tokens arrive — this is what lets the Code tab render each file's source line
# by line. The Pydantic class path only ever yields the FINAL object (its parser
# needs complete, valid JSON), so with it nothing streams until the very end.
_BUNDLE_STREAM_SCHEMA = {
    "title": "ProjectBundle",
    "description": "The complete set of source files that make up the app.",
    "type": "object",
    "properties": {
        "files": {
            "type": "array",
            "description": "Every file in the project, in the order they're written.",
            "items": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Relative path, forward slashes, no leading '/'.",
                    },
                    "content": {
                        "type": "string",
                        "description": "The full, complete contents of the file.",
                    },
                },
                "required": ["path", "content"],
            },
        }
    },
    "required": ["files"],
}


def _run_structured(
    messages: list[tuple[str, str]],
    model: str | None,
    on_file: OnFile | None,
    should_cancel: ShouldCancel | None = None,
) -> ProjectBundle:
    """Runs the codegen LLM call, reporting each real file to `on_file` as
    it streams in. Falls back to a single non-streaming call — identical to
    this project's original behavior — if streaming itself misbehaves, so
    the live progress signal can never make codegen less reliable than it
    was before it existed.

    `should_cancel`, when given, is checked once before the call starts and
    throttled inside the streaming loop — raises BuildCanceled the moment a
    real user-initiated stop is noticed. The non-streaming fallback below
    can only be checked before it starts (a single blocking HTTP call can't
    be interrupted mid-flight without streaming).
    """
    if should_cancel is not None and should_cancel():
        raise BuildCanceled()
    if on_file is not None:
        try:
            # Dict schema + function_calling → LangChain's streaming JSON tool
            # parser, which yields growing partial dicts as tokens arrive. This
            # is what makes the source appear line by line. (Strict json_schema
            # mode would reject this lenient schema and silently fall back to a
            # non-streaming call, so pin the method explicitly.)
            structured = llm(max_tokens=64000, model=model).with_structured_output(
                _BUNDLE_STREAM_SCHEMA, method="function_calling"
            )
            # The in-progress file is always the LAST entry of the growing
            # `files` list; its `content` fills in token by token. Everything
            # before it is complete. We re-emit the current file's content on
            # each chunk (so the UI renders it appearing line by line) and
            # finalize earlier files with "done" the moment a new one starts.
            emitted_index = -1  # highest file index we've reported on
            final: object = None
            last_cancel_check = time.monotonic()
            for chunk in structured.stream(messages):
                if should_cancel is not None:
                    now = time.monotonic()
                    if now - last_cancel_check >= _CANCEL_POLL_INTERVAL_S:
                        last_cancel_check = now
                        if should_cancel():
                            raise BuildCanceled()
                final = chunk
                files = _files_from_chunk(chunk)
                if not files:
                    continue
                last = len(files) - 1
                try:
                    # A new file (or files) started — finalize the ones before it.
                    if last > emitted_index:
                        for i in range(max(emitted_index, 0), last):
                            done_path = _entry_field(files[i], "path")
                            if done_path:
                                on_file(done_path, "done", _entry_field(files[i], "content") or "")
                        emitted_index = last
                    # Stream the current file's real, still-growing source.
                    # Gate on `content` also being non-empty, not just `path` —
                    # `path` is itself a streamed JSON string, so partial-JSON
                    # parsing exposes it mid-growth too ("p", "pa", "pac", ...
                    # "package.json") before `content` ever starts. Emitting on
                    # every one of those partial paths reported a NEW "file" to
                    # on_file() each time (the frontend keys progress entries by
                    # exact path), which is what caused the growing list of
                    # "Creating p" / "Creating pa" / ... duplicate lines in the
                    # UI. By the time the model has started emitting `content`,
                    # `path`'s string value is guaranteed fully closed — the
                    # model can't interleave key values, it finishes one JSON
                    # string before starting the next key.
                    cur_path = _entry_field(files[last], "path")
                    cur_content = _entry_field(files[last], "content") or ""
                    if cur_path and cur_content:
                        on_file(cur_path, "coding", cur_content)
                except Exception:
                    pass  # progress reporting must never affect codegen
            if final is not None:
                bundle = final if isinstance(final, ProjectBundle) else ProjectBundle.model_validate(final)
                # Finalize the last file with its complete, validated content.
                try:
                    if bundle.files:
                        tail = bundle.files[-1]
                        on_file(tail.path, "done", tail.content)
                except Exception:
                    pass
                return bundle
        except Exception:
            pass  # fall through to the plain, non-streaming call below

    bundle = llm(max_tokens=64000, model=model).with_structured_output(ProjectBundle).invoke(messages)
    if not isinstance(bundle, ProjectBundle):
        raise CodegenError("Codegen returned no parseable project bundle.")
    return bundle


def generate_project(
    plan: AppPlan,
    prompt: str,
    model: str | None = None,
    on_file: OnFile | None = None,
    should_cancel: ShouldCancel | None = None,
    previous_files: list[GeneratedFile] | None = None,
) -> ProjectBundle:
    """Generate the complete web-app project for one build.

    `previous_files`, when given (the caller's own most recent SUCCEEDED
    build for this project — see codegen_worker.py), grounds this call in
    the app's REAL existing code instead of a blind from-scratch generation.
    This is what makes an ordinary chat follow-up ("add team creation") a
    real, scoped edit instead of regenerating the whole app.

    Two tiers, cheapest first:

    1. A genuinely TARGETED edit (_run_targeted_iteration): only app/page.tsx
       and schema.sql are sent to the model as editable, and it returns
       COMPLETE content for ONLY the file(s) this specific feature actually
       needs — never a diff, but never a whole-project rewrite either. Every
       other file (layout.tsx, the badge, the error reporter, every
       components/ui/*.tsx primitive not touched) is carried forward
       byte-for-byte, untouched by the model. This is what actually
       prevents "add one feature" from reading as "rewrite everything," not
       just an instruction to preserve things inside a full regenerate.
    2. Falls back to a full-manifest regenerate (the original behavior,
       CODEGEN_ITERATE_USER_TEMPLATE) when the targeted attempt reports the
       change genuinely needs a file outside that scope, or its result
       doesn't validate — this full-manifest pass is STILL told to preserve
       everything unrelated, so even the fallback isn't a blind rewrite.

    `previous_files=None` (a project's first build) skips both tiers and is
    byte-for-byte the original from-scratch behavior.

    If the (possibly-fallback) first pass violates a rule that can be
    confidently scoped to 1-3 files (a forbidden import, a forbidden
    schema.sql marker, etc.), this tries ONE real, same-build
    self-correction — reusing the exact targeted-fix machinery
    fix_project() uses for a post-build error — before ever surfacing a
    failure. That's what actually prevents "the model made one scoped,
    nameable mistake" from costing the user a whole failed build and a
    manual retry: the rejection message IS the fix prompt (which is why
    those messages spell out the real alternative, not just the ban), so a
    mistake the validator can name is usually a mistake it can also correct
    on the spot. Falls straight through to a real failure — completely
    unchanged from before — when the mistake can't be confidently scoped,
    or the correction attempt doesn't actually resolve it either; nothing
    here ever hides a real problem.
    """
    if previous_files:
        targeted = _run_targeted_iteration(
            prompt, plan, previous_files, model, should_cancel
        )
        if targeted is not None:
            merged = ProjectBundle(files=_merge_fix(previous_files, list(targeted.files)))
            try:
                # Same discipline as fix_project's targeted branch: a
                # scoped edit CAN break a cross-file contract the
                # single-file view couldn't see. Validate the full merged
                # bundle, and fall through to the full-manifest path below
                # (not a hard failure) if it doesn't hold up.
                _validate_bundle(merged)
            except CodegenError:
                pass
            else:
                if on_file is not None:
                    for f in targeted.files:
                        try:
                            on_file(f.path, "done", f.content)
                        except Exception:
                            pass
                return merged

        previous_files_text = "\n\n".join(
            f"--- {f.path} ---\n{f.content}" for f in previous_files
        )
        user_prompt = prompts.CODEGEN_ITERATE_USER_TEMPLATE.format(
            plan_json=plan.model_dump_json(indent=2),
            prompt=prompt,
            previous_files=previous_files_text,
        )
    else:
        user_prompt = prompts.CODEGEN_USER_TEMPLATE.format(
            plan_json=plan.model_dump_json(indent=2),
            prompt=prompt,
        )

    bundle = _run_structured(
        [
            ("system", prompts.APP_SYSTEM),
            ("user", user_prompt),
        ],
        model,
        on_file,
        should_cancel,
    )

    try:
        _validate_bundle(bundle)
    except CodegenError as exc:
        known_paths = {f.path for f in bundle.files}
        target_paths = _extract_error_file_paths(str(exc), known_paths)
        if not target_paths or len(target_paths) > 3:
            raise
        targeted = _run_targeted_fix(
            prompt, bundle.files, target_paths, str(exc), model, should_cancel
        )
        if targeted is None:
            raise
        healed = ProjectBundle(files=_merge_fix(bundle.files, list(targeted.files)))
        _validate_bundle(healed)  # still a real check — never assume it worked
        bundle = healed

    return bundle


def _extract_error_file_paths(error: str, known_paths: set[str]) -> list[str]:
    """Which of the project's REAL files this error concretely implicates —
    checked against ground truth (the actual paths that exist in this
    project), not fragile regex parsing of every possible compiler error
    shape. A schema-apply failure is tagged by web_worker.py with
    SCHEMA_ERROR_MARKER and routes straight to schema.sql, since a Postgres
    error never mentions a file path the way `next build`'s own
    `./app/page.tsx:12:3`-style source pointers do. Returns [] when nothing
    can be confidently scoped — the caller falls back to a full regenerate."""
    if error.startswith(SCHEMA_ERROR_MARKER):
        return ["schema.sql"] if "schema.sql" in known_paths else []
    found = [path for path in known_paths if path in error or f"./{path}" in error]
    if found:
        return found
    # A captured PRODUCTION runtime error (see main.py's _runtime_fix_prompt)
    # is a browser stack trace pointing into the compiled bundle
    # (/_next/static/chunks/....js:1:2345) — it never contains a real source
    # path, so the substring match above always comes back empty for that
    # path, and fix_project() would otherwise ALWAYS fall through to a full
    # regenerate for every runtime fix, rewriting the whole app for what's
    # usually a small bug. Every generated app is a single-page app (see
    # AGENTS.md) — virtually all real logic lives in app/page.tsx — so
    # default the scope there instead of giving up: _run_targeted_fix still
    # reports insufficient=True (identical fallback to today) on the rare
    # error that genuinely needs a different file.
    if "app/page.tsx" in known_paths:
        return ["app/page.tsx"]
    return []


def diff_files(
    previous_files: list[GeneratedFile], new_files: list[GeneratedFile]
) -> tuple[list[str], dict[str, str]]:
    """Real, computed diffs — never a description of what changed. Compares
    every file in `new_files` against its previous content; files that come
    out byte-identical are excluded, so this works whether the caller did a
    targeted fix (most files trivially match, since they were carried
    forward unchanged) or a full regenerate (most files STILL usually match,
    since codegen is instructed to keep whatever already works). Public
    (no leading underscore) — reused by codegen_worker.py for normal chat
    iterations grounded in previous files, not just fix_project's error-fix
    path."""
    previous_by_path = {f.path: f.content for f in previous_files}
    changed_paths: list[str] = []
    diffs: dict[str, str] = {}
    for f in new_files:
        old = previous_by_path.get(f.path)
        if old == f.content:
            continue
        changed_paths.append(f.path)
        diffs[f.path] = "\n".join(
            difflib.unified_diff(
                (old or "").splitlines(),
                f.content.splitlines(),
                fromfile=f.path,
                tofile=f.path,
                lineterm="",
                n=2,
            )
        )
    return changed_paths, diffs


def _merge_fix(
    previous_files: list[GeneratedFile], fixed_files: list[GeneratedFile]
) -> list[GeneratedFile]:
    """The full project with `fixed_files` swapped in by path — every other
    file carried forward byte-for-byte from `previous_files`, never touched
    or re-emitted by the model."""
    fixed_by_path = {f.path: f for f in fixed_files}
    merged = [fixed_by_path.pop(f.path, f) for f in previous_files]
    merged.extend(fixed_by_path.values())  # a genuinely new file the fix added
    return merged


def _invoke_targeted(
    user_prompt: str, model: str | None, should_cancel: ShouldCancel | None
) -> TargetedFix | None:
    """Shared plumbing for a single scoped structured-output edit — one real
    LLM call that returns COMPLETE content for only the file(s) it actually
    needs to touch, never a diff. Used by both fix_project's error-fix path
    and generate_project's feature-iteration path (_run_targeted_fix /
    _run_targeted_iteration build the actual prompt text, then both funnel
    through here). Returns None (never raises, except a real user cancel) on
    any failure — including the model reporting it can't scope this — so the
    caller can fall back to a full regenerate without this being a hard
    error."""
    if should_cancel is not None and should_cancel():
        raise BuildCanceled()
    try:
        result = llm(max_tokens=16000, model=model).with_structured_output(
            TargetedFix
        ).invoke([("system", prompts.APP_SYSTEM), ("user", user_prompt)])
    except BuildCanceled:
        raise
    except Exception:
        return None
    if not isinstance(result, TargetedFix) or result.insufficient or not result.files:
        return None
    return result


def _run_targeted_fix(
    prompt: str,
    previous_files: list[GeneratedFile],
    target_paths: list[str],
    error: str,
    model: str | None,
    should_cancel: ShouldCancel | None,
    is_feature_request: bool = False,
) -> TargetedFix | None:
    """One scoped fix attempt covering ONLY target_paths.

    `is_feature_request` selects the correctly-framed template — see
    prompts.CODEGEN_FEATURE_FIX_USER_TEMPLATE's docstring for why this
    matters: `error` is a genuine build error in the normal case, but the
    conversion-optimization agent (app/conversion_agent.py) reuses this same
    fix machinery to carry a real FEATURE request (an A/B experiment to
    implement), and telling the model that's "a genuine build failure"
    would be actively misleading."""
    by_path = {f.path: f for f in previous_files}
    targets = [by_path[p] for p in target_paths if p in by_path]
    if not targets:
        return None
    other_paths = sorted(p for p in by_path if p not in target_paths)
    target_text = "\n\n".join(f"--- {f.path} ---\n{f.content}" for f in targets)
    template = (
        prompts.CODEGEN_TARGETED_FEATURE_FIX_USER_TEMPLATE
        if is_feature_request
        else prompts.CODEGEN_TARGETED_FIX_USER_TEMPLATE
    )
    user_prompt = template.format(
        prompt=prompt,
        error=error[-4000:],
        other_paths="\n".join(other_paths) or "(no other files)",
        target_files=target_text,
    )
    return _invoke_targeted(user_prompt, model, should_cancel)


def _run_targeted_iteration(
    prompt: str,
    plan: AppPlan,
    previous_files: list[GeneratedFile],
    model: str | None,
    should_cancel: ShouldCancel | None,
) -> TargetedFix | None:
    """One scoped feature-iteration attempt — the SAME targeted-edit
    machinery as _run_targeted_fix, but for "add this feature" instead of
    "fix this error." Unlike an error, there's no error text to scope from,
    so the candidate scope is architecture-derived instead: every generated
    app is a single-page app (see AGENTS.md) — virtually every real feature
    request lives in app/page.tsx, plus schema.sql when the data model
    changes — so those are the two files offered as directly editable.
    `other_paths` still lists every other file (so the model can add a
    genuinely new one, e.g. a components/ui/*.tsx primitive it hasn't used
    yet) and can still set insufficient=true to fall back to a full
    regenerate if the real change needs a file outside this scope."""
    by_path = {f.path: f for f in previous_files}
    target_paths = [p for p in ("app/page.tsx", "schema.sql") if p in by_path]
    if not target_paths:
        return None
    targets = [by_path[p] for p in target_paths]
    other_paths = sorted(p for p in by_path if p not in target_paths)
    target_text = "\n\n".join(f"--- {f.path} ---\n{f.content}" for f in targets)
    user_prompt = prompts.CODEGEN_TARGETED_ITERATE_USER_TEMPLATE.format(
        plan_json=plan.model_dump_json(indent=2),
        prompt=prompt,
        other_paths="\n".join(other_paths) or "(no other files)",
        target_files=target_text,
    )
    return _invoke_targeted(user_prompt, model, should_cancel)


def fix_project(
    prompt: str,
    previous_files: list[GeneratedFile],
    error: str,
    model: str | None = None,
    on_file: OnFile | None = None,
    should_cancel: ShouldCancel | None = None,
    is_feature_request: bool = False,
) -> FixResult:
    """Fixes a project that failed a REAL `next build` (or a real schema.sql
    apply), given the exact error and the previously generated files.

    Tries a TARGETED fix first: when the error confidently scopes to a small
    set of files (a compiler error naming specific paths, or a tagged schema
    error), only THOSE files are sent to and regenerated by the model —
    genuinely cheaper and faster than a full regenerate, and every other
    file is carried forward byte-for-byte, never rewritten. Falls back to a
    full regenerate (the original, proven behavior) when the error can't be
    confidently scoped, touches more than a few files, or the model itself
    reports the real fix needs a file outside the given scope — this never
    forces a fragile partial fix past that point.

    `is_feature_request`: set by codegen_worker.py when `error` is actually
    the conversion-optimization agent's feature prompt (an A/B experiment to
    launch/graduate/revert — see app/conversion_agent.py) rather than a
    genuine build failure, so the model gets framing that matches reality
    instead of being told a working app "FAILED on real infrastructure."
    """
    known_paths = {f.path for f in previous_files}
    target_paths = _extract_error_file_paths(error, known_paths)

    if target_paths and len(target_paths) <= 3:
        targeted = _run_targeted_fix(
            prompt,
            previous_files,
            target_paths,
            error,
            model,
            should_cancel,
            is_feature_request,
        )
        if targeted is not None:
            fixed_files = list(targeted.files)
            merged = _merge_fix(previous_files, fixed_files)
            bundle = ProjectBundle(files=merged)
            try:
                # A targeted edit CAN break a cross-file contract the
                # single-file view couldn't see (e.g. it accidentally drops
                # the badge/reporter render). Validating the full merged
                # bundle catches that — and if it fails, fall through to the
                # full-regenerate path below instead of hard-failing the
                # whole fix attempt: reliability here matters more than
                # honoring the cheaper path.
                _validate_bundle(bundle)
            except CodegenError:
                pass
            else:
                changed_paths, diffs = diff_files(previous_files, fixed_files)
                if on_file is not None:
                    for f in fixed_files:
                        try:
                            on_file(f.path, "done", f.content)
                        except Exception:
                            pass
                return FixResult(
                    bundle=bundle,
                    explanation=targeted.explanation,
                    changed_paths=changed_paths,
                    diffs=diffs,
                    targeted=True,
                )

    # Fallback: full regenerate — the original, proven behavior. Almost
    # always the path actually taken for a feature request (the "error"
    # text — really the feature prompt — virtually never contains a literal
    # known file path for _extract_error_file_paths to scope from above).
    previous_files_text = "\n\n".join(
        f"--- {f.path} ---\n{f.content}" for f in previous_files
    )
    fallback_template = (
        prompts.CODEGEN_FEATURE_FIX_USER_TEMPLATE
        if is_feature_request
        else prompts.CODEGEN_FIX_USER_TEMPLATE
    )
    bundle = _run_structured(
        [
            ("system", prompts.APP_SYSTEM),
            (
                "user",
                fallback_template.format(
                    prompt=prompt,
                    error=error[-4000:],
                    previous_files=previous_files_text,
                ),
            ),
        ],
        model,
        on_file,
        should_cancel,
    )
    try:
        _validate_bundle(bundle)
    except CodegenError as exc:
        # Same one-shot same-build self-correction as generate_project()'s
        # first pass — this IS the last resort already, so if the mistake
        # can't be scoped or the correction doesn't resolve it, this
        # re-raises for real, same as before.
        known_paths = {f.path for f in bundle.files}
        rescope = _extract_error_file_paths(str(exc), known_paths)
        if not rescope or len(rescope) > 3:
            raise
        healed = _run_targeted_fix(
            prompt, bundle.files, rescope, str(exc), model, should_cancel
        )
        if healed is None:
            raise
        merged_bundle = ProjectBundle(files=_merge_fix(bundle.files, list(healed.files)))
        _validate_bundle(merged_bundle)
        bundle = merged_bundle

    changed_paths, diffs = diff_files(previous_files, bundle.files)
    explanation = (
        f"Rewrote the whole project to resolve: {error.strip().splitlines()[0][:200]}"
        if changed_paths
        else "Regenerated the project — every file came out the same as before."
    )
    return FixResult(
        bundle=bundle,
        explanation=explanation,
        changed_paths=changed_paths,
        diffs=diffs,
        targeted=False,
    )

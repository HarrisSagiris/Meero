"""Meero orchestrator API.

  POST /builds                 — queue a real web-app build for a project (auth required)
  POST /builds/{id}/deploy     — Ultra-only: real Vercel production release
  GET  /preview/{build_id}/... — serves a live app bundle with real headers
  POST /chat/stream            — conversational build agent (SSE token stream)
  WS   /ws/projects/{id}       — live build status events
  POST /billing/checkout       — create a real Stripe Checkout session
  POST /billing/portal         — create a real Stripe billing portal session
  POST /billing/webhook        — Stripe webhook (subscription lifecycle)
  GET  /health                 — redis connectivity check

Run:  uvicorn app.main:app --reload --port 8000
"""

import asyncio
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any, Literal

import httpx
import redis.asyncio as aioredis
import stripe
from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from app.services.conversion import conversion_agent
from app.infrastructure.database import db
from app.services.monitoring import runtime_monitor
from app.agents.codegen import generate_display_title, model_for_plan
from app.agents.graph import chat_graph
from app.agents.superagent_brain import generate_patch, select_relevant_files
from app.config import (
    CHAT_MIN_CHARGE,
    CLONE_COST,
    CONVERSION_EXPERIMENT_COST,
    CREDITS_TOPUP_TOKENS,
    DEPLOY_COST,
    WEB_BUILD_COST,
    Settings,
    get_settings,
)
from app.models.content_types import content_type_for
from app.services.github.github_publish import (
    GithubPublishError,
    build_authorize_url,
    ensure_project_repo,
    exchange_code_for_token,
    fetch_github_user,
    resolve_state,
)
from app.services.superagent.superagent import (
    MENTION,
    build_superagent_authorize_url,
    create_webhook,
    delete_webhook,
    get_default_branch,
    get_file_content,
    get_repo_tree,
    list_user_repos,
    make_branch_name,
    open_pull_request_with_patch,
    resolve_superagent_state,
    verify_webhook_signature,
)
from app.services.slack.slack import SlackError
from app.services.slack.slack import build_authorize_url as build_slack_authorize_url
from app.services.slack.slack import exchange_code as exchange_slack_code
from app.services.slack.slack import list_channels as list_slack_channels
from app.services.slack.slack import resolve_state as resolve_slack_state
from app.services.slack.slack import strip_bot_mention
from app.services.slack.slack import verify_signature as verify_slack_signature
from app.infrastructure.queues.queues import (
    CODEGEN_QUEUE,
    DEPLOY_QUEUE,
    EVENTS_CHANNEL,
    SUPERAGENT_QUEUE,
    WEB_BUILD_QUEUE,
    enqueue,
    get_redis,
    set_build_canceled,
)
from app.services.email.send import EmailSendError, send_email
from app.services.email.otp import OtpError, send_otp, verify_otp
from app.middleware.rate_limit import check_for_key, rate_limit
from app.infrastructure.supabase.supabase_connect import (
    _ACTIVE_STATUSES as SUPABASE_ACTIVE_STATUSES,
    _FAILED_STATUSES as SUPABASE_FAILED_STATUSES,
    SupabaseConnectError,
    build_authorize_url as supabase_authorize_url,
    count_recent_sent_emails,
    create_project as create_supabase_project,
    disable_email_confirm,
    exchange_code_for_tokens,
    fetch_behavior_events,
    fetch_behavior_stats,
    fetch_conversion_kpis,
    fetch_device_conversion,
    fetch_exit_pages,
    fetch_experiment_counts,
    fetch_experiment_counts_by_device,
    fetch_page_breakdown,
    fetch_pending_emails,
    fetch_runtime_errors,
    fetch_session_count,
    fresh_access_token,
    get_project_anon_key,
    get_project_status as get_supabase_project_status,
    list_organizations as list_supabase_organizations,
    list_projects,
    mark_email_status,
    mark_runtime_errors_resolved,
    project_url,
    resolve_state as resolve_supabase_state,
)
from app.services.screenshots.screenshot import stored_page_screenshot_url
from app.workers.deploy_worker import (
    DeployError,
    add_domain,
    get_domain_config,
    get_domain_status,
    remove_domain,
    vercel_project_name,
    verify_domain,
)

log = logging.getLogger("meero.api")

app = FastAPI(title="Meero Orchestrator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _start_reaper() -> None:
    """Background stuck-build reaper — the crash-safety net for the queue.
    Runs in-process on the API (idempotent, so multiple replicas are fine)."""

    async def loop() -> None:
        s = get_settings()
        while True:
            await asyncio.sleep(s.reaper_interval_s)
            try:
                n = await asyncio.to_thread(
                    db.reap_stuck_builds,
                    s.build_running_timeout_s,
                    s.build_queued_timeout_s,
                )
                if n:
                    log.info("reaper: failed %d stuck build(s)", n)
            except Exception:  # never let the reaper kill the app
                log.exception("reaper pass failed")

    asyncio.create_task(loop())


def _poll_pending_emails() -> None:
    """One real pass: every Supabase-linked project, every genuinely
    pending `_meero_emails` row, sent through Resend, status written back
    to the row it came from. Runs on a thread (see _start_email_poller) —
    every DB/HTTP call here is synchronous by design, matching the rest of
    app/supabase_connect.py and app/email_send.py."""
    settings = get_settings()
    for project in db.list_supabase_linked_projects():
        project_id = project["id"]
        ref = project["supabase_project_ref"]
        try:
            access_token = fresh_access_token(project["owner_id"])
        except Exception as exc:
            log.warning(
                "email poller: could not refresh token for project %s: %s",
                project_id,
                exc,
            )
            continue

        pending = fetch_pending_emails(access_token, ref)
        if not pending:
            continue

        # Real backstop against a compromised/malicious signed-up user of
        # the GENERATED app burning the owner's Resend quota — counted from
        # actual `status = 'sent'` rows, not separately tracked state.
        sent_recent = count_recent_sent_emails(access_token, ref)
        budget = max(0, settings.email_rate_limit_per_project_per_hour - sent_recent)
        if budget < len(pending):
            log.warning(
                "email poller: project %s hit its hourly send cap (%d pending, %d left)",
                project_id,
                len(pending),
                budget,
            )

        for row in pending[:budget]:
            try:
                send_email(row["to_email"], row["subject"], row["body"])
                mark_email_status(access_token, ref, row["id"], "sent")
            except EmailSendError as exc:
                log.warning(
                    "email poller: send failed for project %s email %s: %s",
                    project_id,
                    row["id"],
                    exc,
                )
                mark_email_status(access_token, ref, row["id"], "failed")


@app.on_event("startup")
async def _start_email_poller() -> None:
    """Background transactional-email dispatcher (see app/email_send.py and
    the `_meero_emails` contract in app/agent/codegen.py) — runs in-process
    on the API, same idempotent-under-multiple-replicas pattern as the
    reaper above. A no-op pass whenever Resend isn't configured, never a
    fake "sent" status."""

    async def loop() -> None:
        s = get_settings()
        while True:
            await asyncio.sleep(s.email_poll_interval_s)
            if not s.resend_configured:
                continue
            try:
                await asyncio.to_thread(_poll_pending_emails)
            except Exception:  # never let the poller kill the app
                log.exception("email poller pass failed")

    asyncio.create_task(loop())


@app.on_event("startup")
async def _start_runtime_monitor() -> None:
    """The 24/7 autonomous monitoring agent (see app/runtime_monitor.py) —
    runs in-process on the API, same idempotent-under-multiple-replicas
    pattern as the reaper/email poller above. A plain kill-switch (not a
    *_configured check — this feature needs no new external credential),
    since it's real enough to want an explicit off switch before its first
    production rollout."""

    async def loop() -> None:
        s = get_settings()
        while True:
            await asyncio.sleep(s.runtime_monitor_poll_interval_s)
            if not s.runtime_monitor_enabled:
                continue
            try:
                await asyncio.to_thread(runtime_monitor.poll_runtime_errors)
            except Exception:  # never let the monitor kill the app
                log.exception("runtime monitor pass failed")

    asyncio.create_task(loop())


@app.on_event("startup")
async def _start_conversion_agent() -> None:
    """The autonomous conversion-optimization agent (see
    app/conversion_agent.py) — runs in-process on the API, same
    idempotent-under-multiple-replicas pattern as the reaper/email
    poller/runtime monitor above. Settings.conversion_agent_enabled is a
    global, deploy-time kill switch (deploy false until manually verified
    end-to-end) — a SEPARATE, per-project gate
    (projects.conversion_agent_enabled, off by default) is checked inside
    the poll itself, since unlike runtime_monitor this feature is fully
    opt-in per project."""

    async def loop() -> None:
        s = get_settings()
        while True:
            await asyncio.sleep(s.conversion_agent_poll_interval_s)
            if not s.conversion_agent_enabled:
                continue
            try:
                await asyncio.to_thread(conversion_agent.poll_conversion_agent)
            except Exception:  # never let the agent kill the app
                log.exception("conversion agent pass failed")

    asyncio.create_task(loop())


def _poll_supabase_provisioning() -> None:
    """One real pass over every project whose auto-provisioned Supabase
    project (00045) is still coming up: checks its REAL status via the
    Management API and, once active, reads back its anon key and finalizes
    the link exactly like the manual /supabase/link endpoint does. A
    project stuck past supabase_provision_timeout_s, or one the Management
    API reports as terminally failed, is marked failed with an honest
    error — never left spinning forever."""
    settings = get_settings()
    for project in db.list_provisioning_projects():
        project_id = project["id"]
        ref = project.get("supabase_provisioning_ref")
        if not ref:
            continue
        try:
            access_token = fresh_access_token(project["owner_id"])
            status = get_supabase_project_status(access_token, ref)
        except SupabaseConnectError as exc:
            log.warning(
                "supabase provisioning poll: could not check project %s (%s): %s",
                project_id,
                ref,
                exc,
            )
            continue

        if status in SUPABASE_ACTIVE_STATUSES:
            try:
                anon_key = get_project_anon_key(access_token, ref)
            except SupabaseConnectError as exc:
                log.warning(
                    "supabase provisioning: project %s active but anon key read failed: %s",
                    project_id,
                    exc,
                )
                continue
            db.set_project_supabase_link(project_id, ref, project_url(ref), anon_key)
            disable_email_confirm(access_token, ref)
            log.info("supabase provisioning: project %s linked to %s", project_id, ref)
            continue

        if status in SUPABASE_FAILED_STATUSES:
            db.fail_project_provisioning(
                project_id, f"Supabase project creation failed (status: {status})."
            )
            continue

        started_raw = project.get("supabase_provisioning_started_at")
        if started_raw:
            started = datetime.fromisoformat(str(started_raw).replace("Z", "+00:00"))
            elapsed = (datetime.now(timezone.utc) - started).total_seconds()
            if elapsed > settings.supabase_provision_timeout_s:
                db.fail_project_provisioning(
                    project_id,
                    "Timed out waiting for the new Supabase project to come online.",
                )


@app.on_event("startup")
async def _start_supabase_provision_poller() -> None:
    """Background finalizer for auto-provisioned Supabase projects (00045)
    — runs in-process on the API, same idempotent-under-multiple-replicas
    pattern as the reaper/email poller above."""

    async def loop() -> None:
        s = get_settings()
        while True:
            await asyncio.sleep(s.supabase_provision_poll_interval_s)
            try:
                await asyncio.to_thread(_poll_supabase_provisioning)
            except Exception:  # never let the poller kill the app
                log.exception("supabase provisioning poll failed")

    asyncio.create_task(loop())


# --------------------------------------------------------------------------
# Auth — validate the caller's real Supabase access token
# --------------------------------------------------------------------------


async def current_user_id(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.split(" ", 1)[1]
    user_id = await asyncio.to_thread(db.get_user_id_from_token, token)
    if user_id is None:
        raise HTTPException(401, "Invalid or expired token")
    return user_id


# --------------------------------------------------------------------------
# Email OTP — real signup verification (app/email_otp.py), replacing
# reliance on Supabase's own "Confirm signup" email template. Requires a
# real session to already exist (i.e. Supabase's "Confirm email" toggle is
# OFF) — see (auth)/actions.ts's signup(), which calls /auth/otp/send right
# after a real signUp() succeeds.
# --------------------------------------------------------------------------


@app.post(
    "/auth/otp/send",
    dependencies=[Depends(rate_limit("otp-send", 5, 300))],
)
async def send_otp_endpoint(
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, bool]:
    profile = await asyncio.to_thread(db.get_profile, user_id)
    if profile is None:
        raise HTTPException(404, "Profile not found")
    if profile.get("email_verified"):
        return {"ok": True}
    if not get_settings().resend_configured:
        raise HTTPException(
            503, "Email sending isn't configured yet (RESEND_API_KEY)."
        )
    try:
        await asyncio.to_thread(send_otp, user_id, profile["email"])
    except (OtpError, EmailSendError) as exc:
        raise HTTPException(502, str(exc))
    return {"ok": True}


class VerifyOtpRequest(BaseModel):
    code: str


@app.post(
    "/auth/otp/verify",
    dependencies=[Depends(rate_limit("otp-verify", 10, 300))],
)
async def verify_otp_endpoint(
    body: VerifyOtpRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, bool]:
    ok = await asyncio.to_thread(verify_otp, user_id, body.code.strip())
    if not ok:
        raise HTTPException(400, "That code is invalid or expired.")
    return {"ok": True}


# --------------------------------------------------------------------------
# Credits — a weekly TOKEN budget (refreshes Sunday 00:00 UTC). Chat turns
# deduct the real OpenAI tokens they consume; builds deduct a flat amount
# (codegen + a real `next build`); the Pro/Ultra Vercel release deducts a
# separate, larger flat amount (real deploy compute + bandwidth).
# Gate on a minimum balance BEFORE running, reconcile the true cost AFTER.
# WEB_BUILD_COST / DEPLOY_COST / CHAT_MIN_CHARGE / CREDITS_TOPUP_TOKENS
# live in app.config.
# --------------------------------------------------------------------------


def _credit_denied_message(credit: dict) -> str:
    plan = credit.get("plan", "free")
    reset_text = ""
    reset_at = credit.get("reset_at")
    if reset_at:
        try:
            dt = datetime.fromisoformat(str(reset_at).replace("Z", "+00:00"))
            reset_text = f" Resets at {dt.strftime('%H:%M UTC')}."
        except ValueError:
            pass
    upsell = (
        " Upgrade to Pro (400k/week) or Ultra (2M/week), or buy a one-time top-up for more."
        if plan == "free"
        else " Buy a one-time token top-up for more today."
    )
    return f"You're out of tokens on the {plan} plan.{reset_text}{upsell}"


# --------------------------------------------------------------------------
# Builds
# --------------------------------------------------------------------------


class BuildRequest(BaseModel):
    project_id: str


class BuildResponse(BaseModel):
    build: dict | None = None
    credits_denied: bool = False


@app.post(
    "/builds",
    response_model=BuildResponse,
    dependencies=[Depends(rate_limit("builds", 20, 60))],
)
async def create_builds(
    body: BuildRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> BuildResponse:
    # A collaborator can trigger real builds just like the owner (00027_
    # collaborators.sql) — but every build is billed to the project OWNER's
    # credits, never the collaborator's own account (team-seat semantics,
    # not "borrow your friend's Pro plan for free").
    project = await asyncio.to_thread(db.get_project, body.project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, body.project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")
    owner_id = project["owner_id"]

    spec = await asyncio.to_thread(db.get_latest_spec, body.project_id)
    if spec is None:
        raise HTTPException(422, "Project has no spec to build")

    # A full-stack build needs somewhere real for its data to live.
    if not project.get("supabase_project_ref"):
        raise HTTPException(
            422,
            "Link a Supabase project to this app first — use the Supabase "
            "button in the builder header.",
        )

    # Every plan builds the same thing: one real, secure, full-stack web
    # app. See AGENTS.md — gate on a minimum balance, then charge the flat
    # per-build cost. See 00010_token_billing.sql.
    credit = await asyncio.to_thread(db.credits_available, owner_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    build = await asyncio.to_thread(db.create_build, body.project_id, spec["id"], "web")
    enqueue(CODEGEN_QUEUE, {"build_id": build["id"]})
    await asyncio.to_thread(db.charge_credits, owner_id, WEB_BUILD_COST)

    return BuildResponse(build=build)


# --------------------------------------------------------------------------
# Solo mode vs. Manual mode (00028_autonomy_mode.sql) — in Manual mode the
# chat agent parks a ready-to-build spec on projects.pending_build_spec_id
# instead of queueing a real build (see apply_node in app/agent/graph.py).
# These two endpoints are the real, explicit "yes"/"not now" — approving
# starts the exact same real build create_builds would, dismissing just
# clears the pointer.
# --------------------------------------------------------------------------


@app.post(
    "/projects/{project_id}/approve-build",
    response_model=BuildResponse,
    dependencies=[Depends(rate_limit("approve-build", 20, 60))],
)
async def approve_build(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> BuildResponse:
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")

    pending_spec_id = project.get("pending_build_spec_id")
    if not pending_spec_id:
        raise HTTPException(409, "There's no build waiting on your approval.")
    spec = await asyncio.to_thread(db.get_spec, pending_spec_id)
    if spec is None:
        raise HTTPException(422, "The pending spec no longer exists.")
    if not project.get("supabase_project_ref"):
        raise HTTPException(
            422,
            "Link a Supabase project to this app first — use the Supabase "
            "button in the builder header.",
        )

    owner_id = project["owner_id"]
    credit = await asyncio.to_thread(db.credits_available, owner_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    build = await asyncio.to_thread(db.create_build, project_id, spec["id"], "web")
    enqueue(CODEGEN_QUEUE, {"build_id": build["id"]})
    await asyncio.to_thread(db.charge_credits, owner_id, WEB_BUILD_COST)
    await asyncio.to_thread(db.set_pending_build, project_id, None)

    return BuildResponse(build=build)


@app.post(
    "/projects/{project_id}/dismiss-build",
    dependencies=[Depends(rate_limit("dismiss-build", 20, 60))],
)
async def dismiss_build(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, bool]:
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")
    await asyncio.to_thread(db.set_pending_build, project_id, None)
    return {"ok": True}


# --------------------------------------------------------------------------
# Auto-fix — one real AI-driven retry after a build genuinely fails to
# compile. Never a mock retry: it's a fresh codegen call fed the exact
# compiler error, followed by a fresh real compile. Capped to one hop.
# --------------------------------------------------------------------------


class AutoFixResponse(BaseModel):
    build: dict


@app.post(
    "/builds/{build_id}/auto-fix",
    response_model=AutoFixResponse,
    dependencies=[Depends(rate_limit("auto-fix", 10, 60))],
)
async def auto_fix_build(
    build_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> AutoFixResponse:
    build = await asyncio.to_thread(db.get_build, build_id)
    if build is None:
        raise HTTPException(404, "Build not found")
    can_access = await asyncio.to_thread(
        db.can_access_project, build["project_id"], user_id
    )
    if not can_access:
        raise HTTPException(404, "Build not found")
    project = await asyncio.to_thread(db.get_project, build["project_id"])
    owner_id = project["owner_id"] if project else user_id
    if build["status"] != "failed":
        raise HTTPException(409, "This build did not fail; nothing to fix")
    if build.get("retry_of"):
        raise HTTPException(
            409, "This build is already a fix attempt; won't chain another"
        )
    if not build.get("error"):
        raise HTTPException(422, "No error was recorded for this build")
    if await asyncio.to_thread(db.has_retry, build_id):
        raise HTTPException(409, "A fix attempt already exists for this build")

    credit = await asyncio.to_thread(db.credits_available, owner_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    fix_build = await asyncio.to_thread(db.create_fix_build, build)
    enqueue(CODEGEN_QUEUE, {"build_id": fix_build["id"], "fix_of": build_id})
    await asyncio.to_thread(db.charge_credits, owner_id, WEB_BUILD_COST)
    return AutoFixResponse(build=fix_build)


# --------------------------------------------------------------------------
# Retry — a plain re-run of a failed build: same spec, same platform, a
# fresh codegen call and a fresh real compile. Deliberately NOT linked via
# retry_of (that column is reserved for /auto-fix's one-hop AI-fix chain) —
# a manual retry is an independent build like any other, so it doesn't
# interact with the auto-fix cap or its "already has a fix" checks. This is
# the right tool when the failure wasn't really about the generated code —
# a transient install/network hiccup, or an infra bug that's since been
# fixed — where feeding the error back into codegen (/auto-fix) would be
# pointless or even counterproductive.
# --------------------------------------------------------------------------


class RetryBuildResponse(BaseModel):
    build: dict


@app.post(
    "/builds/{build_id}/retry",
    response_model=RetryBuildResponse,
    dependencies=[Depends(rate_limit("build-retry", 15, 60))],
)
async def retry_build(
    build_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> RetryBuildResponse:
    build = await asyncio.to_thread(db.get_build, build_id)
    if build is None:
        raise HTTPException(404, "Build not found")
    can_access = await asyncio.to_thread(
        db.can_access_project, build["project_id"], user_id
    )
    if not can_access:
        raise HTTPException(404, "Build not found")
    project = await asyncio.to_thread(db.get_project, build["project_id"])
    owner_id = project["owner_id"] if project else user_id
    if build["status"] != "failed":
        raise HTTPException(409, "This build did not fail; nothing to retry")

    credit = await asyncio.to_thread(db.credits_available, owner_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    new_build = await asyncio.to_thread(
        db.create_build, build["project_id"], build["spec_id"], build["platform"]
    )
    enqueue(CODEGEN_QUEUE, {"build_id": new_build["id"]})
    await asyncio.to_thread(db.charge_credits, owner_id, WEB_BUILD_COST)
    return RetryBuildResponse(build=new_build)


# --------------------------------------------------------------------------
# Restore — real version control for the generated code. Every succeeded
# build already stores its own complete source (build_files); this copies
# an EARLIER succeeded build's exact files onto a brand-new build and runs
# it through the same bundle-only pipeline the marketplace clone flow uses
# (schema re-applied, a real `next build`, a real commit to main) — just
# within the same project instead of into a new one. Nothing is ever
# deleted or mutated: rolling back is itself a new, real, forward build
# (linked via restored_from), so the version being restored TO stays
# exactly as it was and can always be restored to again.
# --------------------------------------------------------------------------


class RestoreBuildResponse(BaseModel):
    build: dict


async def _queue_bundle_rebuild(source_build: dict, owner_id: str) -> dict:
    """Shared engine behind both restore (an EARLIER version) and rebuild
    (the CURRENT version, no code/spec change at all): copies
    `source_build`'s exact stored files onto a brand-new build row and pushes
    it through the real bundle-only pipeline (use_build_files=True — no
    codegen call, schema re-applied, a real `next build`, a real commit to
    main). Raises the same HTTPExceptions either caller already surfaces."""
    files = await asyncio.to_thread(db.list_build_files, source_build["id"])
    if not files:
        raise HTTPException(422, "This version has no stored source to rebuild.")

    credit = await asyncio.to_thread(db.credits_available, owner_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    new_build = await asyncio.to_thread(db.create_restore_build, source_build)
    await asyncio.to_thread(
        db.replace_build_files, new_build["id"], source_build["project_id"], files
    )
    enqueue(
        WEB_BUILD_QUEUE,
        {
            "build_id": new_build["id"],
            "project_id": source_build["project_id"],
            "use_build_files": True,
        },
    )
    await asyncio.to_thread(db.charge_credits, owner_id, WEB_BUILD_COST)
    return new_build


@app.post(
    "/builds/{build_id}/restore",
    response_model=RestoreBuildResponse,
    dependencies=[Depends(rate_limit("build-restore", 15, 60))],
)
async def restore_build(
    build_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> RestoreBuildResponse:
    build = await asyncio.to_thread(db.get_build, build_id)
    if build is None:
        raise HTTPException(404, "Build not found")
    can_access = await asyncio.to_thread(
        db.can_access_project, build["project_id"], user_id
    )
    if not can_access:
        raise HTTPException(404, "Build not found")
    if build["status"] != "succeeded":
        raise HTTPException(409, "Only a succeeded version can be restored")

    project = await asyncio.to_thread(db.get_project, build["project_id"])
    owner_id = project["owner_id"] if project else user_id

    current = await asyncio.to_thread(
        db.get_latest_succeeded_build, build["project_id"]
    )
    if current and current["id"] == build_id:
        raise HTTPException(409, "This is already the current version")

    new_build = await _queue_bundle_rebuild(build, owner_id)
    return RestoreBuildResponse(build=new_build)


# --------------------------------------------------------------------------
# Rebuild — a plain re-run of the CURRENT version's exact stored code, no
# spec change and no codegen call at all (unlike asking Meero in chat to
# "rebuild without changing anything", which still runs a real planning +
# codegen pass and creates a new spec version, even when nothing about the
# app actually changes). Useful when the app itself is fine but something
# about the environment might have drifted — e.g. the linked Supabase
# project's schema was hand-edited, or a build genuinely wants a clean retry
# — since this reapplies schema.sql and reruns `next build` for real. Reuses
# the exact restore mechanism (_queue_bundle_rebuild), just sourced from the
# project's own latest succeeded build instead of an older one, and with no
# "already current" guard — rebuilding the current version is the entire
# point here.
# --------------------------------------------------------------------------


@app.post(
    "/projects/{project_id}/rebuild",
    response_model=RestoreBuildResponse,
    dependencies=[Depends(rate_limit("build-rebuild", 10, 60))],
)
async def rebuild_project(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> RestoreBuildResponse:
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")

    build = await asyncio.to_thread(db.get_latest_succeeded_build, project_id)
    if build is None:
        raise HTTPException(422, "This project has no successful build yet to rebuild.")

    new_build = await _queue_bundle_rebuild(build, project["owner_id"])
    return RestoreBuildResponse(build=new_build)


# --------------------------------------------------------------------------
# Cancel — a real, working "Stop" button. Raises the real Redis signal the
# workers poll (app.queues.is_build_canceled — checked between streamed LLM
# chunks and, via a real subprocess terminate/kill, mid-`next build`), marks
# the build "canceled" immediately for honest, instant UI feedback (sticky:
# db.set_build_status()'s guard means a worker that finishes moments later
# without having noticed can never resurrect it), and fully refunds the
# flat WEB_BUILD_COST charged at start — a stopped build produced nothing.
# --------------------------------------------------------------------------


class CancelBuildResponse(BaseModel):
    build_id: str
    refunded: int


@app.post(
    "/builds/{build_id}/cancel",
    response_model=CancelBuildResponse,
    dependencies=[Depends(rate_limit("build-cancel", 15, 60))],
)
async def cancel_build(
    build_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> CancelBuildResponse:
    build = await asyncio.to_thread(db.get_build, build_id)
    if build is None:
        raise HTTPException(404, "Build not found")
    can_access = await asyncio.to_thread(
        db.can_access_project, build["project_id"], user_id
    )
    if not can_access:
        raise HTTPException(404, "Build not found")
    project = await asyncio.to_thread(db.get_project, build["project_id"])
    owner_id = project["owner_id"] if project else user_id
    if build["status"] not in ("queued", "running"):
        raise HTTPException(409, "This build isn't in progress; nothing to stop")

    await asyncio.to_thread(set_build_canceled, build_id)
    await asyncio.to_thread(db.set_build_status, build_id, "canceled")
    # Refunded to the owner — every build, whoever triggered it, was billed
    # to the owner's credits above (see create_builds).
    await asyncio.to_thread(db.refund_credits, owner_id, WEB_BUILD_COST)
    return CancelBuildResponse(build_id=build_id, refunded=WEB_BUILD_COST)


# --------------------------------------------------------------------------
# Ultra-only production release — a separate, explicitly user-triggered
# action per build (never automatic, never part of the base pipeline, never
# gating the live preview). Ships the EXACT bundle the live preview serves
# through Vercel's real REST API on the deploy worker; charged its own flat
# DEPLOY_COST, separate from the base build cost.
# --------------------------------------------------------------------------


class DeployResponse(BaseModel):
    queued: bool = True


@app.post(
    "/builds/{build_id}/deploy",
    response_model=DeployResponse,
    dependencies=[Depends(rate_limit("deploy", 5, 60))],
)
async def deploy_build(
    build_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> DeployResponse:
    settings = get_settings()
    if not settings.vercel_configured:
        raise HTTPException(
            503,
            "Vercel isn't configured on this server (set VERCEL_TOKEN) — "
            "releases are unavailable until it is.",
        )

    build = await asyncio.to_thread(db.get_build, build_id)
    if build is None:
        raise HTTPException(404, "Build not found")
    owns = await asyncio.to_thread(db.is_project_owner, build["project_id"], user_id)
    if not owns:
        raise HTTPException(404, "Build not found")
    if build["status"] != "succeeded":
        raise HTTPException(409, "Only a succeeded build can be released.")

    profile = await asyncio.to_thread(db.get_profile, user_id)
    if not profile or profile.get("plan") not in ("pro", "ultra"):
        raise HTTPException(
            403, "Production releases are available on the Pro and Ultra plans."
        )

    credit = await asyncio.to_thread(db.credits_available, user_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    enqueue(DEPLOY_QUEUE, {"build_id": build_id, "project_id": build["project_id"]})
    await asyncio.to_thread(db.charge_credits, user_id, DEPLOY_COST)
    return DeployResponse()


# --------------------------------------------------------------------------
# Custom domains — Pro/Ultra, real Vercel Domains API (no faking a
# "connected" state: `verified` and the DNS records to add always come
# straight from Vercel's own response). Requires the project to have
# released to Vercel at least once (projects.live_url set) — that's what
# creates the Vercel project a domain attaches to.
# --------------------------------------------------------------------------

_DOMAIN_RE = re.compile(r"^(?!-)[a-zA-Z0-9-]{1,63}(?<!-)(\.[a-zA-Z0-9-]{1,63})+$")


async def _domain_context(project_id: str, user_id: str) -> tuple[dict, str]:
    """Shared gate for all three domain endpoints: ownership, plan, a real
    prior release, and Vercel being configured at all. Returns (project,
    vercel_project_name) — never partially."""
    settings = get_settings()
    if not settings.vercel_configured:
        raise HTTPException(
            503,
            "Vercel isn't configured on this server (set VERCEL_TOKEN) — "
            "custom domains are unavailable until it is.",
        )
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None or project.get("owner_id") != user_id:
        raise HTTPException(404, "Project not found")
    profile = await asyncio.to_thread(db.get_profile, user_id)
    if not profile or profile.get("plan") not in ("pro", "ultra"):
        raise HTTPException(
            403, "Custom domains are available on the Pro and Ultra plans."
        )
    if not project.get("live_url"):
        raise HTTPException(
            422, "Release this app to production at least once before adding a domain."
        )
    vp_name = vercel_project_name(project.get("name") or "Meero App", project_id)
    return project, vp_name


class DomainRequest(BaseModel):
    domain: str


class DnsRecord(BaseModel):
    """One real DNS record the owner has to create at their registrar. Values
    come from Vercel's own `recommendedIPv4`/`recommendedCNAME` for this
    domain, never a hardcoded literal."""

    type: str
    name: str
    value: str


class DomainResponse(BaseModel):
    domain: str | None
    # OWNERSHIP: has Vercel accepted that this account may use the name.
    verified: bool
    # REACHABILITY: does the domain's DNS actually point at Vercel yet.
    # These are independent — a domain can be verified but misconfigured
    # (never pointed) and therefore completely unreachable, which is why
    # `live` below is the only thing the UI should call "Live".
    misconfigured: bool = True
    live: bool = False
    # The exact records to create, and what DNS currently resolves to, so
    # the owner can see the real difference rather than guess.
    dns_records: list[DnsRecord] = []
    detected_a: list[str] = []
    detected_cname: list[str] = []
    nameservers: list[str] = []
    conflicts: list[dict] = []
    # Vercel's TXT ownership challenge(s), present only when the domain is
    # already claimed elsewhere and needs proving.
    verification: list[dict] = []
    # True only for the pre-add check: this domain is already attached to
    # THIS project, so "Add" would be a no-op.
    already_added: bool = False


# Registrable suffixes that are themselves two labels, so `example.co.uk` is
# an apex (needs an A record) rather than a subdomain (CNAME). Not a full
# public-suffix list — just the common ones — and only ever a fallback: once
# a domain is actually added, Vercel's own `apexName` is authoritative.
_MULTI_LABEL_SUFFIXES = {
    "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk",
    "com.au", "net.au", "org.au", "edu.au", "gov.au",
    "co.nz", "net.nz", "org.nz",
    "co.za", "org.za", "net.za",
    "co.jp", "or.jp", "ne.jp", "ac.jp",
    "com.br", "net.br", "org.br",
    "com.mx", "com.ar", "com.sg", "com.hk", "com.tr", "com.cn",
    "co.in", "net.in", "org.in",
}


def _is_apex(domain: str, apex_name: str | None) -> bool:
    """Apex (`example.com`) needs an A record; a subdomain
    (`app.example.com`) needs a CNAME. Prefers Vercel's own `apexName` when
    the domain is already attached, falling back to a label-count heuristic
    for the pre-add check where no Vercel record exists yet."""
    if apex_name:
        return domain == apex_name
    labels = domain.split(".")
    if len(labels) <= 2:
        return True
    if ".".join(labels[-2:]) in _MULTI_LABEL_SUFFIXES:
        return len(labels) == 3
    return False


def _required_records(domain: str, config: dict, apex_name: str | None) -> list[DnsRecord]:
    """The real records this specific domain needs, built from Vercel's own
    recommendations in the `/config` response."""
    if _is_apex(domain, apex_name):
        recommended = config.get("recommendedIPv4") or []
        values = (recommended[0].get("value") if recommended else None) or ["76.76.21.21"]
        return [DnsRecord(type="A", name="@", value=v) for v in values]

    recommended = config.get("recommendedCNAME") or []
    value = (recommended[0].get("value") if recommended else None) or "cname.vercel-dns.com"
    # Registrars want the bare sub-label ("app"), not the FQDN, and Vercel
    # returns the target with a trailing root dot.
    apex = apex_name or ".".join(domain.split(".")[-2:])
    label = domain[: -(len(apex) + 1)] if domain.endswith(f".{apex}") else domain
    return [DnsRecord(type="CNAME", name=label or "www", value=value.rstrip("."))]


async def _safe_domain_config(domain: str) -> dict:
    """Vercel's real DNS view of a domain. A lookup failure (transient API
    trouble, an odd TLD) must not take down the whole domain panel, so it
    degrades to "misconfigured, no detected records" — the same thing the
    user sees before they've pointed DNS, never a fabricated success."""
    try:
        return await asyncio.to_thread(get_domain_config, domain)
    except DeployError as exc:
        log.info("DNS config lookup failed for %s: %s", domain, exc)
        return {}


def _build_domain_response(
    domain: str,
    config: dict,
    verified: bool,
    verification: list[dict],
    apex_name: str | None,
    already_added: bool = False,
) -> DomainResponse:
    """Single place that turns Vercel's two real responses (project-domain
    status + DNS config) into the honest combined state."""
    misconfigured = bool(config.get("misconfigured", True))
    return DomainResponse(
        domain=domain,
        verified=verified,
        misconfigured=misconfigured,
        live=verified and not misconfigured,
        dns_records=_required_records(domain, config, apex_name),
        detected_a=config.get("aValues") or [],
        detected_cname=config.get("cnames") or [],
        nameservers=config.get("nameservers") or [],
        conflicts=config.get("conflicts") or [],
        verification=verification,
        already_added=already_added,
    )


@app.post(
    "/projects/{project_id}/domain",
    response_model=DomainResponse,
    dependencies=[Depends(rate_limit("domain-add", 10, 60))],
)
async def add_project_domain(
    project_id: str,
    body: DomainRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> DomainResponse:
    domain = body.domain.strip().lower()
    if not _DOMAIN_RE.match(domain):
        raise HTTPException(422, "That doesn't look like a valid domain.")
    _project, vp_name = await _domain_context(project_id, user_id)

    try:
        result = await asyncio.to_thread(add_domain, vp_name, domain)
    except DeployError as exc:
        raise HTTPException(502, str(exc))

    # Read the REAL DNS state right after attaching, so the response already
    # carries the exact records to create instead of making the UI wait for
    # the next poll to learn what to tell the user.
    config = await _safe_domain_config(domain)
    verified = bool(result.get("verified"))
    response = _build_domain_response(
        domain,
        config,
        verified,
        result.get("verification") or [],
        result.get("apexName"),
    )
    await asyncio.to_thread(db.set_project_domain, project_id, domain, response.live)
    return response


@app.get(
    "/projects/{project_id}/domain",
    response_model=DomainResponse,
    dependencies=[Depends(rate_limit("domain-status", 30, 60))],
)
async def get_project_domain(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> DomainResponse:
    project, vp_name = await _domain_context(project_id, user_id)
    domain = project.get("custom_domain")
    if not domain:
        return DomainResponse(domain=None, verified=False)

    try:
        result = await asyncio.to_thread(get_domain_status, vp_name, domain)
    except DeployError as exc:
        raise HTTPException(502, str(exc))

    verified = bool(result.get("verified"))
    # Not yet verified means Vercel's TXT challenge hasn't been seen. Ask it
    # to re-check now rather than waiting for whatever internal cadence it
    # uses — this is what actually flips a domain live once the owner adds
    # the record, instead of the panel spinning indefinitely.
    if not verified:
        reverified = await asyncio.to_thread(verify_domain, vp_name, domain)
        if reverified.get("verified"):
            verified = True
            result = reverified

    config = await _safe_domain_config(domain)
    response = _build_domain_response(
        domain,
        config,
        verified,
        result.get("verification") or [],
        result.get("apexName"),
    )
    # `custom_domain_verified` means genuinely reachable (owned AND pointed),
    # so the UI's "Live" badge can never be true for a domain that doesn't
    # actually serve.
    if response.live != project.get("custom_domain_verified"):
        await asyncio.to_thread(db.set_project_domain, project_id, domain, response.live)
    return response


@app.get(
    "/projects/{project_id}/domain/check",
    response_model=DomainResponse,
    dependencies=[Depends(rate_limit("domain-check", 30, 60))],
)
async def check_project_domain(
    project_id: str,
    domain: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> DomainResponse:
    """Pre-add inspection of a domain the owner is still typing: reads its
    REAL current DNS (Vercel's resolver, no project attachment required) and
    returns the exact records they'd need to create. Purely read-only —
    nothing is attached or persisted until they actually hit Add — so the
    "how do I connect this?" instructions can be shown up front instead of
    only after committing to a domain."""
    domain = domain.strip().lower()
    if not _DOMAIN_RE.match(domain):
        raise HTTPException(422, "That doesn't look like a valid domain.")
    project, _vp_name = await _domain_context(project_id, user_id)

    config = await _safe_domain_config(domain)
    # Ownership is unknowable until the domain is actually attached, so this
    # passes verified=False — which also forces `live` false. A pre-check
    # only ever reports whether DNS already points at Vercel, never that the
    # domain is working.
    return _build_domain_response(
        domain,
        config,
        verified=False,
        verification=[],
        apex_name=None,
        already_added=project.get("custom_domain") == domain,
    )


@app.delete(
    "/projects/{project_id}/domain",
    dependencies=[Depends(rate_limit("domain-remove", 10, 60))],
)
async def delete_project_domain(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, bool]:
    project, vp_name = await _domain_context(project_id, user_id)
    domain = project.get("custom_domain")
    if domain:
        try:
            await asyncio.to_thread(remove_domain, vp_name, domain)
        except DeployError as exc:
            raise HTTPException(502, str(exc))
        await asyncio.to_thread(db.set_project_domain, project_id, None, False)
    return {"ok": True}


# --------------------------------------------------------------------------
# Collaborators — invite an existing Meero user (by email) onto a project.
# v1 is deliberately simple: no pending/accepted state, just an active row
# the moment the owner adds it (00027_collaborators.sql). A collaborator can
# chat, trigger builds/fixes, and see everything the owner sees — billed to
# the OWNER's credits (see create_builds/chat_stream above) — but never
# touches account-level connections (GitHub/Supabase OAuth, custom domains,
# production releases), which stay hard-gated to is_project_owner.
# --------------------------------------------------------------------------


class CollaboratorRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class CollaboratorOut(BaseModel):
    user_id: str
    email: str | None
    display_name: str | None
    avatar_url: str | None
    invited_by: str
    created_at: str


class CollaboratorListResponse(BaseModel):
    collaborators: list[CollaboratorOut]


@app.get(
    "/projects/{project_id}/collaborators",
    response_model=CollaboratorListResponse,
    dependencies=[Depends(rate_limit("collaborators-list", 30, 60))],
)
async def list_project_collaborators(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> CollaboratorListResponse:
    owns = await asyncio.to_thread(db.is_project_owner, project_id, user_id)
    if not owns:
        raise HTTPException(404, "Project not found")
    rows = await asyncio.to_thread(db.list_collaborators, project_id)
    return CollaboratorListResponse(
        collaborators=[
            CollaboratorOut(
                user_id=row["user_id"],
                email=(row.get("profile") or {}).get("email"),
                display_name=(row.get("profile") or {}).get("display_name"),
                avatar_url=(row.get("profile") or {}).get("avatar_url"),
                invited_by=row["invited_by"],
                created_at=row["created_at"],
            )
            for row in rows
        ]
    )


@app.post(
    "/projects/{project_id}/collaborators",
    response_model=CollaboratorOut,
    dependencies=[Depends(rate_limit("collaborators-add", 15, 60))],
)
async def add_project_collaborator(
    project_id: str,
    body: CollaboratorRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> CollaboratorOut:
    owns = await asyncio.to_thread(db.is_project_owner, project_id, user_id)
    if not owns:
        raise HTTPException(404, "Project not found")

    email = body.email.strip().lower()
    target = await asyncio.to_thread(db.find_user_by_email, email)
    if target is None:
        raise HTTPException(
            404,
            "No Meero account found with that email — they need to sign up first.",
        )
    if target["id"] == user_id:
        raise HTTPException(422, "You already own this project.")
    if await asyncio.to_thread(db.is_project_collaborator, project_id, target["id"]):
        raise HTTPException(409, "That person is already a collaborator.")

    row = await asyncio.to_thread(db.add_collaborator, project_id, target["id"], user_id)
    return CollaboratorOut(
        user_id=target["id"],
        email=target.get("email"),
        display_name=target.get("display_name"),
        avatar_url=target.get("avatar_url"),
        invited_by=user_id,
        created_at=row["created_at"],
    )


@app.delete(
    "/projects/{project_id}/collaborators/{collaborator_user_id}",
    dependencies=[Depends(rate_limit("collaborators-remove", 15, 60))],
)
async def remove_project_collaborator(
    project_id: str,
    collaborator_user_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, bool]:
    owns = await asyncio.to_thread(db.is_project_owner, project_id, user_id)
    if not owns:
        raise HTTPException(404, "Project not found")
    await asyncio.to_thread(db.remove_collaborator, project_id, collaborator_user_id)
    return {"ok": True}


# --------------------------------------------------------------------------
# Display title — a real, cheap LLM call turning the raw build prompt into a
# short title for the public gallery (src/components/landing/
# public-gallery.tsx), called best-effort by the web app right after project
# creation (never blocking the redirect to the builder). Idempotent: if a
# title already exists, returns it without spending another call.
# --------------------------------------------------------------------------


class GenerateTitleResponse(BaseModel):
    display_title: str | None


@app.post(
    "/projects/{project_id}/generate-title",
    response_model=GenerateTitleResponse,
    dependencies=[Depends(rate_limit("generate-title", 10, 60))],
)
async def generate_project_title(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> GenerateTitleResponse:
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    existing = project.get("display_title")
    if existing:
        return GenerateTitleResponse(display_title=existing)

    prompt_text = (project.get("description") or "").strip()
    if not prompt_text:
        return GenerateTitleResponse(display_title=None)

    title = await asyncio.to_thread(generate_display_title, prompt_text)
    if title:
        await asyncio.to_thread(db.set_project_display_title, project_id, title)
    return GenerateTitleResponse(display_title=title)


# --------------------------------------------------------------------------
# Marketplace clone — a copy of a public project's real source/spec into a
# brand-new project owned by the caller, re-pointed at the CLONER'S own
# Supabase project (the stored source keeps the __SUPABASE_*__ placeholders,
# so nothing of the original owner's backend leaks). No new LLM call: the
# copied files go through a bundle-only build (schema applied to the
# cloner's database, a real `next build`), fully independent of the
# original. A
# flat CLONE_COST is a credit sink on the cloner, not a payout to the
# original creator — real creator payouts are the not-yet-built "crypto
# transactions" direction.
# --------------------------------------------------------------------------


class CloneRequest(BaseModel):
    # Which of the CLONER'S Supabase projects the copy should run against.
    supabase_project_ref: str


class CloneResponse(BaseModel):
    project_id: str


@app.post(
    "/projects/{project_id}/clone",
    response_model=CloneResponse,
    dependencies=[Depends(rate_limit("clone", 10, 60))],
)
async def clone_project(
    project_id: str,
    body: CloneRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> CloneResponse:
    source = await asyncio.to_thread(db.get_project, project_id)
    if source is None or not source.get("is_public"):
        raise HTTPException(404, "Project not found")

    source_build = await asyncio.to_thread(db.get_latest_succeeded_build, project_id)
    if source_build is None:
        raise HTTPException(422, "This project has no successful build to clone yet.")
    source_spec = await asyncio.to_thread(db.get_spec, source_build["spec_id"])
    if source_spec is None:
        raise HTTPException(422, "This project's spec is missing.")
    files = await asyncio.to_thread(db.list_build_files, source_build["id"])
    if not files:
        raise HTTPException(422, "This project has no stored source to clone.")

    credit = await asyncio.to_thread(db.credits_available, user_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    # The clone runs against the cloner's OWN Supabase — verify the ref is
    # really theirs and fetch its anon key via the real Management API.
    try:
        access_token = await asyncio.to_thread(fresh_access_token, user_id)
        their_projects = await asyncio.to_thread(list_projects, access_token)
        if body.supabase_project_ref not in {p["ref"] for p in their_projects}:
            raise HTTPException(422, "That Supabase project isn't in your account.")
        anon_key = await asyncio.to_thread(
            get_project_anon_key, access_token, body.supabase_project_ref
        )
    except SupabaseConnectError as exc:
        raise HTTPException(422, str(exc))

    new_project = await asyncio.to_thread(
        db.create_project_from_clone,
        user_id,
        f"{source['name']} (clone)",
        source.get("description"),
        project_id,
    )
    await asyncio.to_thread(
        db.set_project_supabase_link,
        new_project["id"],
        body.supabase_project_ref,
        project_url(body.supabase_project_ref),
        anon_key,
    )
    await asyncio.to_thread(disable_email_confirm, access_token, body.supabase_project_ref)

    new_spec = await asyncio.to_thread(
        db.create_spec, new_project["id"], source_spec["prompt"], user_id
    )

    # Copy the real (placeholder) source onto a fresh build and run it
    # through the normal build pipeline — schema onto the cloner's
    # database, a real `next build`, real preview. Codegen is skipped; the
    # code already exists.
    new_build = await asyncio.to_thread(
        db.create_build, new_project["id"], new_spec["id"], "web"
    )
    await asyncio.to_thread(
        db.replace_build_files, new_build["id"], new_project["id"], files
    )
    enqueue(
        WEB_BUILD_QUEUE,
        {
            "build_id": new_build["id"],
            "project_id": new_project["id"],
            "use_build_files": True,
        },
    )

    await asyncio.to_thread(db.charge_credits, user_id, CLONE_COST)
    return CloneResponse(project_id=new_project["id"])


# --------------------------------------------------------------------------
# Preview proxy — serves a live app bundle's static files (index.html +
# styles.css + bundle.js).
#
# NOT served directly from Supabase Storage's public object URL. Verified by
# direct testing (both via the Python client and a raw HTTP upload): Storage
# unconditionally forces "renderable" content-types like text/html down to
# text/plain, and adds `Content-Security-Policy: default-src 'none'; sandbox`
# to EVERY publicly served object — a deliberate, non-configurable anti-XSS
# guardrail, not something any upload option changes. That's reasonable for
# Storage's general purpose (arbitrary user-uploaded files), but it also means
# a browser can NEVER execute JavaScript if it loads the bundle straight from
# the Storage URL — only inert source text renders, never the real app.
#
# So the orchestrator downloads each file from Storage server-side and
# re-serves it under its own domain with the correct Content-Type and no
# server-imposed CSP override (the generated index.html carries its own
# strict CSP meta tag — that one stays). index.html's script/style tags
# reference "./bundle.js" / "./styles.css", relative paths, so they resolve
# back through this same route automatically. Public and unauthenticated,
# matching the previous behavior of the (also fully public) Storage bucket —
# no access change.
# --------------------------------------------------------------------------


@app.get("/preview/{build_id}/{file_path:path}")
async def serve_preview(build_id: str, file_path: str) -> Response:
    try:
        data = await asyncio.to_thread(
            db.download_preview_file, f"{build_id}/{file_path}"
        )
    except Exception as exc:
        raise HTTPException(404, "Preview file not found") from exc
    return Response(
        content=data,
        media_type=content_type_for(file_path),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# --------------------------------------------------------------------------
# Chat — the conversational build agent
# --------------------------------------------------------------------------


class ChatAttachment(BaseModel):
    path: str
    name: str


class ChatRequest(BaseModel):
    project_id: str
    message: str = Field(min_length=1, max_length=20000)
    # Real docs the user uploaded to their RLS-scoped attachments bucket.
    attachments: list[ChatAttachment] = Field(default_factory=list)


@app.post("/chat/stream", dependencies=[Depends(rate_limit("chat", 20, 60))])
async def chat_stream(
    body: ChatRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> StreamingResponse:
    """Runs the LangGraph chat agent, streaming reply tokens as SSE.

    Events:  {"token": "…"}  |  {"done": true, …}  |  {"error": "…"}
    """
    project = await asyncio.to_thread(db.get_project, body.project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = project.get("owner_id") == user_id or await asyncio.to_thread(
        db.is_project_collaborator, body.project_id, user_id
    )
    if not can_access:
        raise HTTPException(404, "Project not found")
    # A collaborator's chat turns are billed to the project OWNER's credits,
    # same as builds they trigger (see create_builds) — never their own.
    owner_id = project["owner_id"]

    spec = await asyncio.to_thread(db.get_latest_spec, body.project_id)
    history = await asyncio.to_thread(db.list_messages, body.project_id)
    # Gate on a minimum balance BEFORE running; the real token cost is charged
    # after the turn completes (metered billing — see 00010_token_billing.sql).
    credit = await asyncio.to_thread(db.credits_available, owner_id)

    async def event_stream():
        if not credit["allowed"]:
            yield f"data: {json.dumps({'error': _credit_denied_message(credit)})}\n\n"
            return

        final: dict = {}
        try:
            async for mode, chunk in chat_graph.astream(
                {
                    "project": project,
                    "spec": spec,
                    "history": history,
                    "message": body.message,
                    "user_plan": credit["plan"],
                    "attachments": [a.model_dump() for a in body.attachments],
                },
                stream_mode=["custom", "values"],
            ):
                if mode == "custom":
                    yield f"data: {json.dumps(chunk)}\n\n"
                else:
                    final = chunk

            # Reconcile: charge the real tokens this turn consumed (falling back
            # to a minimum so a turn is never free if usage wasn't reported).
            tokens = int(final.get("tokens_used") or 0) or CHAT_MIN_CHARGE
            charged = await asyncio.to_thread(db.charge_credits, owner_id, tokens)
            yield (
                "data: "
                + json.dumps(
                    {
                        "done": True,
                        "spec_version": final.get("new_spec_version"),
                        "builds_started": final.get("builds_started", []),
                        "build_pending": final.get("build_pending", False),
                        "questions": final.get("questions", []),
                        "tokens_used": tokens,
                        "credits_remaining": charged.get("remaining"),
                    }
                )
                + "\n\n"
            )
        except Exception as exc:  # surfaced to the client, never swallowed
            yield f"data: {json.dumps({'error': str(exc)[:500]})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --------------------------------------------------------------------------
# Billing — real Stripe Checkout + billing portal + webhook
# --------------------------------------------------------------------------

PLAN_PRICE_IDS = {
    "pro": lambda s: s.stripe_price_pro,
    "ultra": lambda s: s.stripe_price_ultra,
}


def _require_stripe() -> Settings:
    settings = get_settings()
    if not settings.stripe_configured:
        raise HTTPException(503, "Stripe isn't configured on this server.")
    stripe.api_key = settings.stripe_secret_key
    return settings


class CheckoutRequest(BaseModel):
    plan: Literal["pro", "ultra"]


class CheckoutResponse(BaseModel):
    url: str


@app.post(
    "/billing/checkout",
    response_model=CheckoutResponse,
    dependencies=[Depends(rate_limit("billing-checkout", 10, 60))],
)
async def billing_checkout(
    body: CheckoutRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> CheckoutResponse:
    settings = _require_stripe()
    profile = await asyncio.to_thread(db.get_profile, user_id)
    if profile is None:
        raise HTTPException(404, "Profile not found")

    customer_id = profile.get("stripe_customer_id")
    if not customer_id:
        customer = await asyncio.to_thread(
            stripe.Customer.create,
            email=profile.get("email"),
            metadata={"meero_user_id": user_id},
        )
        customer_id = customer["id"]
        await asyncio.to_thread(db.set_stripe_customer, user_id, customer_id)

    price_id = PLAN_PRICE_IDS[body.plan](settings)
    session = await asyncio.to_thread(
        stripe.checkout.Session.create,
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=settings.billing_success_url,
        cancel_url=settings.billing_cancel_url,
        metadata={"meero_user_id": user_id, "meero_plan": body.plan},
        subscription_data={
            "metadata": {"meero_user_id": user_id, "meero_plan": body.plan}
        },
    )
    return CheckoutResponse(url=session["url"])


# One-time top-up: a real $5 Stripe payment for real, non-expiring bonus tokens
# (profiles.bonus_credits) — see 00009_credit_topups.sql / 00010_token_billing.sql.
# This is `mode="payment"`, not a subscription, so it's a totally separate
# Stripe Checkout flow from billing_checkout above. A permanent option in the
# billing settings' "Buy more tokens" section — not a time-limited promo.

CREDITS_TOPUP_AMOUNT = CREDITS_TOPUP_TOKENS


@app.post(
    "/billing/checkout-credits",
    response_model=CheckoutResponse,
    dependencies=[Depends(rate_limit("billing-checkout-credits", 10, 60))],
)
async def billing_checkout_credits(
    user_id: Annotated[str, Depends(current_user_id)],
) -> CheckoutResponse:
    settings = get_settings()
    if not settings.credits_topup_configured:
        raise HTTPException(503, "Credit top-ups aren't configured on this server.")
    stripe.api_key = settings.stripe_secret_key

    profile = await asyncio.to_thread(db.get_profile, user_id)
    if profile is None:
        raise HTTPException(404, "Profile not found")

    customer_id = profile.get("stripe_customer_id")
    if not customer_id:
        customer = await asyncio.to_thread(
            stripe.Customer.create,
            email=profile.get("email"),
            metadata={"meero_user_id": user_id},
        )
        customer_id = customer["id"]
        await asyncio.to_thread(db.set_stripe_customer, user_id, customer_id)

    session = await asyncio.to_thread(
        stripe.checkout.Session.create,
        mode="payment",
        customer=customer_id,
        line_items=[{"price": settings.stripe_price_credits_topup, "quantity": 1}],
        success_url=settings.billing_success_url,
        cancel_url=settings.billing_cancel_url,
        metadata={
            "meero_user_id": user_id,
            "meero_credit_topup": str(CREDITS_TOPUP_AMOUNT),
        },
    )
    return CheckoutResponse(url=session["url"])


class PortalResponse(BaseModel):
    url: str


@app.post(
    "/billing/portal",
    response_model=PortalResponse,
    dependencies=[Depends(rate_limit("billing-portal", 10, 60))],
)
async def billing_portal(
    user_id: Annotated[str, Depends(current_user_id)],
) -> PortalResponse:
    settings = _require_stripe()
    profile = await asyncio.to_thread(db.get_profile, user_id)
    customer_id = profile.get("stripe_customer_id") if profile else None
    if not customer_id:
        raise HTTPException(404, "No billing account yet — subscribe first.")

    session = await asyncio.to_thread(
        stripe.billing_portal.Session.create,
        customer=customer_id,
        return_url=settings.billing_portal_return_url,
    )
    return PortalResponse(url=session["url"])


def _plan_from_price_id(settings, price_id: str | None) -> str | None:
    if price_id == settings.stripe_price_pro:
        return "pro"
    if price_id == settings.stripe_price_ultra:
        return "ultra"
    return None


@app.post(
    "/billing/webhook",
    dependencies=[Depends(rate_limit("billing-webhook", 120, 60))],
)
async def billing_webhook(request: Request) -> dict:
    settings = _require_stripe()
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload, signature, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise HTTPException(400, f"Invalid webhook signature: {exc}")

    etype = event["type"]
    data = event["data"]["object"]

    if etype == "checkout.session.completed":
        metadata = data.get("metadata") or {}
        if data.get("mode") == "payment" and metadata.get("meero_credit_topup"):
            # One-time credit top-up — a real payment, not a subscription.
            user_id = metadata.get("meero_user_id")
            if user_id:
                await asyncio.to_thread(
                    db.add_bonus_credits, user_id, int(metadata["meero_credit_topup"])
                )
        else:
            customer_id = data.get("customer")
            plan = metadata.get("meero_plan")
            if customer_id and plan:
                await asyncio.to_thread(
                    db.apply_subscription, customer_id, plan, data.get("subscription"), "active"
                )

    elif etype in ("customer.subscription.updated", "customer.subscription.created"):
        customer_id = data.get("customer")
        status = data.get("status")
        items = (data.get("items") or {}).get("data") or []
        price_id = items[0].get("price", {}).get("id") if items else None
        plan = _plan_from_price_id(settings, price_id)
        if customer_id and status in ("active", "trialing") and plan:
            await asyncio.to_thread(
                db.apply_subscription, customer_id, plan, data.get("id"), status
            )
        elif customer_id and status not in ("active", "trialing"):
            await asyncio.to_thread(
                db.apply_subscription, customer_id, "free", data.get("id"), status
            )

    elif etype == "customer.subscription.deleted":
        customer_id = data.get("customer")
        if customer_id:
            await asyncio.to_thread(
                db.apply_subscription, customer_id, "free", None, "canceled"
            )

    return {"received": True}


# --------------------------------------------------------------------------
# Supabase connect — the generated apps' backend is the USER'S OWN Supabase.
# Real OAuth connect against api.supabase.com, then real Management API
# calls: list their projects, link one per Meero project, and (per build,
# from the web worker) apply the generated schema.sql to their database.
# --------------------------------------------------------------------------


class SupabaseAuthorizeResponse(BaseModel):
    url: str


@app.get(
    "/auth/supabase/authorize",
    response_model=SupabaseAuthorizeResponse,
    dependencies=[Depends(rate_limit("supabase-authorize", 10, 60))],
)
async def supabase_authorize(
    user_id: Annotated[str, Depends(current_user_id)],
    project_id: str | None = None,
) -> SupabaseAuthorizeResponse:
    # project_id is optional — the account settings page connects Supabase
    # with no project in scope (see supabase_connect.build_authorize_url);
    # a project-scoped connect still requires real ownership of that project.
    if project_id is not None:
        owns = await asyncio.to_thread(db.is_project_owner, project_id, user_id)
        if not owns:
            raise HTTPException(404, "Project not found")
    try:
        url = await asyncio.to_thread(supabase_authorize_url, user_id, project_id)
    except SupabaseConnectError as exc:
        raise HTTPException(503, str(exc))
    return SupabaseAuthorizeResponse(url=url)


def _start_supabase_auto_provision(project_id: str, access_token: str) -> None:
    """Kicks off a REAL new Supabase project for this Meero project so
    connecting the account is the only step (owner decision, 2026-08-08 —
    see 00045_supabase_auto_provision.sql). Best-effort: any failure here
    (no organizations on the account, a Management API error) just leaves
    the project unprovisioned with an honest error recorded — the manual
    "link an existing project" picker stays available as a fallback, and
    every build/chat gate already requires supabase_project_ref, so nothing
    downstream can mistake a failed auto-provision for a working link."""
    project = db.get_project(project_id)
    if project is None or project.get("supabase_project_ref"):
        return  # already linked (e.g. a reconnect) — never provision twice

    try:
        orgs = list_supabase_organizations(access_token)
        if not orgs:
            raise SupabaseConnectError(
                "Your Supabase account has no organizations to create a project in."
            )
        settings = get_settings()
        name = re.sub(r"[^a-zA-Z0-9 _-]+", "", project.get("name") or "meero-app")[:60].strip() or "meero-app"
        created = create_supabase_project(
            access_token,
            orgs[0]["id"],
            name,
            settings.supabase_new_project_region,
            settings.supabase_new_project_plan,
        )
        ref = created.get("ref")
        if not ref:
            raise SupabaseConnectError(f"Supabase didn't return a project ref: {created}")
    except SupabaseConnectError as exc:
        log.warning("Supabase auto-provision failed for project %s: %s", project_id, exc)
        db.fail_project_provisioning(project_id, str(exc))
        return

    db.start_project_provisioning(project_id, ref)


@app.get(
    "/auth/supabase/callback",
    dependencies=[Depends(rate_limit("supabase-callback", 20, 60))],
)
async def supabase_callback(code: str, state: str) -> RedirectResponse:
    settings = get_settings()
    resolved = await asyncio.to_thread(resolve_supabase_state, state)
    if resolved is None:
        raise HTTPException(400, "Supabase connect link expired — try again.")
    user_id, project_id = resolved

    # No project in scope (connected from account settings) — redirect back
    # there instead of a /project/{id} URL that doesn't exist for this flow.
    fail_url = (
        f"{settings.frontend_url}/project/{project_id}?supabase=error"
        if project_id
        else f"{settings.frontend_url}/settings?section=supabase&supabase=error"
    )
    try:
        tokens = await asyncio.to_thread(exchange_code_for_tokens, code)
        await asyncio.to_thread(
            db.save_supabase_connection,
            user_id,
            tokens["access_token"],
            tokens["refresh_token"],
            tokens["expires_at"],
        )
    except SupabaseConnectError:
        return RedirectResponse(fail_url)

    # Real project creation only needs the access token we just persisted —
    # the background poller (_start_supabase_provision_poller) takes it from
    # here, so this call just needs to accept fast, not finish fast. Skipped
    # entirely for an account-only connect (project_id is None) — there's no
    # project to provision a database for yet; a later project links or
    # provisions one for itself once the account is connected.
    if project_id:
        await asyncio.to_thread(
            _start_supabase_auto_provision, project_id, tokens["access_token"]
        )
        return RedirectResponse(
            f"{settings.frontend_url}/project/{project_id}?supabase=connected"
        )

    return RedirectResponse(
        f"{settings.frontend_url}/settings?section=supabase&supabase=connected"
    )


class SupabaseProjectsResponse(BaseModel):
    projects: list[dict]


@app.get(
    "/supabase/projects",
    response_model=SupabaseProjectsResponse,
    dependencies=[Depends(rate_limit("supabase-projects", 20, 60))],
)
async def supabase_projects(
    user_id: Annotated[str, Depends(current_user_id)],
) -> SupabaseProjectsResponse:
    try:
        access_token = await asyncio.to_thread(fresh_access_token, user_id)
        projects = await asyncio.to_thread(list_projects, access_token)
    except SupabaseConnectError as exc:
        raise HTTPException(422, str(exc))
    return SupabaseProjectsResponse(projects=projects)


class SupabaseLinkRequest(BaseModel):
    project_ref: str


class SupabaseLinkResponse(BaseModel):
    project_ref: str
    url: str


@app.post(
    "/projects/{project_id}/supabase/link",
    response_model=SupabaseLinkResponse,
    dependencies=[Depends(rate_limit("supabase-link", 10, 60))],
)
async def supabase_link(
    project_id: str,
    body: SupabaseLinkRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> SupabaseLinkResponse:
    owns = await asyncio.to_thread(db.is_project_owner, project_id, user_id)
    if not owns:
        raise HTTPException(404, "Project not found")

    try:
        access_token = await asyncio.to_thread(fresh_access_token, user_id)
        their_projects = await asyncio.to_thread(list_projects, access_token)
        if body.project_ref not in {p["ref"] for p in their_projects}:
            raise HTTPException(422, "That Supabase project isn't in your account.")
        anon_key = await asyncio.to_thread(
            get_project_anon_key, access_token, body.project_ref
        )
    except SupabaseConnectError as exc:
        raise HTTPException(422, str(exc))

    url = project_url(body.project_ref)
    await asyncio.to_thread(
        db.set_project_supabase_link, project_id, body.project_ref, url, anon_key
    )
    # v1: generated-app signups must work instantly (no email round-trip).
    await asyncio.to_thread(disable_email_confirm, access_token, body.project_ref)
    return SupabaseLinkResponse(project_ref=body.project_ref, url=url)


class SupabaseStatusResponse(BaseModel):
    linked: bool
    project_ref: str | None
    url: str | None
    provisioning_status: Literal["provisioning", "failed"] | None
    provisioning_error: str | None


@app.get(
    "/projects/{project_id}/supabase/status",
    response_model=SupabaseStatusResponse,
    dependencies=[Depends(rate_limit("supabase-status", 60, 60))],
)
async def supabase_status(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> SupabaseStatusResponse:
    """Lets the builder poll real auto-provisioning progress (00045) without
    a full page reload — same "poll a small status endpoint" shape as
    DomainManager's GET /projects/{id}/domain."""
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    return SupabaseStatusResponse(
        linked=bool(project.get("supabase_project_ref")),
        project_ref=project.get("supabase_project_ref"),
        url=project.get("supabase_url"),
        provisioning_status=project.get("supabase_provisioning_status"),
        provisioning_error=project.get("supabase_provisioning_error"),
    )


class SupabaseDisconnectResponse(BaseModel):
    disconnected: bool = True


@app.post(
    "/projects/{project_id}/supabase/disconnect",
    response_model=SupabaseDisconnectResponse,
    dependencies=[Depends(rate_limit("supabase-disconnect", 10, 60))],
)
async def supabase_disconnect(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> SupabaseDisconnectResponse:
    """Logs the user out of Supabase (account-level: the stored Management
    API tokens are dropped) and unbinds this project so the builder shows it
    honestly as unlinked. Already-deployed apps keep running on their public
    anon key; only future builds need a reconnect."""
    owns = await asyncio.to_thread(db.is_project_owner, project_id, user_id)
    if not owns:
        raise HTTPException(404, "Project not found")
    await asyncio.to_thread(db.clear_project_supabase_link, project_id)
    await asyncio.to_thread(db.delete_supabase_connection, user_id)
    return SupabaseDisconnectResponse()


# --------------------------------------------------------------------------
# GitHub — real OAuth connect that immediately creates the project's repo,
# then a real commit to main per successful build + auto-fix (committed by
# the web worker via maybe_commit_build_to_github).
# --------------------------------------------------------------------------


class GithubAuthorizeResponse(BaseModel):
    url: str


@app.get(
    "/auth/github/authorize",
    response_model=GithubAuthorizeResponse,
    dependencies=[Depends(rate_limit("github-authorize", 10, 60))],
)
async def github_authorize(
    user_id: Annotated[str, Depends(current_user_id)],
    project_id: str | None = None,
) -> GithubAuthorizeResponse:
    # project_id is optional — the account settings page connects GitHub
    # with no project in scope (see build_authorize_url); a project-scoped
    # connect (from a project's Connections tab) still requires real
    # ownership of that project.
    if project_id is not None:
        owns = await asyncio.to_thread(db.is_project_owner, project_id, user_id)
        if not owns:
            raise HTTPException(404, "Project not found")
    try:
        url = await asyncio.to_thread(build_authorize_url, user_id, project_id)
    except GithubPublishError as exc:
        raise HTTPException(503, str(exc))
    return GithubAuthorizeResponse(url=url)


@app.get(
    "/auth/github/callback",
    dependencies=[Depends(rate_limit("github-callback", 20, 60))],
)
async def github_callback(code: str, state: str) -> RedirectResponse:
    settings = get_settings()
    resolved = await asyncio.to_thread(resolve_state, state)
    if resolved is None:
        # Not a project-connect state — try the Superagent connect flow
        # (superagent.py), which shares this exact callback URL on purpose:
        # classic GitHub OAuth Apps only support ONE registered callback,
        # so the two flows are told apart by which Redis key prefix the
        # state token resolves under, not by a second URL.
        superagent_user_id = await asyncio.to_thread(resolve_superagent_state, state)
        if superagent_user_id is not None:
            try:
                token = await asyncio.to_thread(exchange_code_for_token, code)
                gh_user = await asyncio.to_thread(fetch_github_user, token)
                await asyncio.to_thread(
                    db.save_github_connection, superagent_user_id, gh_user["login"], token
                )
            except (GithubPublishError, KeyError):
                return RedirectResponse(f"{settings.frontend_url}/?superagent=error")
            return RedirectResponse(f"{settings.frontend_url}/?superagent=connected")
        raise HTTPException(400, "GitHub connect link expired — try again.")
    user_id, project_id = resolved

    # No project in scope (connected from account settings) — redirect back
    # there instead of a /project/{id} URL that doesn't exist for this flow.
    fail_url = (
        f"{settings.frontend_url}/project/{project_id}?github=error"
        if project_id
        else f"{settings.frontend_url}/settings?section=github&github=error"
    )
    try:
        token = await asyncio.to_thread(exchange_code_for_token, code)
        gh_user = await asyncio.to_thread(fetch_github_user, token)
        await asyncio.to_thread(
            db.save_github_connection, user_id, gh_user["login"], token
        )
    except (GithubPublishError, KeyError):
        return RedirectResponse(fail_url)

    # Owner decision (2026-07-28): connecting GitHub immediately creates the
    # project's repo (README-initialized, so `main` exists), so every later
    # successful build commits straight to it — no separate "publish" step.
    # Best-effort: if repo creation fails (e.g. name collision), the user is
    # still connected and can retry from the builder; we don't block connect.
    # Skipped entirely for an account-only connect (project_id is None) —
    # there's no project to create a repo for; POST /projects/{id}/github/
    # publish covers that later, for any project, once connected.
    if project_id:
        try:
            project = await asyncio.to_thread(db.get_project, project_id)
            if (
                project
                and project.get("owner_id") == user_id
                and not project.get("github_repo_full_name")
            ):
                repo = await asyncio.to_thread(
                    ensure_project_repo,
                    token,
                    project.get("name") or "Meero App",
                    project_id,
                )
                await asyncio.to_thread(
                    db.set_project_github_repo,
                    project_id,
                    repo["full_name"],
                    repo["html_url"],
                )
        except GithubPublishError:
            return RedirectResponse(
                f"{settings.frontend_url}/project/{project_id}?github=repo_error"
            )
        return RedirectResponse(
            f"{settings.frontend_url}/project/{project_id}?github=connected"
        )

    return RedirectResponse(f"{settings.frontend_url}/settings?section=github&github=connected")


@app.get(
    "/auth/slack/callback",
    dependencies=[Depends(rate_limit("slack-callback", 20, 60))],
)
async def slack_callback(code: str, state: str) -> RedirectResponse:
    """Real Slack OAuth v2 callback — registered as this exact URL on the
    Slack App's own dashboard (Settings.slack_oauth_redirect_uri)."""
    settings = get_settings()
    user_id = await asyncio.to_thread(resolve_slack_state, state)
    if user_id is None:
        raise HTTPException(400, "Slack connect link expired — try again.")

    fail_url = f"{settings.frontend_url}/?superagent=slack_error"
    try:
        data = await asyncio.to_thread(exchange_slack_code, code)
        team = data.get("team") or {}
        await asyncio.to_thread(
            db.save_slack_connection,
            user_id,
            team.get("id", ""),
            team.get("name", ""),
            data["access_token"],
            data.get("bot_user_id", ""),
        )
    except (SlackError, KeyError):
        return RedirectResponse(fail_url)

    return RedirectResponse(f"{settings.frontend_url}/?superagent=slack_connected")


class GithubPublishResponse(BaseModel):
    full_name: str
    html_url: str


@app.post(
    "/projects/{project_id}/github/publish",
    response_model=GithubPublishResponse,
    dependencies=[Depends(rate_limit("github-publish", 5, 60))],
)
async def github_publish(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> GithubPublishResponse:
    """Links an ALREADY-connected user's project to a fresh GitHub repo. The
    common path creates the repo automatically at connect time (see
    /auth/github/callback); this endpoint covers the case where the user
    connected GitHub on an earlier project and now wants to track this one.
    Creates a README-initialized repo (so `main` exists) and, if a build has
    already succeeded, commits its source right away — otherwise the next
    successful build is the first commit."""
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None or project.get("owner_id") != user_id:
        raise HTTPException(404, "Project not found")
    if project.get("github_repo_url"):
        raise HTTPException(409, "This project is already linked to a repo.")

    connection = await asyncio.to_thread(db.get_github_connection, user_id)
    if connection is None:
        raise HTTPException(422, "Connect your GitHub account first.")

    try:
        result = await asyncio.to_thread(
            ensure_project_repo,
            connection["access_token"],
            project.get("name") or "Meero App",
            project_id,
        )
    except GithubPublishError as exc:
        raise HTTPException(502, str(exc))

    await asyncio.to_thread(
        db.set_project_github_repo, project_id, result["full_name"], result["html_url"]
    )

    # If a build already succeeded before the repo existed, commit it now so
    # the repo isn't just an empty README — best-effort, mirrors the worker.
    latest_build = await asyncio.to_thread(db.get_latest_succeeded_build, project_id)
    if latest_build is not None:
        from app.services.github.github_publish import maybe_commit_build_to_github

        await asyncio.to_thread(
            maybe_commit_build_to_github, project_id, latest_build["id"]
        )

    return GithubPublishResponse(**result)


# --------------------------------------------------------------------------
# Superagent — a personal GitHub bot on the user's own repo, independent of
# any Meero project. See app/superagent.py's module docstring for what's
# real here (repo listing, webhook creation, partial-tree PRs, all genuine
# GitHub API calls) versus the one real limitation this codebase can't
# route around on its own (a true "meero[bot]" identity needs a GitHub App
# a human has to register on github.com).
# --------------------------------------------------------------------------


class SuperagentAuthorizeResponse(BaseModel):
    url: str


@app.get(
    "/superagent/github/authorize",
    response_model=SuperagentAuthorizeResponse,
    dependencies=[Depends(rate_limit("superagent-authorize", 10, 60))],
)
async def superagent_github_authorize(
    user_id: Annotated[str, Depends(current_user_id)],
) -> SuperagentAuthorizeResponse:
    try:
        url = await asyncio.to_thread(build_superagent_authorize_url, user_id)
    except GithubPublishError as exc:
        raise HTTPException(503, str(exc))
    return SuperagentAuthorizeResponse(url=url)


class SuperagentRepo(BaseModel):
    full_name: str
    html_url: str
    private: bool
    default_branch: str


@app.get(
    "/superagent/repos",
    response_model=list[SuperagentRepo],
    dependencies=[Depends(rate_limit("superagent-repos", 20, 60))],
)
async def superagent_repos(
    user_id: Annotated[str, Depends(current_user_id)],
) -> list[SuperagentRepo]:
    connection = await asyncio.to_thread(db.get_github_connection, user_id)
    if connection is None:
        raise HTTPException(422, "Connect your GitHub account first.")
    try:
        repos = await asyncio.to_thread(list_user_repos, connection["access_token"])
    except httpx.HTTPError as exc:
        raise HTTPException(502, f"Could not list your GitHub repos: {exc}")
    return [SuperagentRepo(**r) for r in repos]


class SuperagentConnectRequest(BaseModel):
    github_repo_full_name: str
    instructions: str = ""


class SuperagentConnection(BaseModel):
    id: str
    github_repo_full_name: str
    github_repo_url: str
    instructions: str
    status: str
    created_at: str
    slack_channel_id: str | None = None
    slack_channel_name: str | None = None


@app.post(
    "/superagent/connections",
    response_model=SuperagentConnection,
    dependencies=[Depends(rate_limit("superagent-connect", 10, 60))],
)
async def create_superagent_connection(
    body: SuperagentConnectRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> SuperagentConnection:
    connection = await asyncio.to_thread(db.get_github_connection, user_id)
    if connection is None:
        raise HTTPException(422, "Connect your GitHub account first.")
    token = connection["access_token"]

    secret = secrets.token_urlsafe(32)
    try:
        repo_url = f"https://github.com/{body.github_repo_full_name}"
        hook = await asyncio.to_thread(
            create_webhook, token, body.github_repo_full_name, secret
        )
    except GithubPublishError as exc:
        raise HTTPException(502, str(exc))

    row = await asyncio.to_thread(
        db.create_superagent_connection,
        user_id,
        body.github_repo_full_name,
        repo_url,
        hook["id"],
        secret,
        body.instructions,
    )
    return SuperagentConnection(
        id=row["id"],
        github_repo_full_name=row["github_repo_full_name"],
        github_repo_url=row["github_repo_url"],
        instructions=row["instructions"],
        status=row["status"],
        created_at=row["created_at"],
    )


@app.get(
    "/superagent/connections",
    response_model=list[SuperagentConnection],
    dependencies=[Depends(rate_limit("superagent-list", 30, 60))],
)
async def list_superagent_connections_endpoint(
    user_id: Annotated[str, Depends(current_user_id)],
) -> list[SuperagentConnection]:
    rows = await asyncio.to_thread(db.list_superagent_connections, user_id)
    return [
        SuperagentConnection(
            id=r["id"],
            github_repo_full_name=r["github_repo_full_name"],
            github_repo_url=r["github_repo_url"],
            instructions=r["instructions"],
            status=r["status"],
            created_at=r["created_at"],
            slack_channel_id=r.get("slack_channel_id"),
            slack_channel_name=r.get("slack_channel_name"),
        )
        for r in rows
    ]


@app.delete(
    "/superagent/connections/{connection_id}",
    dependencies=[Depends(rate_limit("superagent-delete", 15, 60))],
)
async def delete_superagent_connection_endpoint(
    connection_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, bool]:
    row = await asyncio.to_thread(db.get_superagent_connection, connection_id)
    if row is None or row.get("user_id") != user_id:
        raise HTTPException(404, "Connection not found")

    gh = await asyncio.to_thread(db.get_github_connection, user_id)
    if gh is not None:
        await asyncio.to_thread(
            delete_webhook, gh["access_token"], row["github_repo_full_name"], row["github_webhook_id"]
        )
    await asyncio.to_thread(db.delete_superagent_connection, connection_id)
    return {"ok": True}


class SuperagentEvent(BaseModel):
    id: str
    event_type: str
    issue_number: int | None
    status: str
    pr_url: str | None
    summary: str | None
    error: str | None
    created_at: str


@app.get(
    "/superagent/connections/{connection_id}/events",
    response_model=list[SuperagentEvent],
    dependencies=[Depends(rate_limit("superagent-events", 30, 60))],
)
async def list_superagent_events_endpoint(
    connection_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> list[SuperagentEvent]:
    row = await asyncio.to_thread(db.get_superagent_connection, connection_id)
    if row is None or row.get("user_id") != user_id:
        raise HTTPException(404, "Connection not found")
    events = await asyncio.to_thread(db.list_superagent_events, connection_id)
    return [SuperagentEvent(**e) for e in events]


# --------------------------------------------------------------------------
# Superagent chat — a genuine conversation, not just "assign a task". Same
# real brain (select_relevant_files/generate_patch) and same real PR
# pipeline (open_pull_request_with_patch) the webhook-triggered worker
# uses, just invoked directly and synchronously so the composer gets a
# real reply in the same request — including a real "no, this doesn't need
# a code change" answer when that's the honest response, not a forced PR.
# --------------------------------------------------------------------------


class SuperagentChatRequest(BaseModel):
    message: str


class SuperagentChatMessage(BaseModel):
    id: str
    role: str
    content: str
    pr_url: str | None
    created_at: str


@app.get(
    "/superagent/connections/{connection_id}/messages",
    response_model=list[SuperagentChatMessage],
    dependencies=[Depends(rate_limit("superagent-messages", 30, 60))],
)
async def list_superagent_messages_endpoint(
    connection_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> list[SuperagentChatMessage]:
    row = await asyncio.to_thread(db.get_superagent_connection, connection_id)
    if row is None or row.get("user_id") != user_id:
        raise HTTPException(404, "Connection not found")
    messages = await asyncio.to_thread(db.list_superagent_messages, connection_id)
    return [SuperagentChatMessage(**m) for m in messages]


@app.post(
    "/superagent/connections/{connection_id}/chat",
    response_model=SuperagentChatMessage,
    dependencies=[Depends(rate_limit("superagent-chat", 20, 60))],
)
async def superagent_chat(
    connection_id: str,
    body: SuperagentChatRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> SuperagentChatMessage:
    connection = await asyncio.to_thread(db.get_superagent_connection, connection_id)
    if connection is None or connection.get("user_id") != user_id:
        raise HTTPException(404, "Connection not found")
    if connection.get("status") != "active":
        raise HTTPException(409, "This connection is paused.")

    message = body.message.strip()
    if not message:
        raise HTTPException(422, "Message can't be empty.")

    gh = await asyncio.to_thread(db.get_github_connection, user_id)
    if gh is None:
        raise HTTPException(422, "GitHub is no longer connected.")
    token = gh["access_token"]
    full_name = connection["github_repo_full_name"]

    await asyncio.to_thread(
        db.create_superagent_message, connection_id, user_id, "user", message
    )
    prior = await asyncio.to_thread(db.list_superagent_messages, connection_id, 20)
    # Everything except the user turn just saved above — that one's already
    # carried as `message` itself.
    history = [{"role": m["role"], "content": m["content"]} for m in prior[:-1]]

    profile = await asyncio.to_thread(db.get_profile, user_id) or {}
    model = model_for_plan(profile.get("plan"))

    pr_url: str | None = None
    try:
        branch = await asyncio.to_thread(get_default_branch, token, full_name)
        tree = await asyncio.to_thread(get_repo_tree, token, full_name, branch)

        selection = await asyncio.to_thread(
            select_relevant_files,
            repo_full_name=full_name,
            mention_text=message,
            issue_title="",
            issue_body="",
            file_tree=tree,
            model=model,
            history=history,
        )

        if selection.can_help and selection.paths:
            files: dict[str, str] = {}
            for path in selection.paths:
                content = await asyncio.to_thread(
                    get_file_content, token, full_name, path, branch
                )
                if content is not None:
                    files[path] = content

            patch = await asyncio.to_thread(
                generate_patch,
                repo_full_name=full_name,
                mention_text=message,
                issue_title="",
                issue_body="",
                files=files,
                model=model,
                history=history,
            )
            if patch.can_help and patch.files:
                pr = await asyncio.to_thread(
                    open_pull_request_with_patch,
                    token,
                    full_name,
                    [{"path": f.path, "content": f.content} for f in patch.files],
                    make_branch_name(patch.branch_name, secrets.token_hex(4)),
                    patch.pr_title or "Meero: automated change",
                    patch.pr_body or "Opened by Superagent from a chat message.",
                    branch,
                )
                pr_url = pr["html_url"]
                reply_text = f"{patch.reply_comment}\n\nOpened {pr_url}".strip()
            else:
                reply_text = (
                    patch.reply_comment or "I don't think this needs a code change."
                )
        else:
            reply_text = (
                selection.reason
                or "Tell me more about what you'd like me to do in this repo."
            )
    except (GithubPublishError, httpx.HTTPError) as exc:
        reply_text = f"Something went wrong talking to GitHub: {exc}"[:2000]
    except Exception as exc:  # noqa: BLE001 — a chat reply must never 500 silently
        reply_text = f"Something went wrong on my end: {exc}"[:2000]

    saved = await asyncio.to_thread(
        db.create_superagent_message,
        connection_id,
        user_id,
        "assistant",
        reply_text,
        pr_url,
    )
    return SuperagentChatMessage(**saved)


@app.post(
    "/webhooks/github/superagent",
    dependencies=[Depends(rate_limit("superagent-webhook", 240, 60))],
)
async def superagent_webhook(request: Request) -> dict[str, bool]:
    """Real inbound GitHub webhook delivery — the ONLY unauthenticated
    endpoint in this whole section, verified instead via a real HMAC-SHA256
    signature checked against the connection's own stored secret (see
    superagent.verify_webhook_signature). The connection is looked up by
    repo full_name from the payload BEFORE the signature check, since the
    secret is per-connection — nothing from the payload is acted on until
    that check passes.
    """
    raw = await request.body()
    event_type = request.headers.get("x-github-event", "")
    if event_type == "ping":
        return {"ok": True}
    if event_type not in ("issue_comment", "pull_request_review_comment"):
        return {"ok": True}

    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid JSON payload")

    full_name = (payload.get("repository") or {}).get("full_name")
    if not full_name:
        return {"ok": True}

    connection = await asyncio.to_thread(db.get_superagent_connection_by_repo, full_name)
    if connection is None:
        return {"ok": True}

    signature = request.headers.get("x-hub-signature-256")
    if not verify_webhook_signature(connection["webhook_secret"], raw, signature):
        raise HTTPException(401, "Invalid signature")

    if payload.get("action") != "created":
        return {"ok": True}

    comment_body = (payload.get("comment") or {}).get("body") or ""
    if MENTION not in comment_body.lower():
        return {"ok": True}

    issue = payload.get("issue") or payload.get("pull_request") or {}
    issue_number = issue.get("number")
    if issue_number is None:
        return {"ok": True}

    event = await asyncio.to_thread(
        db.create_superagent_event,
        connection["id"],
        connection["user_id"],
        event_type,
        issue_number,
    )
    enqueue(
        SUPERAGENT_QUEUE,
        {
            "connection_id": connection["id"],
            "event_id": event["id"],
            "event_type": event_type,
            "issue_number": issue_number,
            "issue_title": issue.get("title") or "",
            "issue_body": issue.get("body") or "",
            "mention_text": comment_body,
        },
    )
    return {"ok": True}


# --------------------------------------------------------------------------
# Superagent — Slack. Same real agent pipeline as the GitHub mention/chat
# paths above, just a different trigger and reply channel: link a real
# Slack channel to a repo connection, and a genuine "@Meero" mention there
# enqueues the exact same SUPERAGENT_QUEUE job. Every endpoint here 422s
# with a clear message if Settings.slack_configured is false — see
# app/config.py for what a human needs to set up on Slack's own dashboard
# first (there's no API to create a Slack App).
# --------------------------------------------------------------------------


class SlackAuthorizeResponse(BaseModel):
    url: str


@app.get(
    "/superagent/slack/authorize",
    response_model=SlackAuthorizeResponse,
    dependencies=[Depends(rate_limit("superagent-slack-authorize", 10, 60))],
)
async def superagent_slack_authorize(
    user_id: Annotated[str, Depends(current_user_id)],
) -> SlackAuthorizeResponse:
    try:
        url = await asyncio.to_thread(build_slack_authorize_url, user_id)
    except SlackError as exc:
        raise HTTPException(503, str(exc))
    return SlackAuthorizeResponse(url=url)


class SlackStatus(BaseModel):
    connected: bool
    team_name: str | None = None


@app.get(
    "/superagent/slack/status",
    response_model=SlackStatus,
    dependencies=[Depends(rate_limit("superagent-slack-status", 30, 60))],
)
async def superagent_slack_status(
    user_id: Annotated[str, Depends(current_user_id)],
) -> SlackStatus:
    connection = await asyncio.to_thread(db.get_slack_connection, user_id)
    if connection is None:
        return SlackStatus(connected=False)
    return SlackStatus(connected=True, team_name=connection["team_name"])


class SlackChannel(BaseModel):
    id: str
    name: str
    is_private: bool


@app.get(
    "/superagent/slack/channels",
    response_model=list[SlackChannel],
    dependencies=[Depends(rate_limit("superagent-slack-channels", 20, 60))],
)
async def superagent_slack_channels(
    user_id: Annotated[str, Depends(current_user_id)],
) -> list[SlackChannel]:
    connection = await asyncio.to_thread(db.get_slack_connection, user_id)
    if connection is None:
        raise HTTPException(422, "Connect Slack first.")
    try:
        channels = await asyncio.to_thread(list_slack_channels, connection["bot_token"])
    except (SlackError, httpx.HTTPError) as exc:
        raise HTTPException(502, f"Could not list Slack channels: {exc}")
    return [SlackChannel(**c) for c in channels]


class LinkSlackChannelRequest(BaseModel):
    channel_id: str
    channel_name: str


@app.post(
    "/superagent/connections/{connection_id}/slack-channel",
    response_model=SuperagentConnection,
    dependencies=[Depends(rate_limit("superagent-slack-link", 15, 60))],
)
async def link_superagent_slack_channel(
    connection_id: str,
    body: LinkSlackChannelRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> SuperagentConnection:
    row = await asyncio.to_thread(db.get_superagent_connection, connection_id)
    if row is None or row.get("user_id") != user_id:
        raise HTTPException(404, "Connection not found")
    slack = await asyncio.to_thread(db.get_slack_connection, user_id)
    if slack is None:
        raise HTTPException(422, "Connect Slack first.")

    await asyncio.to_thread(
        db.link_slack_channel, connection_id, body.channel_id, body.channel_name
    )
    updated = await asyncio.to_thread(db.get_superagent_connection, connection_id)
    return SuperagentConnection(
        id=updated["id"],
        github_repo_full_name=updated["github_repo_full_name"],
        github_repo_url=updated["github_repo_url"],
        instructions=updated["instructions"],
        status=updated["status"],
        created_at=updated["created_at"],
        slack_channel_id=updated.get("slack_channel_id"),
        slack_channel_name=updated.get("slack_channel_name"),
    )


@app.delete(
    "/superagent/connections/{connection_id}/slack-channel",
    dependencies=[Depends(rate_limit("superagent-slack-unlink", 15, 60))],
)
async def unlink_superagent_slack_channel(
    connection_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, bool]:
    row = await asyncio.to_thread(db.get_superagent_connection, connection_id)
    if row is None or row.get("user_id") != user_id:
        raise HTTPException(404, "Connection not found")
    await asyncio.to_thread(db.unlink_slack_channel, connection_id)
    return {"ok": True}


@app.post(
    "/webhooks/slack/events",
    dependencies=[Depends(rate_limit("superagent-slack-webhook", 240, 60))],
)
async def superagent_slack_webhook(request: Request) -> dict:
    """Real inbound Slack Events API delivery. Two things Slack requires
    exactly: (1) answering the one-time `url_verification` challenge when
    the Request URL is first saved in the Slack App dashboard, and (2) a
    fast 200 — real processing happens in the worker via the queue, not
    inline here, same as the GitHub webhook above."""
    raw = await request.body()

    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Invalid JSON payload")

    if payload.get("type") == "url_verification":
        # Slack requires this exact echo, unsigned — the request has no
        # signing secret set up yet at the moment this fires.
        return {"challenge": payload.get("challenge", "")}

    signature = request.headers.get("x-slack-signature")
    timestamp = request.headers.get("x-slack-request-timestamp")
    if not verify_slack_signature(timestamp, raw, signature):
        raise HTTPException(401, "Invalid signature")

    # A retried delivery (Slack didn't see our 200 in time) — real work was
    # already enqueued on the first attempt; never double-run the agent.
    if request.headers.get("x-slack-retry-num"):
        return {"ok": True}

    if payload.get("type") != "event_callback":
        return {"ok": True}
    event = payload.get("event") or {}
    if event.get("type") != "app_mention" or event.get("bot_id"):
        return {"ok": True}

    channel = event.get("channel")
    if not channel:
        return {"ok": True}
    connection = await asyncio.to_thread(
        db.get_superagent_connection_by_slack_channel, channel
    )
    if connection is None:
        return {"ok": True}

    slack_conn = await asyncio.to_thread(db.get_slack_connection, connection["user_id"])
    if slack_conn is None:
        return {"ok": True}

    mention_text = strip_bot_mention(event.get("text", ""), slack_conn["bot_user_id"])
    if not mention_text:
        return {"ok": True}

    slack_event = await asyncio.to_thread(
        db.create_superagent_event, connection["id"], connection["user_id"], "slack_mention", None
    )
    enqueue(
        SUPERAGENT_QUEUE,
        {
            "connection_id": connection["id"],
            "event_id": slack_event["id"],
            "event_type": "slack_mention",
            "issue_number": None,
            "issue_title": "",
            "issue_body": "",
            "mention_text": mention_text,
            "slack_bot_token": slack_conn["bot_token"],
            "slack_channel": channel,
            "slack_thread_ts": event.get("thread_ts") or event.get("ts"),
        },
    )
    return {"ok": True}


# --------------------------------------------------------------------------
# Runtime errors — autonomous production self-healing. Every generated app
# ships a client error reporter (a required file, like the badge) that writes
# real runtime errors into a `_meero_runtime_errors` table on the USER'S OWN
# Supabase. These endpoints read those errors back via the Management API so
# the builder can surface real production failures, and /fix triggers a REAL
# autonomous fix (a genuine codegen call fed the real error, a real build,
# shipped as a reviewable PR — see maybe_open_runtime_fix_pr).
# --------------------------------------------------------------------------


class RuntimeError_(BaseModel):
    id: str
    message: str
    stack: str | None = None
    path: str | None = None
    created_at: str | None = None


class RuntimeErrorsResponse(BaseModel):
    errors: list[RuntimeError_]
    # True while an autonomous fix (app/runtime_monitor.py) is queued,
    # running, or being verified for this project — the panel uses this to
    # avoid firing a redundant competing manual fix.
    autonomous_fix_in_progress: bool = False


@app.get(
    "/projects/{project_id}/runtime-errors",
    response_model=RuntimeErrorsResponse,
    dependencies=[Depends(rate_limit("runtime-errors", 30, 60))],
)
async def list_runtime_errors(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> RuntimeErrorsResponse:
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None or project.get("owner_id") != user_id:
        raise HTTPException(404, "Project not found")
    ref = project.get("supabase_project_ref")
    if not ref:
        # No linked Supabase yet — nothing could have reported an error.
        return RuntimeErrorsResponse(errors=[])
    in_progress = await asyncio.to_thread(db.has_in_flight_autonomous_fix, project_id)
    try:
        access_token = await asyncio.to_thread(fresh_access_token, user_id)
        rows = await asyncio.to_thread(fetch_runtime_errors, access_token, ref)
    except SupabaseConnectError:
        # Reading telemetry must never hard-fail the builder.
        return RuntimeErrorsResponse(errors=[], autonomous_fix_in_progress=in_progress)
    return RuntimeErrorsResponse(
        errors=[
            RuntimeError_(
                id=str(r.get("id")),
                message=str(r.get("message") or ""),
                stack=r.get("stack"),
                path=r.get("path"),
                created_at=str(r.get("created_at")) if r.get("created_at") else None,
            )
            for r in rows
        ],
        autonomous_fix_in_progress=in_progress,
    )


class ResolveRuntimeErrorsRequest(BaseModel):
    error_ids: list[str]


@app.post(
    "/projects/{project_id}/runtime-errors/resolve",
    dependencies=[Depends(rate_limit("runtime-errors-resolve", 30, 60))],
)
async def resolve_runtime_errors(
    project_id: str,
    body: ResolveRuntimeErrorsRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> dict[str, bool]:
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None or project.get("owner_id") != user_id:
        raise HTTPException(404, "Project not found")
    ref = project.get("supabase_project_ref")
    if ref and body.error_ids:
        try:
            access_token = await asyncio.to_thread(fresh_access_token, user_id)
            await asyncio.to_thread(
                mark_runtime_errors_resolved, access_token, ref, body.error_ids
            )
        except SupabaseConnectError:
            pass
    return {"ok": True}


class FixRuntimeErrorRequest(BaseModel):
    message: str
    stack: str | None = None
    path: str | None = None
    error_id: str | None = None


class FixRuntimeErrorResponse(BaseModel):
    build: dict


def _runtime_fix_prompt(body: "FixRuntimeErrorRequest") -> str:
    text = "A real runtime error was captured from this app's live production traffic"
    if body.path:
        text += f", on the {body.path} page"
    text += f":\n\n{body.message[:2000]}"
    if body.stack:
        text += f"\n\n{body.stack[:4000]}"
    text += "\n\nFind the root cause and fix it."
    return text


@app.post(
    "/projects/{project_id}/runtime-errors/fix",
    response_model=FixRuntimeErrorResponse,
    dependencies=[Depends(rate_limit("runtime-errors-fix", 10, 60))],
)
async def fix_runtime_error(
    project_id: str,
    body: FixRuntimeErrorRequest,
    user_id: Annotated[str, Depends(current_user_id)],
) -> FixRuntimeErrorResponse:
    """Triggers a REAL autonomous fix for a captured production runtime
    error: a genuine codegen call fed the real error (see codegen_worker.py's
    fix_of path, reused as-is), then a real build. On success the result
    ships as a reviewable GitHub PR, not a direct commit to main (see
    maybe_open_runtime_fix_pr) — this is a speculative reaction to a live
    error report, unlike a normal build which already passed a real compile.
    """
    if not body.message.strip():
        raise HTTPException(422, "error message is required")

    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None or project.get("owner_id") != user_id:
        raise HTTPException(404, "Project not found")
    if not project.get("supabase_project_ref"):
        raise HTTPException(422, "Link Supabase before requesting a fix.")

    latest_build = await asyncio.to_thread(db.get_latest_succeeded_build, project_id)
    if latest_build is None:
        raise HTTPException(422, "No successful build to fix yet.")

    credit = await asyncio.to_thread(db.credits_available, user_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    fix_build = await asyncio.to_thread(
        db.create_runtime_fix_build, latest_build, _runtime_fix_prompt(body)
    )
    enqueue(CODEGEN_QUEUE, {"build_id": fix_build["id"], "fix_of": latest_build["id"]})
    await asyncio.to_thread(db.charge_credits, user_id, WEB_BUILD_COST)

    # Best-effort: this error is being actively fixed now, so stop it from
    # resurfacing while the fix is in flight — mirrors the builder's own
    # optimistic dismiss-on-fix UX.
    if body.error_id:
        try:
            access_token = await asyncio.to_thread(fresh_access_token, user_id)
            await asyncio.to_thread(
                mark_runtime_errors_resolved,
                access_token,
                project["supabase_project_ref"],
                [body.error_id],
            )
        except SupabaseConnectError:
            pass

    return FixRuntimeErrorResponse(build=fix_build)


# --------------------------------------------------------------------------
# Readiness checklist — plain-English "is my app ready?" for non-technical
# owners. Real checks (genuine signup, login, anon-read isolation) run by
# the web worker against the live app right after each successful build —
# see app/readiness_check.py. This just reads back what was actually found.
# --------------------------------------------------------------------------


class ReadinessCheck(BaseModel):
    key: str
    label: str
    passed: bool | None
    detail: str | None = None


class ReadinessResponse(BaseModel):
    build_id: str | None
    checks: list[ReadinessCheck]


@app.get(
    "/projects/{project_id}/readiness",
    response_model=ReadinessResponse,
    dependencies=[Depends(rate_limit("readiness", 30, 60))],
)
async def get_readiness(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> ReadinessResponse:
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None or project.get("owner_id") != user_id:
        raise HTTPException(404, "Project not found")
    latest_build = await asyncio.to_thread(db.get_latest_succeeded_build, project_id)
    if latest_build is None or not latest_build.get("readiness_checks"):
        return ReadinessResponse(build_id=None, checks=[])
    return ReadinessResponse(
        build_id=latest_build["id"],
        checks=[ReadinessCheck(**c) for c in latest_build["readiness_checks"]],
    )


# --------------------------------------------------------------------------
# Stats tab — raw visitor analytics, aggregated server-side from the
# required behavior tracker's real events. Unconditional, unlike the
# conversion agent's own tab below: the tracker records for EVERY generated
# app regardless of projects.conversion_agent_enabled, so this reads back
# for every Supabase-linked project the same way, gated only on real access
# to the project (owner-OR-collaborator), never on that toggle.
# --------------------------------------------------------------------------


class StatsSection(BaseModel):
    """A generic {label, count, ...extra} row — every section below
    (sessions_by_day, views_by_page, device_breakdown, ...) shares this
    shape so the frontend has one rendering path, with `extra` carrying
    whatever section-specific fields don't fit the common two."""

    label: str
    count: int
    extra: str | None = None


class StatsResponse(BaseModel):
    total_sessions: int
    sessions_by_day: list[StatsSection] = []
    views_by_page: list[StatsSection] = []
    device_breakdown: list[StatsSection] = []
    scroll_depth_distribution: list[StatsSection] = []
    top_clicked_elements: list[StatsSection] = []
    dead_rage_counts: list[StatsSection] = []
    funnel_steps: list[StatsSection] = []


@app.get(
    "/projects/{project_id}/stats",
    response_model=StatsResponse,
    dependencies=[Depends(rate_limit("conversion-stats", 20, 60))],
)
async def get_project_stats(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> StatsResponse:
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")
    ref = project.get("supabase_project_ref")
    if not ref:
        return StatsResponse(total_sessions=0)

    # All-time, not a rolling window — real activity since the project's own
    # real creation date, so this never "loses" older traffic as time
    # passes. Every dashboard load re-aggregates from that same fixed floor.
    since = str(project["created_at"])
    try:
        access_token = await asyncio.to_thread(fresh_access_token, project["owner_id"])
        stats = await asyncio.to_thread(fetch_behavior_stats, access_token, ref, since)
        total_sessions = await asyncio.to_thread(fetch_session_count, access_token, ref, since)
    except SupabaseConnectError:
        # Reading telemetry must never hard-fail the dashboard.
        return StatsResponse(total_sessions=0)

    return StatsResponse(
        total_sessions=total_sessions,
        sessions_by_day=[
            StatsSection(label=str(r.get("day")), count=int(r.get("n") or 0))
            for r in stats["sessions_by_day"]
        ],
        views_by_page=[
            StatsSection(label=str(r.get("page_path") or "/"), count=int(r.get("n") or 0))
            for r in stats["views_by_page"]
        ],
        device_breakdown=[
            StatsSection(label=str(r.get("device_type") or "unknown"), count=int(r.get("n") or 0))
            for r in stats["device_breakdown"]
        ],
        scroll_depth_distribution=[
            StatsSection(
                label=f"{int(r['scroll_depth'])}%" if r.get("scroll_depth") is not None else "?",
                count=int(r.get("n") or 0),
            )
            for r in stats["scroll_depth_distribution"]
        ],
        top_clicked_elements=[
            StatsSection(
                label=str(r.get("element_selector") or "(unknown)"),
                count=int(r.get("n") or 0),
                extra=str(r.get("page_path") or "/"),
            )
            for r in stats["top_clicked_elements"]
        ],
        dead_rage_counts=[
            StatsSection(
                label=str(r.get("element_selector") or "(unknown)"),
                count=int(r.get("n") or 0),
                extra=f"{r.get('page_path') or '/'} · {r.get('event_type')}",
            )
            for r in stats["dead_rage_counts"]
        ],
        funnel_steps=[
            StatsSection(label=str(r.get("step") or ""), count=int(r.get("n") or 0))
            for r in stats["funnel_steps"]
        ],
    )


# --------------------------------------------------------------------------
# Conversion dashboard — reads real visitor behavior (from the required
# behavior tracker, see components/meero-behavior-tracker.tsx) and the
# conversion agent's own bookkeeping (app/conversion_agent.py). Read-only
# viewing is owner-OR-collaborator (can_access_project), same as the rest of
# the builder — unlike runtime-errors/readiness above which check owner_id
# directly, since those predate collaborators. Toggling the agent itself
# stays owner-only (see setConversionAgentEnabled in src/app/projects/actions.ts).
# --------------------------------------------------------------------------


class PageBreakdownRow(BaseModel):
    page_path: str
    sessions: int
    bounce_rate: float


class ExitPageRow(BaseModel):
    page_path: str
    sessions: int


class DeviceConversionRow(BaseModel):
    device_type: str
    sessions: int
    conversion_rate: float


class ConversionKpisResponse(BaseModel):
    total_sessions: int
    total_page_views: int
    bounce_rate: float
    avg_session_duration_s: float
    pages_per_session: float
    page_breakdown: list[PageBreakdownRow] = []
    exit_pages: list[ExitPageRow] = []
    device_breakdown: list[DeviceConversionRow] = []
    funnel_steps: list[StatsSection] = []


@app.get(
    "/projects/{project_id}/conversion/kpis",
    response_model=ConversionKpisResponse,
    dependencies=[Depends(rate_limit("conversion-kpis", 20, 60))],
)
async def get_conversion_kpis(
    project_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> ConversionKpisResponse:
    """Real, computed-from-real-events KPI dashboard for the Improvements
    tab — bounce rate, average session duration, pages/session, and
    per-page/exit-page/device breakdowns, all derived from the same
    _meero_behavior_events data every other conversion feature reads. No
    new tracked fields required, so this works immediately for every
    already-built app, not just ones rebuilt after this shipped."""
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")

    ref = project.get("supabase_project_ref")
    empty = ConversionKpisResponse(
        total_sessions=0, total_page_views=0, bounce_rate=0.0,
        avg_session_duration_s=0.0, pages_per_session=0.0,
    )
    if not ref:
        return empty

    since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    try:
        access_token = await asyncio.to_thread(fresh_access_token, project["owner_id"])
        kpis = await asyncio.to_thread(fetch_conversion_kpis, access_token, ref, since)
        pages = await asyncio.to_thread(fetch_page_breakdown, access_token, ref, since)
        exits = await asyncio.to_thread(fetch_exit_pages, access_token, ref, since)
        devices = await asyncio.to_thread(fetch_device_conversion, access_token, ref, since)
        stats = await asyncio.to_thread(fetch_behavior_stats, access_token, ref, since)
    except SupabaseConnectError:
        return empty

    total_sessions = kpis["total_sessions"]
    return ConversionKpisResponse(
        total_sessions=total_sessions,
        total_page_views=kpis["total_page_views"],
        bounce_rate=(kpis["bounced_sessions"] / total_sessions) if total_sessions else 0.0,
        avg_session_duration_s=kpis["avg_duration_s"],
        pages_per_session=(kpis["total_page_views"] / total_sessions) if total_sessions else 0.0,
        page_breakdown=[
            PageBreakdownRow(
                page_path=str(r.get("page_path") or "/"),
                sessions=int(r.get("sessions") or 0),
                bounce_rate=(
                    int(r.get("bounced") or 0) / int(r["sessions"])
                    if r.get("sessions") else 0.0
                ),
            )
            for r in pages
        ],
        exit_pages=[
            ExitPageRow(page_path=str(r.get("page_path") or "/"), sessions=int(r.get("sessions") or 0))
            for r in exits
        ],
        device_breakdown=[
            DeviceConversionRow(
                device_type=str(r.get("device_type") or "unknown"),
                sessions=int(r.get("sessions") or 0),
                conversion_rate=(
                    int(r.get("converted") or 0) / int(r["sessions"])
                    if r.get("sessions") else 0.0
                ),
            )
            for r in devices
        ],
        funnel_steps=[
            StatsSection(label=str(r.get("step") or ""), count=int(r.get("n") or 0))
            for r in stats["funnel_steps"]
        ],
    )


class BehaviorHeatmapPoint(BaseModel):
    x: float
    y: float
    event_type: str


class BehaviorHeatmapResponse(BaseModel):
    page_path: str
    screenshot_url: str | None = None
    points: list[BehaviorHeatmapPoint] = []
    dead_clicks: list[BehaviorHeatmapPoint] = []


@app.get(
    "/projects/{project_id}/conversion/heatmap",
    response_model=BehaviorHeatmapResponse,
    dependencies=[Depends(rate_limit("conversion-heatmap", 20, 60))],
)
async def get_conversion_heatmap(
    project_id: str,
    page_path: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> BehaviorHeatmapResponse:
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")
    ref = project.get("supabase_project_ref")
    if not ref:
        return BehaviorHeatmapResponse(page_path=page_path)

    since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    try:
        access_token = await asyncio.to_thread(fresh_access_token, project["owner_id"])
        events = await asyncio.to_thread(fetch_behavior_events, access_token, ref, since)
    except SupabaseConnectError:
        # Reading telemetry must never hard-fail the dashboard.
        return BehaviorHeatmapResponse(page_path=page_path)

    page_events = [e for e in events if e.get("page_path") == page_path]
    points = [
        BehaviorHeatmapPoint(x=e["x"], y=e["y"], event_type=e["event_type"])
        for e in page_events
        if e.get("event_type") == "click" and e.get("x") is not None and e.get("y") is not None
    ]
    dead_clicks = [
        BehaviorHeatmapPoint(x=e["x"], y=e["y"], event_type=e["event_type"])
        for e in page_events
        if e.get("event_type") == "dead_click"
        and e.get("x") is not None
        and e.get("y") is not None
    ]

    # Read-only: the API image has no headless browser (see app/screenshot.py
    # and orchestrator/Dockerfile's base vs web-worker stages), so capture
    # happens in the web worker after each successful build. None here just
    # means this page hasn't been shot yet — the heatmap renders its real
    # points with no background rather than inventing one.
    screenshot_url = await asyncio.to_thread(
        stored_page_screenshot_url, project_id, page_path
    )

    return BehaviorHeatmapResponse(
        page_path=page_path,
        screenshot_url=screenshot_url,
        points=points,
        dead_clicks=dead_clicks,
    )


class DeviceSegmentCounts(BaseModel):
    device_type: str
    exposures_a: int
    exposures_b: int
    conversions_a: int
    conversions_b: int


class ExperimentCountsResponse(BaseModel):
    exposures_a: int
    exposures_b: int
    conversions_a: int
    conversions_b: int
    by_device: list[DeviceSegmentCounts] = []


def _pivot_device_counts(rows: list[dict[str, Any]]) -> list[DeviceSegmentCounts]:
    """Turns fetch_experiment_counts_by_device's raw {device_type, variant,
    event_type, n} rows into one row per device — same pivot shape
    fetch_experiment_counts itself does inline in supabase_connect.py, just
    grouped one level deeper (by device first)."""
    by_device: dict[str, dict[str, int]] = {}
    for r in rows:
        device = str(r.get("device_type") or "unknown")
        variant = r.get("variant")
        event_type = r.get("event_type")
        if variant not in ("a", "b"):
            continue
        key = "exposures" if event_type == "experiment_exposure" else "conversions"
        bucket = by_device.setdefault(
            device, {"exposures_a": 0, "exposures_b": 0, "conversions_a": 0, "conversions_b": 0}
        )
        bucket[f"{key}_{variant}"] = int(r.get("n") or 0)
    return [
        DeviceSegmentCounts(device_type=device, **counts)
        for device, counts in sorted(by_device.items())
    ]


@app.get(
    "/projects/{project_id}/conversion/experiments/{experiment_id}/counts",
    response_model=ExperimentCountsResponse,
    dependencies=[Depends(rate_limit("conversion-experiment-counts", 20, 60))],
)
async def get_conversion_experiment_counts(
    project_id: str,
    experiment_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> ExperimentCountsResponse:
    """Live (not just last-evaluation-pass) exposure/conversion counts for
    one running or decided experiment — the results panel polls this
    directly rather than waiting for the next background evaluation pass.
    Also includes a real per-device_type breakdown (mobile vs desktop
    exposures/conversions), so the panel can show whether a fix that's
    winning overall is actually winning on both, one, or neither."""
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")

    experiment = await asyncio.to_thread(db.get_conversion_experiment, experiment_id)
    if experiment is None or experiment.get("project_id") != project_id:
        raise HTTPException(404, "Experiment not found")

    ref = project.get("supabase_project_ref")
    if not ref:
        return ExperimentCountsResponse(
            exposures_a=0, exposures_b=0, conversions_a=0, conversions_b=0
        )

    try:
        access_token = await asyncio.to_thread(fresh_access_token, project["owner_id"])
        counts = await asyncio.to_thread(
            fetch_experiment_counts,
            access_token,
            ref,
            experiment["experiment_key"],
            experiment["started_at"],
        )
        device_rows = await asyncio.to_thread(
            fetch_experiment_counts_by_device,
            access_token,
            ref,
            experiment["experiment_key"],
            experiment["started_at"],
        )
    except SupabaseConnectError:
        return ExperimentCountsResponse(
            exposures_a=0, exposures_b=0, conversions_a=0, conversions_b=0
        )

    return ExperimentCountsResponse(**counts, by_device=_pivot_device_counts(device_rows))


class LaunchExperimentResponse(BaseModel):
    build: dict


@app.post(
    "/projects/{project_id}/conversion/hypotheses/{hypothesis_id}/launch",
    response_model=LaunchExperimentResponse,
    dependencies=[Depends(rate_limit("conversion-launch", 10, 60))],
)
async def launch_conversion_experiment(
    project_id: str,
    hypothesis_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> LaunchExperimentResponse:
    """Manual-mode counterpart to conversion_agent._maybe_launch_experiment's
    autonomous firing — same gated steps, just triggered by a click instead
    of the poll loop (mirrors approve_build's real-build-either-way shape).
    Solo-mode projects don't need this (the agent launches on its own), but
    calling it there is harmless — it just does the launch immediately
    instead of waiting for the next poll."""
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")
    if not project.get("conversion_agent_enabled"):
        raise HTTPException(422, "Turn on the Conversion agent for this project first.")

    hypothesis = await asyncio.to_thread(db.get_conversion_hypothesis, hypothesis_id)
    if hypothesis is None or hypothesis.get("project_id") != project_id:
        raise HTTPException(404, "Hypothesis not found")
    if hypothesis.get("status") != "open":
        raise HTTPException(409, "This hypothesis isn't open for a new experiment.")

    if not project.get("supabase_project_ref"):
        raise HTTPException(422, "Link Supabase before launching an experiment.")
    if await asyncio.to_thread(db.has_in_flight_conversion_experiment, project_id):
        raise HTTPException(
            409, "An experiment is already running for this project — only one at a time."
        )

    owner_id = project["owner_id"]
    credit = await asyncio.to_thread(db.credits_available, owner_id)
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    latest_build = await asyncio.to_thread(db.get_latest_succeeded_build, project_id)
    if latest_build is None:
        raise HTTPException(422, "No successful build to run an experiment on yet.")

    experiment_key = conversion_agent._experiment_key_for(hypothesis["id"])
    goal_event = conversion_agent._goal_event_for(hypothesis)
    prompt_text = conversion_agent._experiment_codegen_prompt(
        hypothesis, experiment_key, goal_event
    )
    experiment = await asyncio.to_thread(
        db.create_conversion_experiment,
        project_id=project_id,
        hypothesis_id=hypothesis["id"],
        experiment_key=experiment_key,
        goal_event=goal_event,
    )
    build = await asyncio.to_thread(
        db.create_conversion_experiment_build,
        experiment=experiment,
        base_build=latest_build,
        action="launch",
        prompt_text=prompt_text,
    )
    await asyncio.to_thread(db.set_conversion_hypothesis_status, hypothesis["id"], "experimenting")
    enqueue(CODEGEN_QUEUE, {"build_id": build["id"], "fix_of": latest_build["id"]})
    await asyncio.to_thread(db.charge_credits, owner_id, CONVERSION_EXPERIMENT_COST)

    return LaunchExperimentResponse(build=build)


class ApplyExperimentDecisionResponse(BaseModel):
    ok: bool


@app.post(
    "/projects/{project_id}/conversion/experiments/{experiment_id}/apply-decision",
    response_model=ApplyExperimentDecisionResponse,
    dependencies=[Depends(rate_limit("conversion-apply-decision", 10, 60))],
)
async def apply_conversion_experiment_decision(
    project_id: str,
    experiment_id: str,
    user_id: Annotated[str, Depends(current_user_id)],
) -> ApplyExperimentDecisionResponse:
    """Manual-mode counterpart to conversion_agent._evaluate_running_experiments'
    autonomous graduate/revert — a decided-but-not-yet-applied experiment
    (winner_a/winner_b/inconclusive) waits here for an explicit click before
    the follow-up build actually queues."""
    project = await asyncio.to_thread(db.get_project, project_id)
    if project is None:
        raise HTTPException(404, "Project not found")
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        raise HTTPException(404, "Project not found")

    experiment = await asyncio.to_thread(db.get_conversion_experiment, experiment_id)
    if experiment is None or experiment.get("project_id") != project_id:
        raise HTTPException(404, "Experiment not found")
    if experiment.get("status") not in ("winner_a", "winner_b", "inconclusive"):
        raise HTTPException(409, "This experiment has no decision waiting to be applied.")
    if experiment.get("graduation_build_id"):
        # Already applied — a decided experiment's status is terminal
        # (graduate/revert never changes it further), so without this check
        # a double-click or a race between two tabs would queue a second
        # graduation/revert build for the same experiment.
        raise HTTPException(409, "This decision has already been applied.")

    credit = await asyncio.to_thread(db.credits_available, project["owner_id"])
    if not credit["allowed"]:
        raise HTTPException(402, _credit_denied_message(credit))

    await asyncio.to_thread(
        conversion_agent.apply_experiment_decision, project, experiment
    )
    return ApplyExperimentDecisionResponse(ok=True)


# --------------------------------------------------------------------------
# Live status stream
# --------------------------------------------------------------------------


@app.websocket("/ws/projects/{project_id}")
async def project_events(websocket: WebSocket, project_id: str) -> None:
    ip = websocket.client.host if websocket.client else "unknown"
    try:
        await asyncio.to_thread(check_for_key, "ws-connect", f"ip:{ip}", 30, 60)
    except HTTPException:
        await websocket.close(code=4429)
        return

    token = websocket.query_params.get("token", "")
    user_id = await asyncio.to_thread(db.get_user_id_from_token, token)
    if user_id is None:
        await websocket.close(code=4401)
        return
    can_access = await asyncio.to_thread(db.can_access_project, project_id, user_id)
    if not can_access:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    client = aioredis.from_url(get_settings().redis_url, decode_responses=True)
    pubsub = client.pubsub()
    await pubsub.subscribe(EVENTS_CHANNEL)
    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
            event = json.loads(message["data"])
            if event.get("project_id") == project_id:
                await websocket.send_json(event)
    except Exception:
        pass
    finally:
        await pubsub.unsubscribe(EVENTS_CHANNEL)
        await client.aclose()


# --------------------------------------------------------------------------
# Health
# --------------------------------------------------------------------------


@app.get("/health")
async def health() -> dict:
    try:
        ok = await asyncio.to_thread(get_redis().ping)
    except Exception:
        ok = False
    return {"status": "ok" if ok else "degraded", "redis": ok}

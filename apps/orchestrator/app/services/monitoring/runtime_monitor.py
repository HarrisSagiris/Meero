"""Meero's 24/7 monitoring agent — autonomously detects and fixes captured
production runtime errors, no human click required. This is what actually
differentiates Meero from every other AI app builder: they stop the moment
an app ships, Meero keeps watching it.

This module only adds the DECISION of *when* to fire, on a timer instead of
a click (`poll_runtime_errors`, run in-process from app/main.py exactly like
the existing email poller), plus the verify-then-trust safety net once the
fix build finishes (`evaluate_and_publish`/`mark_build_failed`, called from
app/workers/web_worker.py). The actual fix mechanics are identical to the
existing manual flow — same db.create_runtime_fix_build, same CODEGEN_QUEUE
job shape, same codegen_worker.py fix_of path — nothing about how a fix is
generated changes, only who decides to ask for one and whether the result
is trusted afterward.
"""

import logging
from typing import Any

from app.infrastructure.database import db
from app.config import WEB_BUILD_COST, get_settings
from app.infrastructure.queues.queues import CODEGEN_QUEUE, enqueue, publish_event
from app.infrastructure.supabase.supabase_connect import (
    SupabaseConnectError,
    fetch_runtime_errors,
    fresh_access_token,
    mark_runtime_errors_resolved,
)

log = logging.getLogger("meero.runtime_monitor")


def _dedupe_and_cap(errors: list[dict[str, Any]], cap: int) -> list[dict[str, Any]]:
    """Collapses repeat occurrences of the same error (grouped by
    message+path) down to one, keeping the first — errors arrive newest
    first from fetch_runtime_errors, so that's the most recent occurrence —
    then caps the result so one firing's prompt (and the diff the LLM has
    to reason about) stays bounded even if a bug is spamming errors."""
    seen: set[tuple[str, str | None]] = set()
    deduped: list[dict[str, Any]] = []
    for e in errors:
        key = (e.get("message") or "", e.get("path"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(e)
    return deduped[:cap]


def _batch_runtime_fix_prompt(errors: list[dict[str, Any]]) -> str:
    """One composite prompt covering every batched error — a real fix build
    per firing that addresses everything currently open, not one build per
    error racing every other. Mirrors main.py's _runtime_fix_prompt's
    wording for a single error."""
    if len(errors) == 1:
        e = errors[0]
        text = "A real runtime error was captured from this app's live production traffic"
        if e.get("path"):
            text += f", on the {e['path']} page"
        text += f":\n\n{(e.get('message') or '')[:2000]}"
        if e.get("stack"):
            text += f"\n\n{e['stack'][:4000]}"
        text += "\n\nFind the root cause and fix it."
        return text

    parts = [
        f"{len(errors)} real runtime errors were captured from this app's "
        "live production traffic:"
    ]
    for i, e in enumerate(errors, start=1):
        entry = f"\n\n{i}. "
        if e.get("path"):
            entry += f"On the {e['path']} page: "
        entry += (e.get("message") or "")[:2000]
        if e.get("stack"):
            entry += f"\n{e['stack'][:2000]}"
        parts.append(entry)
    parts.append("\n\nFind the root cause(s) and fix them.")
    return "".join(parts)


def _maybe_fix_project(project_row: dict[str, Any]) -> None:
    """Real gating chain for one Supabase-linked project — short-circuits on
    the first reason not to act. Autonomy mode, credits, and the anti-thrash
    checks all have to say yes before a real fix build gets queued."""
    project_id = project_row["id"]
    project = db.get_project(project_id)
    if project is None:
        return
    if project.get("autonomy_mode") == "manual":
        # Detection still works (GET /runtime-errors, the "Watching" badge) —
        # only auto-FIRING a fix is gated. The existing manual "Fix with
        # Meero" button stays the way a Manual-mode owner acts on it.
        return

    latest_build = db.get_latest_succeeded_build(project_id)
    if latest_build is None:
        return  # nothing to fix against yet

    if db.has_in_flight_autonomous_fix(project_id):
        return  # an autonomous fix is already queued/running/being verified

    settings = get_settings()
    if db.count_recent_autonomous_fixes(project_id) >= settings.runtime_monitor_max_fixes_per_project_per_hour:
        log.info("runtime monitor: project %s hit its hourly autonomous-fix cap", project_id)
        return

    try:
        access_token = fresh_access_token(project["owner_id"])
    except Exception as exc:  # noqa: BLE001 — one project's token issue must never kill the pass
        log.warning(
            "runtime monitor: could not refresh token for project %s: %s",
            project_id,
            exc,
        )
        return

    errors = fetch_runtime_errors(access_token, project["supabase_project_ref"])
    if not errors:
        return

    credit = db.credits_available(project["owner_id"])
    if not credit["allowed"]:
        return  # no autonomous fix fires on a project with no credits left

    batch = _dedupe_and_cap(errors, settings.runtime_monitor_max_errors_per_batch)
    prompt = _batch_runtime_fix_prompt(batch)
    error_ids = [str(e["id"]) for e in batch]

    fix_build = db.create_runtime_fix_build(
        latest_build, prompt, autonomous=True, error_ids=error_ids
    )
    enqueue(CODEGEN_QUEUE, {"build_id": fix_build["id"], "fix_of": latest_build["id"]})
    db.charge_credits(project["owner_id"], WEB_BUILD_COST)

    publish_event(
        {
            "type": "runtime_monitor.detected",
            "project_id": project_id,
            "build_id": fix_build["id"],
            "error_count": len(batch),
            "sample_message": batch[0].get("message") or "",
        }
    )
    # Deliberately NOT marking these errors resolved here — resolution is
    # deferred to evaluate_and_publish() below, only once the fix build's
    # own readiness checks genuinely pass. The manual "Fix with Meero" flow
    # resolves optimistically at fire-time; an unattended autonomous fix
    # with no human watching gets held to a stricter bar.


def poll_runtime_errors() -> None:
    """One real pass: every Supabase-linked project, every genuinely
    unresolved _meero_runtime_errors row, batched into (at most) one
    autonomous fix build per project. Mirrors app/main.py's
    _poll_pending_emails shape exactly — sync, run via asyncio.to_thread
    from the poller loop, one project's failure never kills the pass."""
    for project_row in db.list_supabase_linked_projects():
        try:
            _maybe_fix_project(project_row)
        except Exception:  # noqa: BLE001 — the pass must survive one bad project
            log.exception(
                "runtime monitor: pass failed for project %s", project_row.get("id")
            )


def evaluate_and_publish(
    project: dict[str, Any],
    build_id: str,
    build_row: dict[str, Any],
    checks: list[dict[str, Any]] | None,
    access_token: str,
    supabase_ref: str,
) -> None:
    """The verify-then-trust safety net — called from web_worker.py right
    after an autonomous fix build's own readiness checks run. A check result
    is a real tri-state (readiness_check.py: True/False/None-not-applicable);
    `passed` requires every check to be True or None — never a fabricated
    pass, and `checks is None` (the readiness-check pass itself crashed)
    counts as NOT passed, since an unverified fix must never be silently
    trusted. Only on a genuine pass are the original errors marked resolved —
    on failure, resolution simply never happens; the error(s) resurface
    exactly as before in the runtime-errors panel."""
    passed = checks is not None and all(c.get("passed") is not False for c in checks)

    if passed:
        error_ids = build_row.get("runtime_error_ids") or []
        if error_ids:
            try:
                mark_runtime_errors_resolved(access_token, supabase_ref, error_ids)
            except SupabaseConnectError:
                log.warning(
                    "runtime monitor: fix for build %s verified, but marking "
                    "errors resolved failed (best-effort)",
                    build_id,
                )
        db.set_runtime_fix_verified(build_id, True)
        publish_event(
            {
                "type": "runtime_monitor.verified",
                "project_id": project["id"],
                "build_id": build_id,
                "passed": True,
                "resolved_error_count": len(error_ids),
            }
        )
        return

    db.set_runtime_fix_verified(build_id, False)
    failed_checks = [
        {"key": c.get("key"), "label": c.get("label"), "detail": c.get("detail")}
        for c in (checks or [])
        if c.get("passed") is False
    ]
    publish_event(
        {
            "type": "runtime_monitor.regression",
            "project_id": project["id"],
            "build_id": build_id,
            "passed": False,
            "failed_checks": failed_checks,
            "detail": None if checks is not None else "Readiness checks failed to run.",
        }
    )


def mark_build_failed(project_id: str, build_id: str) -> None:
    """The autonomous fix never even reached readiness checks — it failed to
    compile, or the schema failed to apply. Same regression event shape as
    evaluate_and_publish's failure path, so the frontend has ONE narration
    for "this didn't work" regardless of which stage it failed at."""
    db.set_runtime_fix_verified(build_id, False)
    publish_event(
        {
            "type": "runtime_monitor.regression",
            "project_id": project_id,
            "build_id": build_id,
            "passed": False,
            "failed_checks": [],
            "detail": "The autonomous fix failed to build — the original error is still open.",
        }
    )

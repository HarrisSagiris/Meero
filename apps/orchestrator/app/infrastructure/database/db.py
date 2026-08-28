"""Supabase access for trusted orchestrator processes (service role)."""

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

from app.config import get_settings
from app.infrastructure.queues.queues import publish_event
from supabase import Client, create_client


@lru_cache
def get_supabase() -> Client:
    s = get_settings()
    return create_client(s.supabase_url, s.supabase_service_role_key)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_build(build_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("builds")
        .select("*")
        .eq("id", build_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def get_spec(spec_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("specs")
        .select("*")
        .eq("id", spec_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def get_latest_spec(project_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("specs")
        .select("*")
        .eq("project_id", project_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def get_profile(user_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("profiles")
        .select("*")
        .eq("id", user_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def get_profile_by_stripe_customer(customer_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("profiles")
        .select("*")
        .eq("stripe_customer_id", customer_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def consume_credits(user_id: str, amount: int = 1) -> dict[str, Any]:
    """Atomically spend `amount` credits (rolling the daily allowance over
    first if it has expired). Returns {allowed, remaining, plan, reset_at}.
    """
    res = (
        get_supabase()
        .rpc("consume_credits", {"p_user_id": user_id, "p_amount": amount})
        .execute()
    )
    if res.data:
        return res.data[0]
    return {"allowed": False, "remaining": 0, "plan": "free", "reset_at": None}


def credits_available(user_id: str) -> dict[str, Any]:
    """Pre-gate for metered billing: rolls the daily allowance over if expired,
    then reports whether the user has ANY balance left (daily + bonus) WITHOUT
    deducting. The real cost is charged afterwards via charge_credits(). See
    credits_available() in 00010_token_billing.sql. Returns
    {allowed, remaining, plan, reset_at}.
    """
    res = get_supabase().rpc("credits_available", {"p_user_id": user_id}).execute()
    if res.data:
        return res.data[0]
    return {"allowed": False, "remaining": 0, "plan": "free", "reset_at": None}


def charge_credits(user_id: str, amount: int) -> dict[str, Any]:
    """Post-hoc deduct: unconditionally subtracts `amount` (daily allowance
    first, then bonus, each floored at 0 — never negative). Always succeeds;
    the caller has already spent the tokens/compute. See charge_credits() in
    00010_token_billing.sql. Returns {remaining, plan, reset_at}.
    """
    res = (
        get_supabase()
        .rpc("charge_credits", {"p_user_id": user_id, "p_amount": max(0, int(amount))})
        .execute()
    )
    if res.data:
        return res.data[0]
    return {"remaining": 0, "plan": "free", "reset_at": None}


def refund_credits(user_id: str, amount: int) -> dict[str, Any]:
    """Real, full refund for a genuinely canceled build (POST
    /builds/{id}/cancel) — the flat WEB_BUILD_COST charged at start, given
    back because a stopped build produced nothing. Mirrors charge_credits()
    but adds `amount` back instead of subtracting: fills the weekly pool up
    to the plan's cap first, then any overflow lands in bonus_credits. See
    refund_credits() in 00018_refund_credits.sql. Returns
    {remaining, plan, reset_at}.
    """
    res = (
        get_supabase()
        .rpc("refund_credits", {"p_user_id": user_id, "p_amount": max(0, int(amount))})
        .execute()
    )
    if res.data:
        return res.data[0]
    return {"remaining": 0, "plan": "free", "reset_at": None}


def add_bonus_credits(user_id: str, amount: int) -> None:
    """Adds real, non-expiring credits after a real Stripe payment — never
    wiped by the daily allowance rollover. See consume_credits() in
    00009_credit_topups.sql."""
    get_supabase().rpc(
        "add_bonus_credits", {"p_user_id": user_id, "p_amount": amount}
    ).execute()


def set_stripe_customer(user_id: str, customer_id: str) -> None:
    get_supabase().table("profiles").update({"stripe_customer_id": customer_id}).eq(
        "id", user_id
    ).execute()


def apply_subscription(
    customer_id: str,
    plan: str,
    subscription_id: str | None,
    status: str | None,
) -> None:
    """Called from the Stripe webhook to sync a profile's plan/subscription.

    Downgrading (plan='free') does not touch credits_remaining/reset_at —
    the user simply gets the free daily limit from their next reset.
    """
    get_supabase().table("profiles").update(
        {
            "plan": plan,
            "stripe_subscription_id": subscription_id,
            "stripe_subscription_status": status,
        }
    ).eq("stripe_customer_id", customer_id).execute()


def get_project(project_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("projects")
        .select("*")
        .eq("id", project_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def list_supabase_linked_projects() -> list[dict[str, Any]]:
    """Every project with a real linked Supabase backend — what the
    in-process email poller (app/main.py's _start_email_poller) scans each
    pass for real pending `_meero_emails` rows."""
    res = (
        get_supabase()
        .table("projects")
        .select("id, owner_id, supabase_project_ref")
        .not_.is_("supabase_project_ref", "null")
        .execute()
    )
    return res.data or []


def get_latest_succeeded_build(project_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("builds")
        .select("*")
        .eq("project_id", project_id)
        .eq("status", "succeeded")
        .order("finished_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def list_messages(project_id: str, limit: int = 20) -> list[dict[str, Any]]:
    res = (
        get_supabase()
        .table("messages")
        .select("role, content, created_at")
        .eq("project_id", project_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(res.data or []))


def add_message(
    project_id: str,
    role: str,
    content: str,
    spec_version: int | None = None,
) -> None:
    get_supabase().table("messages").insert(
        {
            "project_id": project_id,
            "role": role,
            "content": content,
            "spec_version": spec_version,
        }
    ).execute()


def create_spec(
    project_id: str,
    prompt: str,
    created_by: str,
    attachments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Insert the next spec version (retry once on a version race)."""
    client = get_supabase()
    last_error: Exception | None = None
    for _ in range(2):
        latest = get_latest_spec(project_id)
        next_version = (latest["version"] + 1) if latest else 1
        try:
            res = (
                client.table("specs")
                .insert(
                    {
                        "project_id": project_id,
                        "version": next_version,
                        "prompt": prompt,
                        "created_by": created_by,
                        "attachments": attachments or [],
                    }
                )
                .execute()
            )
            return res.data[0]
        except Exception as exc:  # unique violation on concurrent insert
            last_error = exc
    raise RuntimeError(f"Could not create spec: {last_error}")


def is_project_owner(project_id: str, user_id: str) -> bool:
    res = (
        get_supabase()
        .table("projects")
        .select("id")
        .eq("id", project_id)
        .eq("owner_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def is_project_collaborator(project_id: str, user_id: str) -> bool:
    res = (
        get_supabase()
        .table("project_collaborators")
        .select("id")
        .eq("project_id", project_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def can_access_project(project_id: str, user_id: str) -> bool:
    """Owner OR an invited collaborator (00027_collaborators.sql) — the gate
    for real working actions (chat, build/fix/cancel/retry). Account-level
    actions (Supabase/GitHub OAuth, deploy, domains, collaborator management
    itself) stay on is_project_owner directly — never widen those here."""
    return is_project_owner(project_id, user_id) or is_project_collaborator(
        project_id, user_id
    )


def list_collaborators(project_id: str) -> list[dict[str, Any]]:
    res = (
        get_supabase()
        .table("project_collaborators")
        .select("id, user_id, invited_by, created_at")
        .eq("project_id", project_id)
        .order("created_at", desc=False)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return rows
    user_ids = list({row["user_id"] for row in rows})
    profiles_res = (
        get_supabase()
        .table("profiles")
        .select("id, email, display_name, avatar_url")
        .in_("id", user_ids)
        .execute()
    )
    profiles_by_id = {p["id"]: p for p in (profiles_res.data or [])}
    for row in rows:
        row["profile"] = profiles_by_id.get(row["user_id"])
    return rows


def find_user_by_email(email: str) -> dict[str, Any] | None:
    """Service-role lookup — a regular user's browser can't query other
    users' profiles by email under RLS, so invite-by-email has to resolve
    through here."""
    res = (
        get_supabase()
        .table("profiles")
        .select("id, email, display_name, avatar_url")
        .ilike("email", email)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def add_collaborator(project_id: str, user_id: str, invited_by: str) -> dict[str, Any]:
    res = (
        get_supabase()
        .table("project_collaborators")
        .insert(
            {"project_id": project_id, "user_id": user_id, "invited_by": invited_by}
        )
        .execute()
    )
    return res.data[0]


def remove_collaborator(project_id: str, user_id: str) -> None:
    get_supabase().table("project_collaborators").delete().eq(
        "project_id", project_id
    ).eq("user_id", user_id).execute()


def set_pending_build(project_id: str, spec_id: str | None) -> None:
    """Parks (or clears) the spec a Manual-mode project's chat agent wants
    to build but is waiting on real user approval for — see apply_node in
    app/agent/graph.py and POST /projects/{id}/approve-build."""
    get_supabase().table("projects").update({"pending_build_spec_id": spec_id}).eq(
        "id", project_id
    ).execute()


def create_build(project_id: str, spec_id: str, platform: str) -> dict[str, Any]:
    res = (
        get_supabase()
        .table("builds")
        .insert({"project_id": project_id, "spec_id": spec_id, "platform": platform})
        .execute()
    )
    build = res.data[0]
    publish_event(
        {
            "type": "build.status",
            "project_id": project_id,
            "build_id": build["id"],
            "platform": platform,
            "status": "queued",
        }
    )
    return build


def create_project_from_clone(
    owner_id: str, name: str, description: str | None, clone_of: str
) -> dict[str, Any]:
    """Creates the new project a marketplace clone lands in. Service-role
    insert (like every other orchestrator-initiated write) — the
    `projects_enforce_free_public` trigger still applies normally, so a
    free-plan cloner's copy is forced public same as any other project of
    theirs."""
    res = (
        get_supabase()
        .table("projects")
        .insert(
            {
                "owner_id": owner_id,
                "name": name,
                "description": description,
                "clone_of": clone_of,
            }
        )
        .execute()
    )
    return res.data[0]


def set_build_status(
    build_id: str,
    status: str,
    *,
    error: str | None = None,
    worker_id: str | None = None,
) -> None:
    """Update a build row and broadcast the change to WebSocket clients.

    "canceled" is a STICKY terminal state: whenever `status` is anything
    else, the update also requires the row not already be canceled. Without
    this, a worker that was mid-build when the user hit Stop — but didn't
    notice the real cancel signal in time — could finish normally and
    silently resurrect a build the user already stopped back into
    "succeeded"/"failed"/"running". The cancel endpoint's own write
    (status="canceled") is unconditional.
    """
    fields: dict[str, Any] = {"status": status}
    if status == "running":
        fields["started_at"] = _now()
    if status in ("succeeded", "failed", "canceled"):
        fields["finished_at"] = _now()
    if error is not None:
        fields["error"] = error[:4000]
    if worker_id is not None:
        fields["worker_id"] = worker_id

    query = get_supabase().table("builds").update(fields).eq("id", build_id)
    if status != "canceled":
        query = query.neq("status", "canceled")
    res = query.execute()
    if res.data:
        build = res.data[0]
        publish_event(
            {
                "type": "build.status",
                "project_id": build["project_id"],
                "build_id": build_id,
                "platform": build["platform"],
                "status": status,
                "error": error,
            }
        )


def reap_stuck_builds(running_timeout_s: int, queued_timeout_s: int) -> int:
    """Fail builds that can never finish: a worker died mid-build (so the job
    was lost off the Redis queue and nothing will ever complete it), or a
    queued build sat with no worker to pick it up. Returns how many were reaped.

    This is the crash-safety backstop for the at-most-once Redis queue — with
    it, a worker OOM / hard-kill / redeploy turns into a clean "failed, try
    again" instead of a build stuck on a spinner forever.
    """
    from datetime import timedelta

    now = datetime.now(timezone.utc)
    sb = get_supabase()
    reaped = 0

    def _fail(rows: list[dict[str, Any]] | None, reason: str) -> None:
        nonlocal reaped
        for b in rows or []:
            set_build_status(b["id"], "failed", error=reason)
            reaped += 1

    run_cut = (now - timedelta(seconds=running_timeout_s)).isoformat()
    running = (
        sb.table("builds")
        .select("id")
        .eq("status", "running")
        .lt("started_at", run_cut)
        .execute()
    )
    _fail(
        running.data,
        "The build worker didn't finish in time (it may have crashed or been "
        "redeployed). Please try building again.",
    )

    q_cut = (now - timedelta(seconds=queued_timeout_s)).isoformat()
    queued = (
        sb.table("builds")
        .select("id")
        .eq("status", "queued")
        .lt("queued_at", q_cut)
        .execute()
    )
    _fail(
        queued.data,
        "No build worker picked this up in time. Please try building again.",
    )
    return reaped


def list_build_files(build_id: str) -> list[dict[str, Any]]:
    res = (
        get_supabase()
        .table("build_files")
        .select("path, content, language")
        .eq("build_id", build_id)
        .order("seq")
        .execute()
    )
    return res.data or []


def create_fix_build(original_build: dict[str, Any]) -> dict[str, Any]:
    """Queues one automatic AI fix attempt for a build that really failed to
    compile — same spec/platform, linked back via retry_of."""
    res = (
        get_supabase()
        .table("builds")
        .insert(
            {
                "project_id": original_build["project_id"],
                "spec_id": original_build["spec_id"],
                "platform": original_build["platform"],
                "retry_of": original_build["id"],
            }
        )
        .execute()
    )
    build = res.data[0]
    publish_event(
        {
            "type": "build.status",
            "project_id": build["project_id"],
            "build_id": build["id"],
            "platform": build["platform"],
            "status": "queued",
        }
    )
    return build


def create_runtime_fix_build(
    original_build: dict[str, Any],
    error_text: str,
    autonomous: bool = False,
    error_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Queues an AI fix attempt for a REAL runtime error captured from a
    SUCCEEDED build's live app (see app/supabase_connect.py's
    fetch_runtime_errors and POST /projects/{id}/runtime-errors/fix) — same
    spec/platform, linked back via retry_of like a normal compile-error fix,
    but `is_runtime_fix=true` and the error text is stored on THIS build's
    own row (the original build succeeded and has no error of its own).
    web_worker.py uses is_runtime_fix to ship the result as a reviewable PR
    instead of committing straight to main.

    `autonomous=True` (fired by app/runtime_monitor.py's background poller,
    never a human click) additionally sets `is_autonomous_fix` and stores
    which real `_meero_runtime_errors` rows this build is meant to resolve —
    resolution is deferred until those checks genuinely pass (see
    runtime_monitor.evaluate_and_publish), never optimistic like the manual
    fix flow below."""
    insert_row: dict[str, Any] = {
        "project_id": original_build["project_id"],
        "spec_id": original_build["spec_id"],
        "platform": original_build["platform"],
        "retry_of": original_build["id"],
        "is_runtime_fix": True,
        "error": error_text,
    }
    if autonomous:
        insert_row["is_autonomous_fix"] = True
        insert_row["runtime_error_ids"] = error_ids or []
    res = get_supabase().table("builds").insert(insert_row).execute()
    build = res.data[0]
    publish_event(
        {
            "type": "build.status",
            "project_id": build["project_id"],
            "build_id": build["id"],
            "platform": build["platform"],
            "status": "queued",
        }
    )
    return build


def count_recent_autonomous_fixes(project_id: str, since_hours: int = 1) -> int:
    """Real hourly rate cap for the 24/7 monitoring agent — counted from
    actual is_autonomous_fix build rows, same convention as
    supabase_connect.count_recent_sent_emails (derive the cap from real
    data, never a separately tracked counter)."""
    from datetime import timedelta

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    res = (
        get_supabase()
        .table("builds")
        .select("id", count="exact")
        .eq("project_id", project_id)
        .eq("is_autonomous_fix", True)
        .gte("queued_at", cutoff)
        .execute()
    )
    return res.count or 0


def has_in_flight_autonomous_fix(project_id: str) -> bool:
    """True while an autonomous fix for this project is still queued/running,
    OR has succeeded but its readiness-check verification hasn't landed yet
    (runtime_fix_verified IS NULL). That second case closes a real race: the
    build row flips to "succeeded" ~10-20s before readiness checks (real
    headless-browser work, run afterward in web_worker.py) actually finish —
    without it, a second poll pass could fire a second autonomous fix against
    the same project mid-verification."""
    res = (
        get_supabase()
        .table("builds")
        .select("id, status, runtime_fix_verified")
        .eq("project_id", project_id)
        .eq("is_autonomous_fix", True)
        .in_("status", ["queued", "running", "succeeded"])
        .execute()
    )
    for row in res.data or []:
        if row["status"] in ("queued", "running"):
            return True
        if row["status"] == "succeeded" and row.get("runtime_fix_verified") is None:
            return True
    return False


# --------------------------------------------------------------------------
# Conversion agent (00042_conversion_agent.sql) — the background agent that
# detects conversion issues from real visitor behavior
# (app/conversion_agent.py) and runs verified client-bucketed A/B
# experiments to fix them. No `_meero_` prefix on these table names: that
# prefix is reserved for tables living INSIDE generated apps' own Supabase
# projects (_meero_runtime_errors, _meero_behavior_events) — these live in
# Meero's own schema, like builds/project_collaborators.
# --------------------------------------------------------------------------


def create_conversion_hypothesis(
    project_id: str,
    issue_type: str,
    page_path: str,
    element_selector: str | None,
    description: str,
    proposed_fix: str,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    res = (
        get_supabase()
        .table("conversion_hypotheses")
        .insert(
            {
                "project_id": project_id,
                "issue_type": issue_type,
                "page_path": page_path,
                "element_selector": element_selector,
                "description": description,
                "proposed_fix": proposed_fix,
                "evidence": evidence,
            }
        )
        .execute()
    )
    return res.data[0]


def list_open_conversion_hypotheses(project_id: str) -> list[dict[str, Any]]:
    """`open` (never yet tried) and `experimenting` (an experiment for it is
    already running) rows — used both to dedupe new detections against and
    to pick the next hypothesis to launch."""
    res = (
        get_supabase()
        .table("conversion_hypotheses")
        .select("*")
        .eq("project_id", project_id)
        .in_("status", ["open", "experimenting"])
        .order("created_at", desc=False)
        .execute()
    )
    return res.data or []


def get_conversion_hypothesis(hypothesis_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("conversion_hypotheses")
        .select("*")
        .eq("id", hypothesis_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def set_conversion_hypothesis_status(hypothesis_id: str, status: str) -> None:
    get_supabase().table("conversion_hypotheses").update(
        {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", hypothesis_id).execute()


def create_conversion_experiment(
    project_id: str, hypothesis_id: str, experiment_key: str, goal_event: str
) -> dict[str, Any]:
    """Inserts the experiment row itself (status='running', launch_build_id
    still null) — created BEFORE the launch build row so the build can
    reference a real conversion_experiment_id from the start; the build's
    id is patched back onto launch_build_id right after
    (see create_conversion_experiment_build)."""
    res = (
        get_supabase()
        .table("conversion_experiments")
        .insert(
            {
                "project_id": project_id,
                "hypothesis_id": hypothesis_id,
                "experiment_key": experiment_key,
                "goal_event": goal_event,
            }
        )
        .execute()
    )
    return res.data[0]


def get_conversion_experiment(experiment_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("conversion_experiments")
        .select("*")
        .eq("id", experiment_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def create_conversion_experiment_build(
    experiment: dict[str, Any],
    base_build: dict[str, Any],
    action: str,
    prompt_text: str,
) -> dict[str, Any]:
    """Creates the real build row for one experiment lifecycle action
    (launch/graduate/revert) — same spec/platform, linked back via retry_of
    like a normal fix, mirrors create_runtime_fix_build's shape. Falls
    through web_worker.py's existing is_runtime_fix branch to the `else`
    (straight to main): is_conversion_experiment builds are never PR'd, an
    experiment must actually be live to collect data.

    Patches the experiment row's launch_build_id (action='launch') or
    graduation_build_id (action in 'graduate'/'revert') to this build's id
    right after insert."""
    insert_row: dict[str, Any] = {
        "project_id": base_build["project_id"],
        "spec_id": base_build["spec_id"],
        "platform": base_build["platform"],
        "retry_of": base_build["id"],
        "is_conversion_experiment": True,
        "conversion_experiment_id": experiment["id"],
        "conversion_experiment_action": action,
        "error": prompt_text,
    }
    res = get_supabase().table("builds").insert(insert_row).execute()
    build = res.data[0]

    field = "launch_build_id" if action == "launch" else "graduation_build_id"
    get_supabase().table("conversion_experiments").update({field: build["id"]}).eq(
        "id", experiment["id"]
    ).execute()

    publish_event(
        {
            "type": "build.status",
            "project_id": build["project_id"],
            "build_id": build["id"],
            "platform": build["platform"],
            "status": "queued",
        }
    )
    return build


def has_in_flight_conversion_experiment(project_id: str) -> bool:
    """Only one experiment runs at a time per project — overlapping variants
    touching shared UI would confound both experiments' metrics. The
    experiment row is created with status='running' at launch time, BEFORE
    its build is even queued, so this single check covers the whole span
    from launch attempt through eventual decision — no separate build-status
    lookup needed."""
    res = (
        get_supabase()
        .table("conversion_experiments")
        .select("id", count="exact")
        .eq("project_id", project_id)
        .eq("status", "running")
        .execute()
    )
    return (res.count or 0) > 0


def count_recent_conversion_experiments(project_id: str, days: int = 7) -> int:
    """Real weekly rate cap, counted from actual conversion_experiments rows
    — same "derive from real data, never a separately tracked counter"
    convention as count_recent_autonomous_fixes."""
    from datetime import timedelta

    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    res = (
        get_supabase()
        .table("conversion_experiments")
        .select("id", count="exact")
        .eq("project_id", project_id)
        .gte("started_at", cutoff)
        .execute()
    )
    return res.count or 0


def list_running_conversion_experiments(project_id: str) -> list[dict[str, Any]]:
    res = (
        get_supabase()
        .table("conversion_experiments")
        .select("*")
        .eq("project_id", project_id)
        .eq("status", "running")
        .execute()
    )
    return res.data or []


def create_conversion_result(
    experiment_id: str,
    exposures_a: int,
    exposures_b: int,
    conversions_a: int,
    conversions_b: int,
    p_value: float | None,
    lift_pct: float | None,
    decision: str,
    ci_low_pct: float | None = None,
    ci_high_pct: float | None = None,
) -> dict[str, Any]:
    """Always inserted, even for decision='continue' — a real audit trail of
    the significance math over time, not a single overwritten "current"
    row, so the dashboard can show a live trend line. ci_low_pct/ci_high_pct
    (00044_conversion_kpis.sql) are the real 95% confidence interval around
    lift_pct — see app/conversion_agent.py's _lift_confidence_interval."""
    res = (
        get_supabase()
        .table("conversion_results")
        .insert(
            {
                "experiment_id": experiment_id,
                "exposures_a": exposures_a,
                "exposures_b": exposures_b,
                "conversions_a": conversions_a,
                "conversions_b": conversions_b,
                "p_value": p_value,
                "lift_pct": lift_pct,
                "decision": decision,
                "ci_low_pct": ci_low_pct,
                "ci_high_pct": ci_high_pct,
            }
        )
        .execute()
    )
    return res.data[0]


def set_conversion_experiment_status(
    experiment_id: str,
    status: str,
    decided_at: str | None = None,
) -> None:
    update: dict[str, Any] = {"status": status}
    if decided_at is not None:
        update["decided_at"] = decided_at
    get_supabase().table("conversion_experiments").update(update).eq(
        "id", experiment_id
    ).execute()


def clear_conversion_experiment_graduation_build(experiment_id: str) -> None:
    """Un-patches graduation_build_id after a graduate/revert build fails —
    see app/conversion_agent.py's mark_graduation_failed, the only caller.

    create_conversion_experiment_build() patches graduation_build_id onto
    the experiment the moment the build row is created (before it's even
    queued), specifically so a double-click / two open tabs can't queue a
    second graduate/revert build for the same decided experiment. But that
    same early patch means a build that later FAILS leaves the experiment
    looking permanently "already applied": the manual apply-decision
    endpoint refuses to retry (graduation_build_id is truthy), and the
    experiment's status is already terminal (winner_a/winner_b/inconclusive,
    not "running") so the autonomous evaluation pass never reconsiders it
    either — nothing would ever retry a failed graduate/revert without this.
    Clearing it back to null makes the experiment look exactly like a
    decided-but-not-yet-applied one again: the manual "Keep this fix"/
    "Revert" button reappears (the same build.status failed WS event that
    triggers this already causes the panel's router.refresh()), and
    poll_conversion_agent's retry pass below picks it up for Solo mode."""
    get_supabase().table("conversion_experiments").update(
        {"graduation_build_id": None}
    ).eq("id", experiment_id).execute()


def count_conversion_graduation_attempts(experiment_id: str) -> int:
    """How many real graduate/revert builds have already been tried for this
    experiment — the bound _retry_stuck_graduations (app/conversion_agent.py)
    checks before queuing another one, so a build that keeps genuinely
    failing (a fundamental incompatibility, not a transient blip) can't burn
    credits forever on an automatic retry loop."""
    res = (
        get_supabase()
        .table("builds")
        .select("id", count="exact")
        .eq("conversion_experiment_id", experiment_id)
        .in_("conversion_experiment_action", ["graduate", "revert"])
        .execute()
    )
    return res.count or 0


def list_undelivered_conversion_decisions(project_id: str) -> list[dict[str, Any]]:
    """Decided experiments (a real winner_a/winner_b/inconclusive verdict
    already reached) whose graduate/revert build either never got queued or
    was queued and then failed (graduation_build_id null either way) —
    exactly the set poll_conversion_agent's Solo-mode retry pass needs to
    re-attempt, without re-running the significance test itself."""
    res = (
        get_supabase()
        .table("conversion_experiments")
        .select("*")
        .eq("project_id", project_id)
        .in_("status", ["winner_a", "winner_b", "inconclusive"])
        .is_("graduation_build_id", "null")
        .execute()
    )
    return res.data or []


def set_runtime_fix_verified(build_id: str, passed: bool) -> None:
    """Persists whether an autonomous fix's own readiness checks actually
    passed — see app/runtime_monitor.py's evaluate_and_publish, the only
    caller. Never set for a manual (non-autonomous) fix."""
    get_supabase().table("builds").update({"runtime_fix_verified": passed}).eq(
        "id", build_id
    ).execute()


def create_restore_build(original_build: dict[str, Any]) -> dict[str, Any]:
    """Queues a real rebuild of an EARLIER succeeded build's exact stored
    source — genuine version-control rollback (00030_build_rollback.sql),
    not a pointer flip: the caller copies the old build_files onto this new
    build row (linked back via restored_from) and pushes it through the
    normal bundle-only pipeline (use_build_files=True in the web queue
    payload) — real schema re-apply, a real `next build`, a real commit to
    main. The build being restored TO is never mutated or deleted."""
    res = (
        get_supabase()
        .table("builds")
        .insert(
            {
                "project_id": original_build["project_id"],
                "spec_id": original_build["spec_id"],
                "platform": original_build["platform"],
                "restored_from": original_build["id"],
            }
        )
        .execute()
    )
    build = res.data[0]
    publish_event(
        {
            "type": "build.status",
            "project_id": build["project_id"],
            "build_id": build["id"],
            "platform": build["platform"],
            "status": "queued",
        }
    )
    return build


def has_retry(build_id: str) -> bool:
    res = (
        get_supabase()
        .table("builds")
        .select("id")
        .eq("retry_of", build_id)
        .limit(1)
        .execute()
    )
    return bool(res.data)


def get_artifact(build_id: str, kind: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("build_artifacts")
        .select("*")
        .eq("build_id", build_id)
        .eq("kind", kind)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def set_preview_url(build_id: str, url: str) -> None:
    """Stores the real live-preview URL for a succeeded build (served through
    the orchestrator's own /preview proxy) and pushes it to any connected
    WebSocket clients."""
    res = (
        get_supabase()
        .table("builds")
        .update({"preview_url": url})
        .eq("id", build_id)
        .execute()
    )
    if res.data:
        build = res.data[0]
        publish_event(
            {
                "type": "build.preview",
                "project_id": build["project_id"],
                "build_id": build_id,
                "platform": build["platform"],
                "preview_url": url,
            }
        )


def add_artifact(
    build_id: str,
    kind: str,
    storage_path: str,
    size_bytes: int | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    get_supabase().table("build_artifacts").insert(
        {
            "build_id": build_id,
            "kind": kind,
            "storage_path": storage_path,
            "size_bytes": size_bytes,
            "metadata": metadata,
        }
    ).execute()


def replace_build_files(
    build_id: str, project_id: str, files: list[dict[str, Any]]
) -> None:
    """Persist the generated source for a build so the builder's Code tab can
    read it (RLS-scoped, user-read-only). Idempotent per build: clears any
    prior rows for this build before inserting, so a retried codegen run
    doesn't leave stale files behind.
    """
    client = get_supabase()
    client.table("build_files").delete().eq("build_id", build_id).execute()
    if not files:
        return
    rows = [
        {
            "build_id": build_id,
            "project_id": project_id,
            "path": f["path"],
            "content": f["content"],
            "language": f.get("language"),
            "seq": i,
        }
        for i, f in enumerate(files)
    ]
    client.table("build_files").insert(rows).execute()


def upsert_build_file(
    build_id: str,
    project_id: str,
    path: str,
    content: str,
    language: str | None,
    seq: int,
) -> None:
    """Durably persists ONE generated file the moment its content is final,
    instead of waiting for replace_build_files() to write the whole bundle
    at the very end. This is what lets a page refresh mid-generation still
    show real, already-finished code (00040_build_files_live_persist.sql's
    unique(build_id, path) is what makes the upsert possible). The final
    replace_build_files() call still runs after the full bundle completes
    and remains the authoritative write — this just closes the durability
    gap while it's still streaming.
    """
    get_supabase().table("build_files").upsert(
        {
            "build_id": build_id,
            "project_id": project_id,
            "path": path,
            "content": content,
            "language": language,
            "seq": seq,
        },
        on_conflict="build_id,path",
    ).execute()


def upload_artifact_file(storage_path: str, data: bytes, content_type: str) -> None:
    get_supabase().storage.from_(get_settings().artifacts_bucket).upload(
        storage_path, data, {"content-type": content_type, "upsert": "true"}
    )


def download_artifact_file(storage_path: str) -> bytes:
    return (
        get_supabase()
        .storage.from_(get_settings().artifacts_bucket)
        .download(storage_path)
    )


def upload_preview_file(storage_path: str, data: bytes, content_type: str) -> None:
    """Uploads one file of a live app bundle to the PUBLIC previews bucket so
    it can be served through the /preview proxy. See web_worker.py /
    00011_expo_platform.sql."""
    get_supabase().storage.from_(get_settings().previews_bucket).upload(
        storage_path, data, {"content-type": content_type, "upsert": "true"}
    )


def preview_public_url(storage_path: str) -> str:
    """Public URL for a file in the previews bucket (bucket must be public).

    NOT used for `builds.preview_url` (see app/main.py's /preview route for
    why) — kept only as the raw building block `download_preview_file` below
    doesn't need but a future direct-download use might.
    """
    settings = get_settings()
    base = settings.supabase_url.rstrip("/")
    return f"{base}/storage/v1/object/public/{settings.previews_bucket}/{storage_path}"


def download_preview_file(storage_path: str) -> bytes:
    """Downloads one file of a live app bundle from the previews bucket —
    used by the orchestrator's own /preview proxy route (app/main.py), which
    re-serves it with the correct Content-Type and no CSP, and by the deploy
    worker (the release ships the exact bytes the preview serves). Supabase
    Storage's own public object URL forces text/html down to text/plain and
    blocks script execution on every publicly served object, so the browser
    can never run the app if it loads the bundle directly from Storage."""
    return (
        get_supabase()
        .storage.from_(get_settings().previews_bucket)
        .download(storage_path)
    )


def upload_screenshot(storage_path: str, data: bytes, content_type: str) -> None:
    """Uploads a real screenshot (captured by the web worker with a headless
    browser against the just-published /preview URL) to the PUBLIC
    screenshots bucket. See 00020_project_screenshots.sql."""
    get_supabase().storage.from_(get_settings().screenshots_bucket).upload(
        storage_path, data, {"content-type": content_type, "upsert": "true"}
    )


def screenshot_exists(storage_path: str) -> bool:
    """Cheap existence check for the cache-on-first-request heatmap
    screenshot path (app/screenshot.py) — avoids re-paying a real headless-
    browser capture on every dashboard load for the same page."""
    try:
        get_supabase().storage.from_(get_settings().screenshots_bucket).download(
            storage_path
        )
        return True
    except Exception:
        return False


def screenshot_public_url(storage_path: str) -> str:
    """Public URL for a screenshot. Unlike preview HTML, Storage serves
    images with the correct content-type and no blocking CSP, so — unlike
    /preview — this is used directly, no proxy route needed."""
    settings = get_settings()
    base = settings.supabase_url.rstrip("/")
    return (
        f"{base}/storage/v1/object/public/{settings.screenshots_bucket}/{storage_path}"
    )


def set_project_screenshot(project_id: str, url: str) -> None:
    """Persists a real screenshot URL. Called only by the web worker after a
    real headless-browser capture succeeded — never speculatively. Trigger-
    protected (protect_screenshot_url, 00020) against non-service-role
    writes."""
    get_supabase().table("projects").update({"screenshot_url": url}).eq(
        "id", project_id
    ).execute()


def set_project_display_title(project_id: str, title: str) -> None:
    """Persists a real LLM-generated short title for the public gallery
    (see generate_project_title in app/main.py) — never the raw prompt.
    Trigger-protected (protect_display_title, 00043) against non-service-
    role writes."""
    get_supabase().table("projects").update({"display_title": title}).eq(
        "id", project_id
    ).execute()


def set_build_plan_preview(build_id: str, plan: dict[str, Any]) -> None:
    """Durably persists the growing partial AppPlan as it streams (see
    codegen_worker.py's on_plan callback), so a page refresh mid-planning
    still shows the real plan instead of nothing — mirrors
    upsert_build_file()'s live-persist fix for generated files
    (00046_build_plan_preview.sql). Called on every streamed chunk,
    including the last one (which is the complete, final plan), so this
    single column stays the one source of truth for both the in-progress
    and finished plan; best-effort by design at the call site, same as the
    file persist."""
    get_supabase().table("builds").update({"plan_preview": plan}).eq(
        "id", build_id
    ).execute()


def set_build_readiness_checks(build_id: str, checks: list[dict[str, Any]]) -> None:
    """Persists the real, just-run "is your app ready?" checklist (see
    app/readiness_check.py) for this build. Called only by the web worker
    right after a successful build — never speculatively. `builds` has no
    authenticated write policy (00001_init.sql), so this needs no extra
    trigger protection beyond what already exists."""
    get_supabase().table("builds").update({"readiness_checks": checks}).eq(
        "id", build_id
    ).execute()


def set_build_fix_explanation(
    build_id: str,
    *,
    explanation: str,
    changed_paths: list[str],
    diffs: dict[str, str],
    targeted: bool,
) -> None:
    """Persists what a build actually changed and why (see codegen.py's
    FixResult / diff_files) — a real diff per changed file, never a
    description of one. Called by the codegen worker right after a fix
    build's files are written, OR after a normal chat-driven iteration
    grounded in the project's previous code (see codegen_worker.py's
    generate_project(..., previous_files=...) path) — both cases produce
    the exact same shape. `builds` has no authenticated write policy
    (00001_init.sql), so this needs no extra protection."""
    get_supabase().table("builds").update(
        {
            "fix_explanation": explanation,
            "fix_diff": {
                "targeted": targeted,
                "changed_paths": changed_paths,
                "diffs": diffs,
            },
        }
    ).eq("id", build_id).execute()


def set_build_deployment(
    build_id: str, project_id: str, url: str, deployment_id: str
) -> None:
    """Persists a REAL, successful Vercel production release: the build's own
    deploy_url, the project-level live_url mirror (so the link survives
    newer undeployed builds), and a 'deployment' artifact row recording the
    Vercel deployment id. Called only by the deploy worker after Vercel
    reports READY — never speculatively."""
    client = get_supabase()
    client.table("builds").update({"deploy_url": url}).eq("id", build_id).execute()
    client.table("projects").update({"live_url": url}).eq("id", project_id).execute()
    add_artifact(
        build_id,
        "deployment",
        url,
        metadata={"url": url, "vercel_deployment_id": deployment_id},
    )


def save_github_connection(
    user_id: str, github_username: str, access_token: str
) -> None:
    """Stores the real OAuth token used to push commits (service-role-only
    table, no RLS policies for authenticated/anon) and mirrors the non-secret
    username onto the profile so the UI can show connection state."""
    client = get_supabase()
    client.table("github_connections").upsert(
        {
            "user_id": user_id,
            "github_username": github_username,
            "access_token": access_token,
        }
    ).execute()
    client.table("profiles").update({"github_username": github_username}).eq(
        "id", user_id
    ).execute()


def save_supabase_connection(
    user_id: str, access_token: str, refresh_token: str, expires_at: str
) -> None:
    """Stores the real Supabase Management API tokens (service-role-only
    table, no RLS policies for authenticated/anon) and mirrors the
    non-secret connected flag onto the profile so the UI can show state."""
    client = get_supabase()
    client.table("supabase_connections").upsert(
        {
            "user_id": user_id,
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_at": expires_at,
        }
    ).execute()
    client.table("profiles").update({"supabase_connected": True}).eq(
        "id", user_id
    ).execute()


def get_supabase_connection(user_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("supabase_connections")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def delete_supabase_connection(user_id: str) -> None:
    """Logs the user out of Supabase: drops the stored Management API tokens
    and flips the non-secret connected flag back off. Already-deployed
    generated apps keep working (they carry the public anon key, independent
    of this OAuth connection); only future builds need a reconnect."""
    client = get_supabase()
    client.table("supabase_connections").delete().eq("user_id", user_id).execute()
    client.table("profiles").update({"supabase_connected": False}).eq(
        "id", user_id
    ).execute()


def clear_project_supabase_link(project_id: str) -> None:
    """Unbinds a project from its Supabase project (service-role write, past
    the protect_supabase_link_fields trigger). Used when the user disconnects
    Supabase, so the builder honestly shows the project as unlinked. Also
    clears any in-flight/failed auto-provisioning state (00045) — a
    reconnect starts a genuinely fresh auto-provision attempt, and the
    background poller stops chasing a project whose owner just disconnected."""
    get_supabase().table("projects").update(
        {
            "supabase_project_ref": None,
            "supabase_url": None,
            "supabase_anon_key": None,
            "supabase_provisioning_status": None,
            "supabase_provisioning_ref": None,
            "supabase_provisioning_error": None,
            "supabase_provisioning_started_at": None,
        }
    ).eq("id", project_id).execute()


def set_project_supabase_link(
    project_id: str, project_ref: str, url: str, anon_key: str
) -> None:
    """Binds a Meero project to one of the owner's real Supabase projects —
    written only after the Management API confirmed the ref + anon key.
    Also clears any in-flight auto-provisioning state (00045) — this is the
    same "finalize" moment for both the manual-link and auto-provision
    paths."""
    get_supabase().table("projects").update(
        {
            "supabase_project_ref": project_ref,
            "supabase_url": url,
            "supabase_anon_key": anon_key,
            "supabase_provisioning_status": None,
            "supabase_provisioning_ref": None,
            "supabase_provisioning_error": None,
            "supabase_provisioning_started_at": None,
        }
    ).eq("id", project_id).execute()


def start_project_provisioning(project_id: str, pending_ref: str) -> None:
    """Marks a real new Supabase project (just created via the Management
    API) as in-flight — the background poller in main.py finalizes the link
    once it comes ACTIVE (see 00045_supabase_auto_provision.sql for why
    supabase_project_ref itself stays null until then)."""
    get_supabase().table("projects").update(
        {
            "supabase_provisioning_status": "provisioning",
            "supabase_provisioning_ref": pending_ref,
            "supabase_provisioning_error": None,
            "supabase_provisioning_started_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", project_id).execute()


def fail_project_provisioning(project_id: str, error: str) -> None:
    """Records a genuine provisioning failure (Management API error, a
    terminal project status, or a timeout) so the builder can show an honest
    error instead of spinning forever. The manual Supabase-project picker
    stays available as a fallback."""
    get_supabase().table("projects").update(
        {"supabase_provisioning_status": "failed", "supabase_provisioning_error": error}
    ).eq("id", project_id).execute()


def list_provisioning_projects() -> list[dict[str, Any]]:
    """Every project with an auto-provisioned Supabase project still coming
    up — what the in-process poller (app/main.py) scans each pass."""
    res = (
        get_supabase()
        .table("projects")
        .select(
            "id, owner_id, name, supabase_provisioning_ref, supabase_provisioning_started_at"
        )
        .eq("supabase_provisioning_status", "provisioning")
        .execute()
    )
    return res.data or []


def get_github_connection(user_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("github_connections")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def set_project_github_repo(project_id: str, full_name: str, url: str) -> None:
    get_supabase().table("projects").update(
        {"github_repo_full_name": full_name, "github_repo_url": url}
    ).eq("id", project_id).execute()


# --------------------------------------------------------------------------
# Superagent (00033_superagent.sql) — a personal GitHub bot per connected
# repo. Service-role-only table (real webhook secrets live here), same
# pattern as github_connections above — never read directly by the browser.
# --------------------------------------------------------------------------


def create_superagent_connection(
    user_id: str,
    full_name: str,
    repo_url: str,
    webhook_id: int,
    webhook_secret: str,
    instructions: str,
) -> dict[str, Any]:
    res = (
        get_supabase()
        .table("superagent_connections")
        .insert(
            {
                "user_id": user_id,
                "github_repo_full_name": full_name,
                "github_repo_url": repo_url,
                "github_webhook_id": webhook_id,
                "webhook_secret": webhook_secret,
                "instructions": instructions,
            }
        )
        .execute()
    )
    return res.data[0]


def list_superagent_connections(user_id: str) -> list[dict[str, Any]]:
    res = (
        get_supabase()
        .table("superagent_connections")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


def get_superagent_connection(connection_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("superagent_connections")
        .select("*")
        .eq("id", connection_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def get_superagent_connection_by_repo(full_name: str) -> dict[str, Any] | None:
    """Looked up from an inbound webhook payload's `repository.full_name` —
    real installs are unique per (user, repo) so this is unambiguous."""
    res = (
        get_supabase()
        .table("superagent_connections")
        .select("*")
        .eq("github_repo_full_name", full_name)
        .eq("status", "active")
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def delete_superagent_connection(connection_id: str) -> None:
    get_supabase().table("superagent_connections").delete().eq(
        "id", connection_id
    ).execute()


# --------------------------------------------------------------------------
# Slack (00035_superagent_slack.sql) — real OAuth bot token per user,
# service-role-only, same pattern as github_connections.
# --------------------------------------------------------------------------


def save_slack_connection(
    user_id: str, team_id: str, team_name: str, bot_token: str, bot_user_id: str
) -> None:
    get_supabase().table("slack_connections").upsert(
        {
            "user_id": user_id,
            "team_id": team_id,
            "team_name": team_name,
            "bot_token": bot_token,
            "bot_user_id": bot_user_id,
        }
    ).execute()


def get_slack_connection(user_id: str) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("slack_connections")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def link_slack_channel(connection_id: str, channel_id: str, channel_name: str) -> None:
    get_supabase().table("superagent_connections").update(
        {"slack_channel_id": channel_id, "slack_channel_name": channel_name}
    ).eq("id", connection_id).execute()


def unlink_slack_channel(connection_id: str) -> None:
    get_supabase().table("superagent_connections").update(
        {"slack_channel_id": None, "slack_channel_name": None}
    ).eq("id", connection_id).execute()


def get_superagent_connection_by_slack_channel(
    channel_id: str,
) -> dict[str, Any] | None:
    res = (
        get_supabase()
        .table("superagent_connections")
        .select("*")
        .eq("slack_channel_id", channel_id)
        .eq("status", "active")
        .maybe_single()
        .execute()
    )
    return res.data if res else None


def create_superagent_event(
    connection_id: str, user_id: str, event_type: str, issue_number: int | None
) -> dict[str, Any]:
    res = (
        get_supabase()
        .table("superagent_events")
        .insert(
            {
                "connection_id": connection_id,
                "user_id": user_id,
                "event_type": event_type,
                "issue_number": issue_number,
            }
        )
        .execute()
    )
    return res.data[0]


def finish_superagent_event(
    event_id: str,
    status: str,
    *,
    pr_url: str | None = None,
    summary: str | None = None,
    error: str | None = None,
) -> None:
    fields: dict[str, Any] = {"status": status, "finished_at": _now()}
    if pr_url is not None:
        fields["pr_url"] = pr_url
    if summary is not None:
        fields["summary"] = summary[:2000]
    if error is not None:
        fields["error"] = error[:2000]
    get_supabase().table("superagent_events").update(fields).eq(
        "id", event_id
    ).execute()


def list_superagent_events(connection_id: str, limit: int = 50) -> list[dict[str, Any]]:
    res = (
        get_supabase()
        .table("superagent_events")
        .select("*")
        .eq("connection_id", connection_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


# --------------------------------------------------------------------------
# Superagent chat (00034_superagent_chat.sql) — real messages, both
# directions, scoped to one connected repo.
# --------------------------------------------------------------------------


def create_superagent_message(
    connection_id: str,
    user_id: str,
    role: str,
    content: str,
    pr_url: str | None = None,
) -> dict[str, Any]:
    res = (
        get_supabase()
        .table("superagent_messages")
        .insert(
            {
                "connection_id": connection_id,
                "user_id": user_id,
                "role": role,
                "content": content,
                "pr_url": pr_url,
            }
        )
        .execute()
    )
    return res.data[0]


def list_superagent_messages(
    connection_id: str, limit: int = 50
) -> list[dict[str, Any]]:
    """Oldest first — a real chat thread reads top to bottom."""
    res = (
        get_supabase()
        .table("superagent_messages")
        .select("*")
        .eq("connection_id", connection_id)
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return list(reversed(res.data or []))


def set_project_domain(project_id: str, domain: str | None, verified: bool) -> None:
    """Persists a real custom domain (00026_custom_domains.sql) — called only
    after a genuine Vercel API call confirmed it, never speculatively.
    `domain=None` clears it (used by remove_domain's caller)."""
    get_supabase().table("projects").update(
        {"custom_domain": domain, "custom_domain_verified": verified}
    ).eq("id", project_id).execute()


def get_user_id_from_token(access_token: str) -> str | None:
    """Validate a Supabase access token and return the user id."""
    try:
        res = get_supabase().auth.get_user(access_token)
        return res.user.id if res and res.user else None
    except Exception:
        return None

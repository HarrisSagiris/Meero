"""Connects a user's OWN Supabase account and drives it for their apps.

OAuth connect (a registered Supabase OAuth App, orchestrator-brokered — same
one-time-state pattern as app/github_publish.py), then real Supabase
Management API calls on the user's behalf: list their projects, read a
project's URL + anon key, apply a generated app's schema.sql as real DDL on
their real database, and relax email confirmation so generated-app signups
work instantly. Nothing here is simulated — every call hits
api.supabase.com and acts on the user's genuine Supabase resources.
"""

import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import get_settings
from app.infrastructure.queues.queues import get_redis
from app.workers.common import log

SUPABASE_API = "https://api.supabase.com"
_STATE_PREFIX = "meero:sb_oauth_state:"
_STATE_TTL_SECONDS = 600


class SupabaseConnectError(Exception):
    """Raised when a real Supabase Management API call fails."""


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------------------
# OAuth connect
# --------------------------------------------------------------------------


def build_authorize_url(user_id: str, project_id: str | None = None) -> str:
    """Generates a one-time state token bound to this user (and, when
    initiated from a project's Connections tab, that project too — stored
    in Redis, short-lived) and returns the real Supabase OAuth authorize
    URL. `project_id=None` is a real, supported case: the account settings
    page connects Supabase without any project in scope (nothing to
    auto-provision into yet — see supabase_callback), so a later project
    just reuses the resulting account-level connection
    (profiles.supabase_connected) via the existing per-project link flow
    instead of reconnecting."""
    settings = get_settings()
    if not settings.supabase_oauth_configured:
        raise SupabaseConnectError(
            "Supabase connect isn't configured (set SUPABASE_OAUTH_CLIENT_ID / "
            "SUPABASE_OAUTH_CLIENT_SECRET)."
        )
    state = secrets.token_urlsafe(24)
    get_redis().setex(
        f"{_STATE_PREFIX}{state}", _STATE_TTL_SECONDS, f"{user_id}:{project_id or ''}"
    )
    params = httpx.QueryParams(
        {
            "client_id": settings.supabase_oauth_client_id,
            "redirect_uri": settings.supabase_oauth_redirect_uri,
            "response_type": "code",
            "state": state,
        }
    )
    return f"{SUPABASE_API}/v1/oauth/authorize?{params}"


def resolve_state(state: str) -> tuple[str, str | None] | None:
    """Consumes a one-time state token, returning (user_id, project_id) —
    project_id is None for an account-only connect (see build_authorize_url)."""
    key = f"{_STATE_PREFIX}{state}"
    raw = get_redis().get(key)
    if raw is None:
        return None
    get_redis().delete(key)
    user_id, project_id = raw.split(":", 1)
    return user_id, (project_id or None)


def _token_request(data: dict[str, str]) -> dict[str, Any]:
    settings = get_settings()
    response = httpx.post(
        f"{SUPABASE_API}/v1/oauth/token",
        # Supabase's token endpoint takes client credentials via HTTP Basic.
        auth=(settings.supabase_oauth_client_id, settings.supabase_oauth_client_secret),
        data=data,
        timeout=30,
    )
    if response.status_code >= 300:
        raise SupabaseConnectError(
            f"Supabase token exchange failed ({response.status_code}): "
            f"{response.text[:300]}"
        )
    payload = response.json()
    if not payload.get("access_token"):
        raise SupabaseConnectError(f"Supabase token exchange returned no token: {payload}")
    return payload


def exchange_code_for_tokens(code: str) -> dict[str, Any]:
    """Returns {access_token, refresh_token, expires_at} from an OAuth code."""
    settings = get_settings()
    payload = _token_request(
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": settings.supabase_oauth_redirect_uri,
        }
    )
    return _normalize_tokens(payload)


def refresh_tokens(refresh_token: str) -> dict[str, Any]:
    payload = _token_request(
        {"grant_type": "refresh_token", "refresh_token": refresh_token}
    )
    return _normalize_tokens(payload)


def _normalize_tokens(payload: dict[str, Any]) -> dict[str, Any]:
    expires_in = int(payload.get("expires_in") or 3600)
    return {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token") or "",
        "expires_at": (
            datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        ).isoformat(),
    }


def fresh_access_token(user_id: str) -> str:
    """The user's current Management API token, refreshed (and re-persisted)
    first if it's expired or about to be. Raises if they never connected."""
    from app.infrastructure.database import db  # local import: keeps this a leaf dependency of db.py

    connection = db.get_supabase_connection(user_id)
    if connection is None:
        raise SupabaseConnectError(
            "No Supabase account is connected — connect one in the builder header."
        )
    expires_at = datetime.fromisoformat(
        str(connection["expires_at"]).replace("Z", "+00:00")
    )
    if expires_at > datetime.now(timezone.utc) + timedelta(minutes=2):
        return connection["access_token"]
    tokens = refresh_tokens(connection["refresh_token"])
    db.save_supabase_connection(
        user_id, tokens["access_token"], tokens["refresh_token"], tokens["expires_at"]
    )
    return tokens["access_token"]


# --------------------------------------------------------------------------
# Management API — real operations on the user's own Supabase resources
# --------------------------------------------------------------------------


def list_projects(access_token: str) -> list[dict[str, Any]]:
    """The user's real Supabase projects (for the builder's picker)."""
    response = httpx.get(
        f"{SUPABASE_API}/v1/projects", headers=_headers(access_token), timeout=30
    )
    if response.status_code >= 300:
        raise SupabaseConnectError(
            f"Couldn't list Supabase projects ({response.status_code}): "
            f"{response.text[:300]}"
        )
    return [
        {
            "ref": p.get("id"),
            "name": p.get("name"),
            "region": p.get("region"),
            "status": p.get("status"),
        }
        for p in response.json()
    ]


def get_project_anon_key(access_token: str, project_ref: str) -> str:
    response = httpx.get(
        f"{SUPABASE_API}/v1/projects/{project_ref}/api-keys",
        headers=_headers(access_token),
        timeout=30,
    )
    if response.status_code >= 300:
        raise SupabaseConnectError(
            f"Couldn't read the project's API keys ({response.status_code}): "
            f"{response.text[:300]}"
        )
    for key in response.json():
        if key.get("name") == "anon":
            return key["api_key"]
    raise SupabaseConnectError("The Supabase project has no anon API key.")


def project_url(project_ref: str) -> str:
    return f"https://{project_ref}.supabase.co"


# --------------------------------------------------------------------------
# Auto-provisioning — a real brand-new Supabase project, created on the
# user's own account, so connecting Supabase is the ONLY step (no picking
# from a list of existing projects). See 00045_supabase_auto_provision.sql
# for why the resulting ref isn't written to projects.supabase_project_ref
# until it's genuinely active.
# --------------------------------------------------------------------------


def list_organizations(access_token: str) -> list[dict[str, Any]]:
    """The user's real Supabase organizations — a brand-new project must be
    created inside one of them."""
    response = httpx.get(
        f"{SUPABASE_API}/v1/organizations", headers=_headers(access_token), timeout=30
    )
    if response.status_code >= 300:
        raise SupabaseConnectError(
            f"Couldn't list Supabase organizations ({response.status_code}): "
            f"{response.text[:300]}"
        )
    return response.json()


def create_project(
    access_token: str, organization_id: str, name: str, region: str, plan: str
) -> dict[str, Any]:
    """Provisions a REAL new Supabase project via the Management API.
    Returns immediately once creation is accepted — the project comes up
    asynchronously (status starts as e.g. COMING_UP), so the caller must
    poll get_project_status() before treating it as usable."""
    db_pass = secrets.token_urlsafe(32)
    response = httpx.post(
        f"{SUPABASE_API}/v1/projects",
        headers=_headers(access_token),
        json={
            "name": name,
            "organization_id": organization_id,
            "region": region,
            "plan": plan,
            "db_pass": db_pass,
        },
        timeout=30,
    )
    if response.status_code >= 300:
        raise SupabaseConnectError(
            f"Couldn't create a new Supabase project ({response.status_code}): "
            f"{response.text[:300]}"
        )
    payload = response.json()
    return {"ref": payload.get("id"), "status": payload.get("status")}


# Real Management API status strings that mean "up and queryable." Anything
# else (COMING_UP, RESTORING, UNKNOWN, ...) means "keep polling."
_ACTIVE_STATUSES = {"ACTIVE_HEALTHY", "ACTIVE"}
# Statuses the Management API is known to report when creation itself
# failed — provisioning should stop retrying and surface an honest error.
_FAILED_STATUSES = {"INIT_FAILED", "REMOVED", "RESTORE_FAILED"}


def get_project_status(access_token: str, project_ref: str) -> str:
    response = httpx.get(
        f"{SUPABASE_API}/v1/projects/{project_ref}",
        headers=_headers(access_token),
        timeout=30,
    )
    if response.status_code >= 300:
        raise SupabaseConnectError(
            f"Couldn't read the new Supabase project's status ({response.status_code}): "
            f"{response.text[:300]}"
        )
    return str(response.json().get("status") or "")


def run_query(access_token: str, project_ref: str, sql: str) -> Any:
    """Executes REAL SQL (the generated schema.sql) on the user's own
    database via the Management API's query endpoint. A failure here is a
    genuine build failure, fed back into the auto-fix loop."""
    response = httpx.post(
        f"{SUPABASE_API}/v1/projects/{project_ref}/database/query",
        headers=_headers(access_token),
        json={"query": sql},
        timeout=120,
    )
    if response.status_code >= 300:
        raise SupabaseConnectError(
            f"Applying the app's schema to your Supabase project failed "
            f"({response.status_code}): {response.text[:1500]}"
        )
    return response.json()


def _sql_str(value: str) -> str:
    """Single-quote-escape a value for safe inline use in a Management API
    SQL string. Used only for our own generated UUID id list — never for
    untrusted free text — but escaped regardless."""
    return "'" + value.replace("'", "''") + "'"


def fetch_runtime_errors(
    access_token: str, project_ref: str, limit: int = 25
) -> list[dict[str, Any]]:
    """Reads REAL unresolved runtime errors the generated app's client error
    reporter wrote into the `_meero_runtime_errors` table on the user's own
    database (via the Management API query endpoint, which runs as the
    database owner and bypasses RLS — that's why the app-side table only
    needs an insert policy). Returns newest first. If the table doesn't exist
    yet — an app built before this feature shipped — returns [] rather than
    raising, so surfacing errors is always safe to call."""
    sql = (
        "select id, message, stack, path, user_agent, created_at "
        "from public._meero_runtime_errors "
        "where resolved = false "
        f"order by created_at desc limit {int(limit)}"
    )
    try:
        rows = run_query(access_token, project_ref, sql)
    except SupabaseConnectError as exc:
        # Missing table (older app) or any read failure is non-fatal here.
        if "does not exist" in str(exc).lower() or "relation" in str(exc).lower():
            return []
        log.warning("Could not read runtime errors for %s: %s", project_ref, exc)
        return []
    return rows if isinstance(rows, list) else []


def mark_runtime_errors_resolved(
    access_token: str, project_ref: str, error_ids: list[str]
) -> None:
    """Marks specific captured runtime errors resolved on the user's own DB
    so they stop resurfacing (best-effort). Ids are our own generated UUIDs,
    still single-quote-escaped defensively."""
    if not error_ids:
        return
    id_list = ", ".join(_sql_str(str(i)) for i in error_ids)
    sql = (
        "update public._meero_runtime_errors set resolved = true "
        f"where id in ({id_list})"
    )
    try:
        run_query(access_token, project_ref, sql)
    except SupabaseConnectError as exc:
        log.warning("Could not resolve runtime errors for %s: %s", project_ref, exc)


def fetch_behavior_events(
    access_token: str, project_ref: str, since_iso: str, limit: int = 5000
) -> list[dict[str, Any]]:
    """Reads real visitor behavior events the generated app's required
    behavior tracker wrote into `_meero_behavior_events` on the user's own
    database (same Management-API-bypasses-RLS pattern as
    fetch_runtime_errors). Returns [] (never raises) for an app built before
    this feature shipped, same convention as fetch_runtime_errors."""
    sql = (
        "select session_id, event_type, page_path, element_selector, x, y, "
        "scroll_depth, device_type, experiment_key, variant, created_at "
        "from public._meero_behavior_events "
        f"where created_at > {_sql_str(since_iso)} "
        f"order by created_at desc limit {int(limit)}"
    )
    try:
        rows = run_query(access_token, project_ref, sql)
    except SupabaseConnectError as exc:
        if "does not exist" in str(exc).lower() or "relation" in str(exc).lower():
            return []
        log.warning("Could not read behavior events for %s: %s", project_ref, exc)
        return []
    return rows if isinstance(rows, list) else []


def fetch_session_count(access_token: str, project_ref: str, since_iso: str) -> int:
    """Real count of distinct sessions recorded since `since_iso` — the
    conversion agent's traffic-before-experiment gate reads directly off
    this real data, same "derive from real data, never track state
    separately" convention as count_recent_sent_emails."""
    sql = (
        "select count(distinct session_id) as n from public._meero_behavior_events "
        f"where created_at > {_sql_str(since_iso)}"
    )
    try:
        rows = run_query(access_token, project_ref, sql)
    except SupabaseConnectError as exc:
        if "does not exist" in str(exc).lower() or "relation" in str(exc).lower():
            return 0
        log.warning("Could not count sessions for %s: %s", project_ref, exc)
        return 0
    if isinstance(rows, list) and rows:
        return int(rows[0].get("n") or 0)
    return 0


def fetch_experiment_counts(
    access_token: str, project_ref: str, experiment_key: str, since_iso: str
) -> dict[str, int]:
    """Real exposure/conversion counts per variant for one client-bucketed
    experiment, aggregated server-side. COUNT DISTINCT session_id — one
    exposure/conversion per SESSION, not per raw event row, since a visitor
    can trigger the same tracked milestone multiple times in one session."""
    sql = (
        "select variant, event_type, count(distinct session_id) as n "
        "from public._meero_behavior_events "
        f"where experiment_key = {_sql_str(experiment_key)} "
        "and event_type in ('experiment_exposure', 'experiment_conversion') "
        f"and created_at > {_sql_str(since_iso)} "
        "group by variant, event_type"
    )
    out = {"exposures_a": 0, "exposures_b": 0, "conversions_a": 0, "conversions_b": 0}
    try:
        rows = run_query(access_token, project_ref, sql)
    except SupabaseConnectError as exc:
        if "does not exist" in str(exc).lower() or "relation" in str(exc).lower():
            return out
        log.warning(
            "Could not read experiment counts for %s/%s: %s",
            project_ref,
            experiment_key,
            exc,
        )
        return out
    for row in rows if isinstance(rows, list) else []:
        key = "exposures" if row.get("event_type") == "experiment_exposure" else "conversions"
        variant = row.get("variant")
        if variant in ("a", "b"):
            out[f"{key}_{variant}"] = int(row.get("n") or 0)
    return out


def _run_stats_query(
    access_token: str, project_ref: str, sql: str, label: str
) -> list[dict[str, Any]]:
    """Shared missing-table-safe wrapper for the stats sub-queries below —
    same convention as fetch_runtime_errors/fetch_behavior_events: an app
    built before this feature shipped (or with a linked project that has no
    real traffic yet) never raises, just contributes an empty section."""
    try:
        rows = run_query(access_token, project_ref, sql)
    except SupabaseConnectError as exc:
        if "does not exist" in str(exc).lower() or "relation" in str(exc).lower():
            return []
        log.warning("Could not read %s stats for %s: %s", label, project_ref, exc)
        return []
    return rows if isinstance(rows, list) else []


def fetch_behavior_stats(
    access_token: str, project_ref: str, since_iso: str
) -> dict[str, list[dict[str, Any]]]:
    """Real, server-aggregated visitor analytics for the Stats tab — every
    app's required behavior tracker (components/meero-behavior-tracker.tsx)
    always records this data (never gated by conversion_agent_enabled,
    unlike the conversion agent's own analysis), so this reads back
    unconditionally for every Supabase-linked project. Aggregation happens
    in real SQL (GROUP BY), not by pulling every raw event and summing in
    Python — the event volume a busy app can generate makes that the only
    sane approach for a dashboard that gets polled repeatedly. Each section
    is its own independent query so one missing/malformed section (e.g. an
    app built before a new event_type existed) never blanks the rest."""
    since = _sql_str(since_iso)

    sessions_by_day = _run_stats_query(
        access_token,
        project_ref,
        "select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day, "
        "count(distinct session_id) as n "
        "from public._meero_behavior_events "
        f"where created_at > {since} "
        "group by 1 order by 1 asc",
        "sessions_by_day",
    )
    views_by_page = _run_stats_query(
        access_token,
        project_ref,
        "select page_path, count(*) as n "
        "from public._meero_behavior_events "
        f"where event_type = 'page_view' and created_at > {since} "
        "group by page_path order by n desc limit 10",
        "views_by_page",
    )
    device_breakdown = _run_stats_query(
        access_token,
        project_ref,
        "select coalesce(device_type, 'unknown') as device_type, "
        "count(distinct session_id) as n "
        "from public._meero_behavior_events "
        f"where created_at > {since} "
        "group by 1 order by n desc",
        "device_breakdown",
    )
    scroll_depth_distribution = _run_stats_query(
        access_token,
        project_ref,
        "select scroll_depth, count(distinct session_id) as n "
        "from public._meero_behavior_events "
        f"where event_type = 'scroll_depth' and created_at > {since} "
        "group by scroll_depth order by scroll_depth asc",
        "scroll_depth_distribution",
    )
    top_clicked_elements = _run_stats_query(
        access_token,
        project_ref,
        "select page_path, element_selector, count(*) as n "
        "from public._meero_behavior_events "
        f"where event_type = 'click' and created_at > {since} "
        "group by page_path, element_selector order by n desc limit 10",
        "top_clicked_elements",
    )
    dead_rage_counts = _run_stats_query(
        access_token,
        project_ref,
        "select page_path, element_selector, event_type, count(*) as n "
        "from public._meero_behavior_events "
        f"where event_type in ('dead_click', 'rage_click') and created_at > {since} "
        "group by page_path, element_selector, event_type order by n desc limit 20",
        "dead_rage_counts",
    )
    # Ordered by first occurrence, not alphabetically, so funnel steps read
    # in the order visitors actually move through them (signup_start before
    # signup_complete), not by whatever order GROUP BY happens to return.
    funnel_steps = _run_stats_query(
        access_token,
        project_ref,
        "select element_selector as step, count(distinct session_id) as n, "
        "min(created_at) as first_seen "
        "from public._meero_behavior_events "
        f"where event_type = 'funnel_event' and created_at > {since} "
        "group by element_selector order by first_seen asc",
        "funnel_steps",
    )

    return {
        "sessions_by_day": sessions_by_day,
        "views_by_page": views_by_page,
        "device_breakdown": device_breakdown,
        "scroll_depth_distribution": scroll_depth_distribution,
        "top_clicked_elements": top_clicked_elements,
        "dead_rage_counts": dead_rage_counts,
        "funnel_steps": funnel_steps,
    }


def fetch_conversion_kpis(access_token: str, project_ref: str, since_iso: str) -> dict[str, Any]:
    """Real, session-level KPI summary — bounce rate and average session
    duration, computed from the same raw _meero_behavior_events every other
    conversion feature reads, no new tracked fields required. `page_views`
    counts real page_view events per session; `engagement` counts any real
    click/scroll/form_submit — a session with one page view and zero
    engagement is a real bounce by the standard analytics definition.
    Returns raw counts, not pre-divided rates — the caller (main.py) divides,
    so a zero-session project gets an honest 0/0 rather than a SQL error."""
    since = _sql_str(since_iso)
    sql = (
        "with session_stats as ("
        "  select session_id,"
        "    count(*) filter (where event_type = 'page_view') as page_views,"
        "    count(*) filter (where event_type in ('click', 'scroll_depth', 'form_submit')) as engagement,"
        "    extract(epoch from (max(created_at) - min(created_at))) as duration_s"
        "  from public._meero_behavior_events"
        f"  where created_at > {since}"
        "  group by session_id"
        ") "
        "select count(*) as total_sessions,"
        "  coalesce(sum(page_views), 0) as total_page_views,"
        "  count(*) filter (where page_views <= 1 and engagement = 0) as bounced_sessions,"
        "  coalesce(avg(duration_s), 0) as avg_duration_s "
        "from session_stats"
    )
    rows = _run_stats_query(access_token, project_ref, sql, "conversion_kpis")
    if not rows:
        return {
            "total_sessions": 0,
            "total_page_views": 0,
            "bounced_sessions": 0,
            "avg_duration_s": 0.0,
        }
    row = rows[0]
    return {
        "total_sessions": int(row.get("total_sessions") or 0),
        "total_page_views": int(row.get("total_page_views") or 0),
        "bounced_sessions": int(row.get("bounced_sessions") or 0),
        "avg_duration_s": float(row.get("avg_duration_s") or 0.0),
    }


def fetch_page_breakdown(access_token: str, project_ref: str, since_iso: str) -> list[dict[str, Any]]:
    """Per-page real session counts and entry-page bounce rate — "entry
    page" (a session's own first real page_view) is the standard analytics
    definition of which page a bounce rate belongs to, not just any page
    that session happened to touch."""
    since = _sql_str(since_iso)
    sql = (
        "with first_page as ("
        "  select session_id, page_path,"
        "    row_number() over (partition by session_id order by created_at asc) as rn"
        "  from public._meero_behavior_events"
        f"  where event_type = 'page_view' and created_at > {since}"
        "),"
        "entry_pages as ("
        "  select session_id, page_path from first_page where rn = 1"
        "),"
        "session_totals as ("
        "  select session_id,"
        "    count(*) filter (where event_type = 'page_view') as page_views,"
        "    count(*) filter (where event_type in ('click', 'scroll_depth', 'form_submit')) as engagement"
        "  from public._meero_behavior_events"
        f"  where created_at > {since}"
        "  group by session_id"
        ") "
        "select e.page_path, count(*) as sessions,"
        "  count(*) filter (where t.page_views <= 1 and t.engagement = 0) as bounced "
        "from entry_pages e join session_totals t using (session_id) "
        "group by e.page_path order by sessions desc limit 15"
    )
    return _run_stats_query(access_token, project_ref, sql, "page_breakdown")


def fetch_exit_pages(access_token: str, project_ref: str, since_iso: str) -> list[dict[str, Any]]:
    """Which page each session's LAST real page_view was on — a real "where
    do visitors leave" signal, distinct from a funnel drop-off between two
    named steps (this needs no funnel_event instrumentation at all, so it
    works for every app, not just ones with named funnel milestones)."""
    since = _sql_str(since_iso)
    sql = (
        "with last_page as ("
        "  select session_id, page_path,"
        "    row_number() over (partition by session_id order by created_at desc) as rn"
        "  from public._meero_behavior_events"
        f"  where event_type = 'page_view' and created_at > {since}"
        ") "
        "select page_path, count(*) as sessions "
        "from last_page where rn = 1 "
        "group by page_path order by sessions desc limit 10"
    )
    return _run_stats_query(access_token, project_ref, sql, "exit_pages")


def fetch_device_conversion(access_token: str, project_ref: str, since_iso: str) -> list[dict[str, Any]]:
    """Sessions and a real generic "conversion" signal (a funnel_event or a
    form_submit — the two event types that mean a visitor actually completed
    something, as opposed to just browsing) per device_type. Powers both the
    device_gap detector and the KPI dashboard's device breakdown."""
    since = _sql_str(since_iso)
    sql = (
        "with session_device as ("
        "  select session_id, min(device_type) as device_type"
        "  from public._meero_behavior_events"
        f"  where created_at > {since}"
        "  group by session_id"
        "),"
        "conversions as ("
        "  select distinct session_id"
        "  from public._meero_behavior_events"
        f"  where event_type in ('funnel_event', 'form_submit') and created_at > {since}"
        ") "
        "select d.device_type, count(*) as sessions,"
        "  count(*) filter (where c.session_id is not null) as converted "
        "from session_device d left join conversions c using (session_id) "
        "group by d.device_type"
    )
    return _run_stats_query(access_token, project_ref, sql, "device_conversion")


def fetch_experiment_counts_by_device(
    access_token: str, project_ref: str, experiment_key: str, since_iso: str
) -> list[dict[str, Any]]:
    """Same real exposure/conversion counts as fetch_experiment_counts, but
    segmented by device_type — powers the per-experiment "does this actually
    help mobile as much as desktop" breakdown. COUNT DISTINCT session_id,
    same reasoning as fetch_experiment_counts (one exposure/conversion per
    session, never per raw event row)."""
    since = _sql_str(since_iso)
    key = _sql_str(experiment_key)
    sql = (
        "select device_type, variant, event_type, count(distinct session_id) as n "
        "from public._meero_behavior_events "
        f"where experiment_key = {key} "
        "and event_type in ('experiment_exposure', 'experiment_conversion') "
        f"and created_at > {since} "
        "group by device_type, variant, event_type"
    )
    return _run_stats_query(access_token, project_ref, sql, "experiment_counts_by_device")


def fetch_pending_emails(
    access_token: str, project_ref: str, limit: int = 25
) -> list[dict[str, Any]]:
    """Reads real `status = 'pending'` rows from the generated app's own
    `_meero_emails` table (see MEERO_EMAILS_TABLE in codegen.py) — the
    Management API runs as the database owner and bypasses RLS, same as
    fetch_runtime_errors. Returns [] (never raises) for an app that doesn't
    have this table — most apps don't need transactional email at all."""
    sql = (
        "select id, to_email, subject, body "
        "from public._meero_emails "
        "where status = 'pending' "
        f"order by created_at asc limit {int(limit)}"
    )
    try:
        rows = run_query(access_token, project_ref, sql)
    except SupabaseConnectError as exc:
        if "does not exist" in str(exc).lower() or "relation" in str(exc).lower():
            return []
        log.warning("Could not read pending emails for %s: %s", project_ref, exc)
        return []
    return rows if isinstance(rows, list) else []


def count_recent_sent_emails(
    access_token: str, project_ref: str, since_hours: int = 1
) -> int:
    """Real count of `status = 'sent'` rows in the last `since_hours` — the
    per-project rate-limit backstop (Settings.email_rate_limit_per_project_per_hour)
    reads directly off this real data instead of tracking separate state."""
    sql = (
        "select count(*) as n from public._meero_emails "
        f"where status = 'sent' and created_at > now() - interval '{int(since_hours)} hours'"
    )
    try:
        rows = run_query(access_token, project_ref, sql)
    except SupabaseConnectError:
        return 0
    if isinstance(rows, list) and rows:
        return int(rows[0].get("n") or 0)
    return 0


def mark_email_status(
    access_token: str, project_ref: str, email_id: str, status: str
) -> None:
    """Writes the real send outcome back onto the app's own row — 'sent' or
    'failed'. Deliberately only touches `status` (never a provider-error
    column that isn't in the required schema shape — MEERO_EMAILS_TABLE in
    codegen.py — since an UPDATE naming an unknown column fails the WHOLE
    statement in Postgres, which would silently leave a failed send stuck
    on 'pending' forever instead of recording the real outcome). The actual
    provider error is logged server-side by the caller. Best-effort: a
    failure to write the status back must never crash the poller loop."""
    sql = (
        f"update public._meero_emails set status = {_sql_str(status)} "
        f"where id = {_sql_str(str(email_id))}"
    )
    try:
        run_query(access_token, project_ref, sql)
    except SupabaseConnectError as exc:
        log.warning("Could not update email status for %s: %s", project_ref, exc)


def disable_email_confirm(access_token: str, project_ref: str) -> None:
    """Turns off signup email confirmation on the linked project so the
    generated app's real Supabase Auth sessions work instantly (v1 product
    decision — documented in README). Best-effort: a failure logs and moves
    on, since the link itself is still fully usable."""
    try:
        response = httpx.patch(
            f"{SUPABASE_API}/v1/projects/{project_ref}/config/auth",
            headers=_headers(access_token),
            json={"mailer_autoconfirm": True},
            timeout=30,
        )
        if response.status_code >= 300:
            log.warning(
                "Couldn't disable email confirm on %s (%s): %s",
                project_ref,
                response.status_code,
                response.text[:200],
            )
    except httpx.HTTPError as exc:
        log.warning("Couldn't reach Supabase auth config for %s: %s", project_ref, exc)

"""Meero's autonomous conversion optimization agent — the background agent
that detects likely conversion issues from real visitor behavior (dead
clicks, CTA below fold, form abandonment, funnel drop-off) and runs REAL
verified client-bucketed A/B experiments to fix them, no human click
required in Solo mode.

Unlike app/runtime_monitor.py (which watches every Supabase-linked project),
this agent is fully opt-in per project (projects.conversion_agent_enabled,
off by default) — see 00042_conversion_agent.sql. The required behavior
tracker (components/meero-behavior-tracker.tsx) records regardless of this
toggle, exactly like the error reporter does; this module only decides
whether to ANALYZE and ACT on what it recorded.

Three passes run every poll cycle, in order, for every enabled project:
  1. Detection (_maybe_detect_project) — turns real behavior_events patterns
     into conversion_hypotheses rows.
  2. Launch (_maybe_launch_experiment) — turns the best open hypothesis into
     a real codegen build that ships BOTH variants, client-bucketed, in one
     static export (see components/meero-behavior-tracker.tsx's
     getExperimentVariant).
  3. Evaluation (_evaluate_running_experiments) — a genuinely new two-stage
     lifecycle runtime_monitor.py has no precedent for (that module is
     launch-verify-done, single-shot): checks running experiments for
     enough data + a real statistical significance test, then queues a
     graduation (keep the winner) or revert (keep the original) build.

Fix mechanics are reused as-is throughout: same db.create_conversion_experiment_build
shape (mirrors db.create_runtime_fix_build), same CODEGEN_QUEUE job shape
(fix_of pointing at the build to regenerate from), same codegen_worker.py
fix_project path — nothing about HOW a fix is generated changes here, only
WHAT prompt is fed and WHY it fires.
"""

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any

from app.infrastructure.database import db
from app.config import CONVERSION_EXPERIMENT_COST, get_settings
from app.infrastructure.queues.queues import CODEGEN_QUEUE, enqueue, publish_event
from app.infrastructure.supabase.supabase_connect import (
    SupabaseConnectError,
    fetch_behavior_events,
    fetch_experiment_counts,
    fetch_session_count,
    fresh_access_token,
)

log = logging.getLogger("meero.conversion_agent")

# --------------------------------------------------------------------------
# Bot filtering — no IP capture is architecturally possible (generated apps
# are static exports with no server layer, so client-side telemetry is all
# there is). These heuristics run on event PATTERNS, applied here at
# aggregation time — never by dropping raw events client-side, so telemetry
# stays complete for debugging but decisions ignore likely-bot sessions.
# Hardcoded (not config.py settings): an implementation detail of the
# filtering algorithm itself, not a per-deployment tunable.
# --------------------------------------------------------------------------

_BOT_SESSION_MAX_EVENTS_PER_10S = 30
_BOT_SESSION_MIN_DWELL_MS = 500
_BOT_SESSION_MIN_DWELL_EVENT_COUNT = 5


def _parse_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _filter_bot_sessions(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Excludes events belonging to sessions that look like a bot/scraper:
    an implausibly high event rate in a short window, or a whole session
    crammed into under half a second. Real humans don't click/scroll that
    fast; headless scrapers and crawlers do."""
    by_session: dict[str, list[dict[str, Any]]] = {}
    for e in events:
        sid = e.get("session_id")
        if not sid:
            continue
        by_session.setdefault(sid, []).append(e)

    bad_sessions: set[str] = set()
    for sid, rows in by_session.items():
        timestamps = sorted(t for t in (_parse_ts(r.get("created_at")) for r in rows) if t)
        if not timestamps:
            continue
        # Velocity filter: any 10-second window with too many events.
        for i, t in enumerate(timestamps):
            window_end = t + timedelta(seconds=10)
            count = sum(1 for other in timestamps[i:] if other <= window_end)
            if count > _BOT_SESSION_MAX_EVENTS_PER_10S:
                bad_sessions.add(sid)
                break
        # Zero-dwell filter: whole session crammed into under 500ms.
        if (
            sid not in bad_sessions
            and len(timestamps) >= _BOT_SESSION_MIN_DWELL_EVENT_COUNT
            and (timestamps[-1] - timestamps[0]) < timedelta(milliseconds=_BOT_SESSION_MIN_DWELL_MS)
        ):
            bad_sessions.add(sid)

    if bad_sessions:
        log.info("conversion agent: filtered %d likely-bot session(s)", len(bad_sessions))
    return [e for e in events if e.get("session_id") not in bad_sessions]


# --------------------------------------------------------------------------
# Detection — one function per issue type. Each groups the (already
# bot-filtered) event window and returns zero-or-one candidate hypothesis.
# Thresholds here are tunable heuristics, not load-bearing correctness —
# _detect_cta_below_fold_or_low_ctr especially so (documented inline).
# --------------------------------------------------------------------------


def _detect_dead_clicks(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    groups: dict[tuple[str, str], set[str]] = {}
    for e in events:
        if e.get("event_type") != "dead_click":
            continue
        key = (e.get("page_path") or "", e.get("element_selector") or "")
        groups.setdefault(key, set()).add(e.get("session_id") or "")
    best = None
    for (page_path, selector), sessions in groups.items():
        occurrences = sum(
            1
            for e in events
            if e.get("event_type") == "dead_click"
            and e.get("page_path") == page_path
            and e.get("element_selector") == selector
        )
        if occurrences >= 10 and len(sessions) >= 5:
            if best is None or occurrences > best[0]:
                best = (occurrences, page_path, selector, len(sessions))
    if best is None:
        return None
    occurrences, page_path, selector, session_count = best
    return {
        "issue_type": "dead_click",
        "page_path": page_path,
        "element_selector": selector,
        "description": (
            f"Visitors click on '{selector}' on {page_path} as if it were "
            f"interactive, but it isn't — {occurrences} dead clicks across "
            f"{session_count} sessions."
        ),
        "proposed_fix": (
            f"Make '{selector}' a real interactive element (a link or button "
            "with a working action), or remove whatever styling makes it look "
            "clickable."
        ),
        "evidence": {"occurrences": occurrences, "sessions": session_count},
    }


def _detect_rage_clicks(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    groups: dict[tuple[str, str], set[str]] = {}
    for e in events:
        if e.get("event_type") != "rage_click":
            continue
        key = (e.get("page_path") or "", e.get("element_selector") or "")
        groups.setdefault(key, set()).add(e.get("session_id") or "")
    best = None
    for (page_path, selector), sessions in groups.items():
        occurrences = sum(
            1
            for e in events
            if e.get("event_type") == "rage_click"
            and e.get("page_path") == page_path
            and e.get("element_selector") == selector
        )
        if occurrences >= 5 and len(sessions) >= 3:
            if best is None or occurrences > best[0]:
                best = (occurrences, page_path, selector, len(sessions))
    if best is None:
        return None
    occurrences, page_path, selector, session_count = best
    return {
        "issue_type": "rage_click",
        "page_path": page_path,
        "element_selector": selector,
        "description": (
            f"Visitors repeatedly click '{selector}' on {page_path} in rapid "
            f"succession — {occurrences} rage-click bursts across "
            f"{session_count} sessions, a strong signal it feels broken or "
            "unresponsive."
        ),
        "proposed_fix": (
            f"Check '{selector}' for a missing loading state, a slow handler, "
            "or a click target that's too small — add clear visual feedback "
            "on click."
        ),
        "evidence": {"occurrences": occurrences, "sessions": session_count},
    }


def _detect_form_abandonment(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    starts: dict[tuple[str, str], set[str]] = {}
    submits: dict[tuple[str, str], set[str]] = {}
    for e in events:
        key = (e.get("page_path") or "", e.get("element_selector") or "")
        sid = e.get("session_id") or ""
        if e.get("event_type") == "form_start":
            starts.setdefault(key, set()).add(sid)
        elif e.get("event_type") == "form_submit":
            submits.setdefault(key, set()).add(sid)
    best = None
    for key, start_sessions in starts.items():
        if len(start_sessions) < 20:
            continue
        completed = len(submits.get(key, set()) & start_sessions)
        rate = completed / len(start_sessions)
        if rate < 0.3:
            if best is None or len(start_sessions) > best[0]:
                best = (len(start_sessions), key, rate)
    if best is None:
        return None
    start_count, (page_path, selector), rate = best
    return {
        "issue_type": "form_abandonment",
        "page_path": page_path,
        "element_selector": selector,
        "description": (
            f"Only {rate:.0%} of the {start_count} sessions that started the "
            f"'{selector}' form on {page_path} actually submitted it."
        ),
        "proposed_fix": (
            "Simplify or shorten this form (fewer required fields, clearer "
            "labels), and add inline validation feedback instead of a "
            "post-submit error."
        ),
        "evidence": {"starts": start_count, "completion_rate": rate},
    }


def _detect_cta_below_fold_or_low_ctr(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The fuzziest detector — a heuristic, not exact science. Compares, per
    (page_path, element_selector) among sessions that scrolled to 100% of
    the page, the share that actually clicked that element vs. merely saw
    it. A low click share among fully-scrolled sessions suggests the
    element (often the primary CTA) isn't landing, whether because it's
    positioned poorly or just isn't compelling. Treat the exact 15%
    threshold as tunable, not load-bearing correctness."""
    fully_scrolled_sessions: set[str] = {
        e.get("session_id") or ""
        for e in events
        if e.get("event_type") == "scroll_depth" and e.get("scroll_depth") == 100
    }
    if len(fully_scrolled_sessions) < 20:
        return None
    clicks: dict[tuple[str, str], set[str]] = {}
    for e in events:
        if e.get("event_type") != "click":
            continue
        sid = e.get("session_id") or ""
        if sid not in fully_scrolled_sessions:
            continue
        key = (e.get("page_path") or "", e.get("element_selector") or "")
        clicks.setdefault(key, set()).add(sid)
    best = None
    for (page_path, selector), clicking_sessions in clicks.items():
        ctr = len(clicking_sessions) / len(fully_scrolled_sessions)
        if ctr < 0.15:
            if best is None or len(fully_scrolled_sessions) > best[0]:
                best = (len(fully_scrolled_sessions), page_path, selector, ctr)
    if best is None:
        return None
    total, page_path, selector, ctr = best
    return {
        "issue_type": "low_ctr",
        "page_path": page_path,
        "element_selector": selector,
        "description": (
            f"Only {ctr:.0%} of visitors who scrolled all the way through "
            f"{page_path} clicked '{selector}' — it may be positioned below "
            "the fold, easy to miss, or not compelling enough."
        ),
        "proposed_fix": (
            f"Move '{selector}' higher on the page, make it visually more "
            "prominent, or strengthen its copy."
        ),
        "evidence": {"fully_scrolled_sessions": total, "click_through_rate": ctr},
    }


def _detect_pricing_signup_drop_off(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Funnel step pairs (funnel_event names, in the order first observed
    per session) with a steep drop-off between two consecutive steps."""
    order: list[str] = []
    step_sessions: dict[str, set[str]] = {}
    for e in events:
        if e.get("event_type") != "funnel_event":
            continue
        name = e.get("element_selector") or ""
        if not name:
            continue
        if name not in step_sessions:
            order.append(name)
            step_sessions[name] = set()
        step_sessions[name].add(e.get("session_id") or "")

    best = None
    for earlier, later in zip(order, order[1:]):
        earlier_sessions = step_sessions[earlier]
        if len(earlier_sessions) < 20:
            continue
        later_sessions = step_sessions[later]
        continued = len(earlier_sessions & later_sessions)
        drop_off = 1 - (continued / len(earlier_sessions))
        if drop_off > 0.7:
            if best is None or len(earlier_sessions) > best[0]:
                best = (len(earlier_sessions), earlier, later, drop_off)
    if best is None:
        return None
    earlier_count, earlier, later, drop_off = best
    issue_type = (
        "signup_drop_off" if "signup" in earlier.lower() else "pricing_drop_off"
    )
    return {
        "issue_type": issue_type,
        "page_path": "",
        "element_selector": None,
        "description": (
            f"{drop_off:.0%} of the {earlier_count} sessions that reached "
            f"'{earlier}' never reached '{later}'."
        ),
        "proposed_fix": (
            f"Reduce friction between '{earlier}' and '{later}' — fewer "
            "steps, clearer next action, or address likely hesitations "
            "(pricing clarity, trust signals) right at that point."
        ),
        "evidence": {"earlier_sessions": earlier_count, "drop_off": drop_off},
        "goal_event": later,
    }


def _session_summaries(
    events: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Shared per-session rollup for the three detectors below — entry page
    (first real page_view), exit page (last real page_view), total page
    views, whether the session showed any real engagement (click/scroll/
    form), and its device_type. Computed once and reused by all three
    rather than each re-scanning the same event list independently."""
    by_session: dict[str, list[dict[str, Any]]] = {}
    for e in events:
        sid = e.get("session_id") or ""
        if not sid:
            continue
        by_session.setdefault(sid, []).append(e)

    summaries: dict[str, dict[str, Any]] = {}
    for sid, rows in by_session.items():
        # ISO-8601 timestamps sort correctly as plain strings, so this
        # avoids mixing datetime and str in one sort key (a row with no
        # created_at would otherwise raise trying to compare the two types).
        page_views = [
            r for r in sorted(rows, key=lambda r: r.get("created_at") or "")
            if r.get("event_type") == "page_view"
        ]
        engagement = sum(
            1 for r in rows if r.get("event_type") in ("click", "scroll_depth", "form_submit")
        )
        device_types = [r.get("device_type") for r in rows if r.get("device_type")]
        summaries[sid] = {
            "entry_page": page_views[0].get("page_path") if page_views else None,
            "exit_page": page_views[-1].get("page_path") if page_views else None,
            "page_view_count": len(page_views),
            "engaged": engagement > 0,
            "device_type": device_types[0] if device_types else "unknown",
            "converted": any(
                r.get("event_type") in ("funnel_event", "form_submit") for r in rows
            ),
        }
    return summaries


def _detect_high_bounce_page(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """A specific page whose entry-session bounce rate (one page view, zero
    engagement, then gone) is far above the app's own other pages — not an
    absolute threshold, since what's "normal" varies a lot by app; this
    flags a page that's a real outlier relative to its own siblings."""
    sessions = _session_summaries(events)
    by_page: dict[str, list[bool]] = {}
    for s in sessions.values():
        if not s["entry_page"]:
            continue
        bounced = s["page_view_count"] <= 1 and not s["engaged"]
        by_page.setdefault(s["entry_page"], []).append(bounced)

    if len(by_page) < 2:
        # A single-page app has nothing to compare against — "high relative
        # to what?" has no honest answer here.
        return None

    site_bounces = sum(sum(v) for v in by_page.values())
    site_total = sum(len(v) for v in by_page.values())
    if site_total < 20:
        return None
    site_rate = site_bounces / site_total

    best = None
    for page, bounces in by_page.items():
        if len(bounces) < 20:
            continue
        rate = sum(bounces) / len(bounces)
        # Both a real absolute floor (>50%) and a real relative one (at
        # least 20 points above the rest of the app) — a page that bounces
        # at 55% on an app that bounces at 52% everywhere isn't an outlier.
        if rate > 0.5 and rate - site_rate > 0.2:
            if best is None or len(bounces) > best[1]:
                best = (page, len(bounces), rate)
    if best is None:
        return None
    page, sessions_count, rate = best
    return {
        "issue_type": "high_bounce",
        "page_path": page,
        "element_selector": None,
        "description": (
            f"{rate:.0%} of the {sessions_count} sessions landing on {page} "
            f"leave without any further interaction — well above this "
            f"app's own {site_rate:.0%} average."
        ),
        "proposed_fix": (
            f"Make {page}'s first screen earn a second action faster — a "
            "clearer headline, a more obvious next step, or less to read "
            "before the value is clear."
        ),
        "evidence": {"sessions": sessions_count, "bounce_rate": rate, "site_bounce_rate": site_rate},
        "goal_event": "scroll_depth",
    }


def _detect_exit_page(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The page sessions most commonly END on — a real "where do visitors
    leave" signal that needs no named funnel steps (unlike
    _detect_pricing_signup_drop_off), so it works for every app."""
    sessions = _session_summaries(events)
    # Real page diversity, not just entry-page diversity — a single-page
    # app trivially has one possible "exit page" even though every session
    # might enter and later navigate around client-side in a way that never
    # shows a second entry. What matters here is whether there's more than
    # one place to actually exit FROM.
    distinct_pages = {s["exit_page"] for s in sessions.values() if s["exit_page"]}
    if len(distinct_pages) < 2:
        return None

    exit_counts: dict[str, int] = {}
    total = 0
    for s in sessions.values():
        if not s["exit_page"]:
            continue
        exit_counts[s["exit_page"]] = exit_counts.get(s["exit_page"], 0) + 1
        total += 1
    if total < 20:
        return None

    page, count = max(exit_counts.items(), key=lambda kv: kv[1])
    share = count / total
    if share < 0.5:
        return None
    return {
        "issue_type": "exit_page",
        "page_path": page,
        "element_selector": None,
        "description": (
            f"{share:.0%} of sessions with more than one page end on {page} "
            "— the single most common place visitors leave the app."
        ),
        "proposed_fix": (
            f"Give {page} a clear next action for someone who's about to "
            "leave — a related link, a summary of what they'd get by "
            "continuing, or whatever the natural next step in your app is."
        ),
        "evidence": {"sessions": total, "exit_share": share},
        "goal_event": "click",
    }


def _detect_device_conversion_gap(events: list[dict[str, Any]]) -> dict[str, Any] | None:
    """A real, substantial conversion-rate gap between mobile and desktop
    sessions — 'conversion' here is the same generic signal used elsewhere
    in this file when there's no single named goal: a funnel_event or a
    form_submit, whichever a session has. Only compares mobile vs desktop
    (tablet/unknown are real device_type values but too low-volume in most
    apps to say anything meaningful about on their own)."""
    sessions = _session_summaries(events)
    by_device: dict[str, list[bool]] = {}
    for s in sessions.values():
        if s["device_type"] not in ("mobile", "desktop"):
            continue
        by_device.setdefault(s["device_type"], []).append(s["converted"])

    mobile = by_device.get("mobile", [])
    desktop = by_device.get("desktop", [])
    if len(mobile) < 20 or len(desktop) < 20:
        return None

    mobile_rate = sum(mobile) / len(mobile)
    desktop_rate = sum(desktop) / len(desktop)
    higher, lower = max(mobile_rate, desktop_rate), min(mobile_rate, desktop_rate)
    if higher <= 0 or lower / higher > 0.5:
        # Less than a 2x relative gap isn't a strong enough signal to act
        # on — real device performance naturally varies some.
        return None
    worse_device = "mobile" if mobile_rate < desktop_rate else "desktop"
    return {
        "issue_type": "device_gap",
        "page_path": "",
        "element_selector": None,
        "description": (
            f"{worse_device.capitalize()} sessions convert at {lower:.1%} vs. "
            f"{higher:.1%} on {'desktop' if worse_device == 'mobile' else 'mobile'} "
            f"— {len(mobile)} mobile and {len(desktop)} desktop sessions measured."
        ),
        "proposed_fix": (
            f"Check the {worse_device} layout specifically for a broken or "
            "awkward step in the main flow — tap targets too small, a form "
            "that's hard to fill on a small screen, or content that only "
            "renders well at desktop width."
        ),
        "evidence": {
            "mobile_sessions": len(mobile),
            "desktop_sessions": len(desktop),
            "mobile_rate": mobile_rate,
            "desktop_rate": desktop_rate,
        },
        "goal_event": "click",
    }


_DETECTORS = (
    _detect_dead_clicks,
    _detect_rage_clicks,
    _detect_form_abandonment,
    _detect_cta_below_fold_or_low_ctr,
    _detect_pricing_signup_drop_off,
    _detect_high_bounce_page,
    _detect_exit_page,
    _detect_device_conversion_gap,
)


def _dedupe_hypotheses(
    project_id: str, candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Never create a duplicate hypothesis for an issue that's already
    open/experimenting for this project."""
    existing = db.list_open_conversion_hypotheses(project_id)
    existing_keys = {
        (h.get("issue_type"), h.get("page_path"), h.get("element_selector"))
        for h in existing
    }
    survivors = []
    for c in candidates:
        key = (c.get("issue_type"), c.get("page_path"), c.get("element_selector"))
        if key in existing_keys:
            continue
        survivors.append(c)
    return survivors


def _maybe_detect_project(project_row: dict[str, Any]) -> None:
    """Real gating chain — detection is fully gated by
    conversion_agent_enabled (unlike runtime_monitor, where detection always
    runs); this is a fundamentally opt-in feature."""
    project_id = project_row["id"]
    project = db.get_project(project_id)
    if project is None or not project.get("conversion_agent_enabled"):
        return
    if db.get_latest_succeeded_build(project_id) is None:
        return

    ref = project.get("supabase_project_ref")
    if not ref:
        return

    settings = get_settings()
    try:
        access_token = fresh_access_token(project["owner_id"])
    except SupabaseConnectError:
        log.warning("conversion agent: could not refresh access token for %s", project_id)
        return

    since = (
        datetime.now(timezone.utc)
        - timedelta(days=settings.conversion_agent_traffic_window_days)
    ).isoformat()
    events = fetch_behavior_events(access_token, ref, since)
    if not events:
        return
    events = _filter_bot_sessions(events)
    if not events:
        return

    candidates: list[dict[str, Any]] = []
    for detector in _DETECTORS:
        result = detector(events)
        if result is not None:
            candidates.append(result)

    survivors = _dedupe_hypotheses(project_id, candidates)
    survivors = survivors[: settings.conversion_agent_max_hypotheses_per_batch]

    for c in survivors:
        # A detector's own goal_event (e.g. the specific next funnel step a
        # drop-off hypothesis should be measured against) has to travel
        # inside `evidence` — create_conversion_hypothesis has no separate
        # column for it, and _goal_event_for() reads it back from exactly
        # this spot. Without this, every hypothesis silently fell back to
        # the generic "click" goal at launch time regardless of what the
        # detector actually intended.
        evidence = dict(c.get("evidence") or {})
        if c.get("goal_event"):
            evidence["goal_event"] = c["goal_event"]
        hyp = db.create_conversion_hypothesis(
            project_id=project_id,
            issue_type=c["issue_type"],
            page_path=c["page_path"],
            element_selector=c.get("element_selector"),
            description=c["description"],
            proposed_fix=c["proposed_fix"],
            evidence=evidence,
        )
        publish_event(
            {
                "type": "conversion.hypothesis_detected",
                "project_id": project_id,
                "hypothesis_id": hyp["id"],
                "issue_type": hyp["issue_type"],
                "description": hyp["description"],
            }
        )


# --------------------------------------------------------------------------
# Launch — turns the best open hypothesis into a real client-bucketed A/B
# experiment build.
# --------------------------------------------------------------------------


_GOAL_EVENT_BY_ISSUE_TYPE = {
    "cta_below_fold": "click",
    "low_ctr": "click",
    "dead_click": "click",
    "rage_click": "click",
    "form_abandonment": "form_submit",
}


def _goal_event_for(hypothesis: dict[str, Any]) -> str:
    evidence_goal = (hypothesis.get("evidence") or {}).get("goal_event")
    if evidence_goal:
        # Funnel drop-off hypotheses carry their own goal (the later step).
        return str(evidence_goal)
    return _GOAL_EVENT_BY_ISSUE_TYPE.get(hypothesis["issue_type"], "click")


def _experiment_key_for(hypothesis_id: str) -> str:
    return f"exp_{hypothesis_id.replace('-', '')[:12]}"


def _experiment_codegen_prompt(
    hypothesis: dict[str, Any], experiment_key: str, goal_event: str
) -> str:
    return (
        "Run a client-bucketed A/B experiment on this app to test a "
        "conversion-optimization hypothesis, detected from real visitor "
        "behavior.\n\n"
        f"Hypothesis: {hypothesis['description']}\n"
        f"Proposed fix (variant B): {hypothesis['proposed_fix']}\n\n"
        "Implementation requirements:\n"
        f"1. In the affected component(s) near page '{hypothesis['page_path']}'"
        + (
            f" / element '{hypothesis['element_selector']}'"
            if hypothesis.get("element_selector")
            else ""
        )
        + ", import getExperimentVariant, trackExperimentExposure, "
        "trackExperimentConversion from @/components/meero-behavior-tracker.\n"
        f"2. At the top of the component, call `const variant = "
        f"getExperimentVariant('{experiment_key}')` and render the EXISTING "
        "UI when variant === 'a', and the proposed-fix UI when variant === "
        "'b'. Both variants must be fully functional, styled, and "
        "production-ready — never a stub.\n"
        "3. Call trackExperimentExposure with the experiment key and variant "
        "once when the component mounts.\n"
        f"4. Call trackExperimentConversion with the experiment key and "
        f"variant at the exact point '{goal_event}' already fires in this "
        "app's existing tracking — reuse that call site, do not add a new "
        "listener.\n"
        "5. Do not change any other unrelated behavior in the app."
    )


def _has_enough_traffic(access_token: str, ref: str, settings: Any) -> bool:
    since = (
        datetime.now(timezone.utc)
        - timedelta(days=settings.conversion_agent_traffic_window_days)
    ).isoformat()
    sessions = fetch_session_count(access_token, ref, since)
    return sessions >= settings.conversion_agent_min_sessions_before_experiment


def _launch_experiment(project: dict[str, Any], hypothesis: dict[str, Any]) -> None:
    project_id = project["id"]
    latest_build = db.get_latest_succeeded_build(project_id)
    if latest_build is None:
        return

    experiment_key = _experiment_key_for(hypothesis["id"])
    goal_event = _goal_event_for(hypothesis)
    prompt_text = _experiment_codegen_prompt(hypothesis, experiment_key, goal_event)

    experiment = db.create_conversion_experiment(
        project_id=project_id,
        hypothesis_id=hypothesis["id"],
        experiment_key=experiment_key,
        goal_event=goal_event,
    )
    build = db.create_conversion_experiment_build(
        experiment=experiment,
        base_build=latest_build,
        action="launch",
        prompt_text=prompt_text,
    )
    db.set_conversion_hypothesis_status(hypothesis["id"], "experimenting")
    enqueue(CODEGEN_QUEUE, {"build_id": build["id"], "fix_of": latest_build["id"]})
    db.charge_credits(project["owner_id"], CONVERSION_EXPERIMENT_COST)
    publish_event(
        {
            "type": "conversion.experiment_launched",
            "project_id": project_id,
            "hypothesis_id": hypothesis["id"],
            "experiment_id": experiment["id"],
            "experiment_key": experiment_key,
        }
    )


def _maybe_launch_experiment(project_row: dict[str, Any]) -> None:
    """Real gating chain, checked in order — mirrors
    runtime_monitor._maybe_fix_project's short-circuit style."""
    project_id = project_row["id"]
    project = db.get_project(project_id)
    if project is None or not project.get("conversion_agent_enabled"):
        return
    if project.get("autonomy_mode") == "manual":
        # Detection still surfaced the hypothesis; a human must click
        # "Launch experiment" (POST /projects/{id}/conversion/hypotheses/{id}/launch).
        return

    open_hypotheses = [
        h for h in db.list_open_conversion_hypotheses(project_id) if h["status"] == "open"
    ]
    if not open_hypotheses:
        return
    hypothesis = open_hypotheses[0]

    if db.has_in_flight_conversion_experiment(project_id):
        return

    settings = get_settings()
    if (
        db.count_recent_conversion_experiments(
            project_id, days=7
        )
        >= settings.conversion_agent_max_experiments_per_project_per_week
    ):
        return

    ref = project.get("supabase_project_ref")
    if not ref:
        return
    try:
        access_token = fresh_access_token(project["owner_id"])
    except SupabaseConnectError:
        return
    if not _has_enough_traffic(access_token, ref, settings):
        # Not enough traffic yet — the hypothesis stays open, retried next pass.
        return

    credit = db.credits_available(project["owner_id"])
    if not credit.get("allowed"):
        return

    _launch_experiment(project, hypothesis)


# --------------------------------------------------------------------------
# Launch verification — called from web_worker.py right after a launch
# build's own readiness checks run. Same tri-state "passed" convention as
# runtime_monitor.evaluate_and_publish.
# --------------------------------------------------------------------------


def mark_experiment_live(
    project: dict[str, Any],
    build_id: str,
    build_row: dict[str, Any],
    checks: list[dict[str, Any]] | None,
) -> None:
    experiment_id = build_row.get("conversion_experiment_id")
    if not experiment_id:
        return
    passed = checks is not None and all(c.get("passed") is not False for c in checks)
    if passed:
        publish_event(
            {
                "type": "conversion.experiment_live",
                "project_id": project["id"],
                "experiment_id": experiment_id,
                "build_id": build_id,
            }
        )
        return
    _revert_unlaunched_experiment(project["id"], experiment_id, build_id)


def mark_launch_failed(project_id: str, build_id: str, experiment_id: str | None) -> None:
    """A launch build that never even reached readiness checks (a genuine
    compile/schema failure) — same revert-and-reopen handling as a build
    that compiled but failed verification. Publishing itself is delegated to
    _revert_unlaunched_experiment (the single place that fires
    conversion.experiment_launch_failed) so this and mark_experiment_live's
    failure branch never double-publish the same event."""
    if not experiment_id:
        return
    _revert_unlaunched_experiment(project_id, experiment_id, build_id)


def _revert_unlaunched_experiment(
    project_id: str, experiment_id: str, build_id: str | None = None
) -> None:
    """A launch build that never actually shipped a working variant never
    ran an experiment — mark it reverted immediately and reopen the
    hypothesis so it's eligible for a retry or a manual re-launch later,
    never left stuck on 'experimenting' forever. The single publisher of
    conversion.experiment_launch_failed — both callers above route through
    here rather than each publishing their own copy."""
    experiment = db.get_conversion_experiment(experiment_id)
    db.set_conversion_experiment_status(
        experiment_id, "reverted", decided_at=datetime.now(timezone.utc).isoformat()
    )
    if experiment:
        db.set_conversion_hypothesis_status(experiment["hypothesis_id"], "open")
    publish_event(
        {
            "type": "conversion.experiment_launch_failed",
            "project_id": project_id,
            "experiment_id": experiment_id,
            "build_id": build_id,
        }
    )


# --------------------------------------------------------------------------
# Evaluation — the one genuinely new state machine (no precedent in
# runtime_monitor.py, which is launch-verify-done, single-shot).
# --------------------------------------------------------------------------


def _two_proportion_z_test(counts: dict[str, int]) -> tuple[float | None, float | None]:
    """Standard two-proportion z-test (pooled variance), stdlib math only.
    Returns (p_value, lift_pct) — lift_pct is (rate_b - rate_a) / rate_a,
    expressed as a percentage. (None, None) if either variant has zero
    exposures (a rate can't be computed at all)."""
    n_a, n_b = counts["exposures_a"], counts["exposures_b"]
    c_a, c_b = counts["conversions_a"], counts["conversions_b"]
    if n_a == 0 or n_b == 0:
        return None, None
    p_a, p_b = c_a / n_a, c_b / n_b
    p_pool = (c_a + c_b) / (n_a + n_b)
    se = math.sqrt(p_pool * (1 - p_pool) * (1 / n_a + 1 / n_b))
    if se == 0:
        if p_a == p_b:
            return 1.0, 0.0
        lift = float("inf") if p_a == 0 else (p_b - p_a) / p_a * 100
        return 0.0, lift
    z = (p_b - p_a) / se
    p_value = 2 * (1 - 0.5 * (1 + math.erf(abs(z) / math.sqrt(2))))
    lift_pct = ((p_b - p_a) / p_a * 100) if p_a > 0 else (float("inf") if p_b > 0 else 0.0)
    return p_value, lift_pct


_Z_95 = 1.959964  # two-tailed 95% normal critical value, stdlib math has no inverse-CDF


def _lift_confidence_interval(counts: dict[str, int]) -> tuple[float | None, float | None]:
    """A real 95% confidence interval for lift_pct — p_value/lift_pct alone
    answer "is this significant and by roughly how much," but not "how
    precise is that estimate." Uses the UNPOOLED standard error for the
    proportion difference (the standard choice for a confidence interval,
    vs. the pooled SE _two_proportion_z_test uses for its null-hypothesis
    significance test — different questions, different conventional SE).
    The difference's own CI is converted to a lift-percentage CI by dividing
    through by p_a (a standard, honestly-approximate way to report a lift
    interval — a ratio of two random variables doesn't have a simple closed
    form, so this holds the reference rate p_a fixed like lift_pct itself
    already does). None, None under the same zero-exposure/zero-p_a
    conditions _two_proportion_z_test itself bails out on."""
    n_a, n_b = counts["exposures_a"], counts["exposures_b"]
    c_a, c_b = counts["conversions_a"], counts["conversions_b"]
    if n_a == 0 or n_b == 0:
        return None, None
    p_a, p_b = c_a / n_a, c_b / n_b
    if p_a == 0:
        return None, None
    se_diff = math.sqrt((p_a * (1 - p_a)) / n_a + (p_b * (1 - p_b)) / n_b)
    diff = p_b - p_a
    margin = _Z_95 * se_diff
    ci_low_pct = (diff - margin) / p_a * 100
    ci_high_pct = (diff + margin) / p_a * 100
    return ci_low_pct, ci_high_pct


def _graduate_or_revert(
    project: dict[str, Any], experiment: dict[str, Any], decision: str
) -> None:
    """A REAL follow-up build removing the branching/tracking scaffolding —
    either keeping variant B's UI permanently (winner_b) or reverting to
    variant A's original UI (winner_a/inconclusive). Same straight-to-main
    path as launch (web_worker.py's is_runtime_fix branch is never taken for
    conversion-experiment builds)."""
    project_id = project["id"]
    launch_build = db.get_build(experiment["launch_build_id"]) if experiment.get(
        "launch_build_id"
    ) else None
    if launch_build is None:
        log.warning(
            "conversion agent: no launch build found for experiment %s, cannot "
            "graduate/revert",
            experiment["id"],
        )
        return

    if decision == "winner_b":
        prompt_text = (
            f"The A/B experiment for '{experiment['experiment_key']}' concluded: "
            "variant B (the proposed fix) won with a statistically significant "
            "lift. Make variant B's UI the ONLY UI — remove the "
            "getExperimentVariant/branching logic entirely, remove the "
            "now-unneeded trackExperimentExposure/trackExperimentConversion "
            "calls for this experiment, and keep the fixed behavior "
            "permanently."
        )
        action = "graduate"
    else:
        prompt_text = (
            f"The A/B experiment for '{experiment['experiment_key']}' concluded "
            f"without variant B outperforming the original ({decision}). "
            "Revert to variant A's original UI as the ONLY UI — remove the "
            "getExperimentVariant/branching logic and the experiment "
            "tracking calls entirely."
        )
        action = "revert"

    build = db.create_conversion_experiment_build(
        experiment=experiment,
        base_build=launch_build,
        action=action,
        prompt_text=prompt_text,
    )
    enqueue(CODEGEN_QUEUE, {"build_id": build["id"], "fix_of": launch_build["id"]})
    db.charge_credits(project["owner_id"], CONVERSION_EXPERIMENT_COST)

    db.set_conversion_hypothesis_status(
        experiment["hypothesis_id"], "resolved" if decision == "winner_b" else "dismissed"
    )
    publish_event(
        {
            "type": (
                "conversion.experiment_graduated"
                if decision == "winner_b"
                else "conversion.experiment_reverted"
            ),
            "project_id": project_id,
            "experiment_id": experiment["id"],
            "build_id": build["id"],
        }
    )


_MAX_GRADUATION_ATTEMPTS = 3


def mark_graduation_failed(project_id: str, experiment_id: str, build_id: str) -> None:
    """A graduate/revert build that failed to even compile — called from
    web_worker.py's failure handlers exactly like mark_launch_failed above.
    Clears graduation_build_id so the experiment stops looking permanently
    "already applied" (see clear_conversion_experiment_graduation_build's
    docstring for why that early patch would otherwise strand it forever):
    the manual apply-decision endpoint becomes callable again immediately,
    and _retry_stuck_graduations below picks it up automatically in Solo
    mode on the next poll."""
    log.warning(
        "conversion agent: graduation/revert build %s failed for experiment %s",
        build_id,
        experiment_id,
    )
    db.clear_conversion_experiment_graduation_build(experiment_id)


def _retry_stuck_graduations(project_row: dict[str, Any]) -> None:
    """Solo-mode-only: re-attempts a decided experiment whose graduate/revert
    build never successfully queued-and-shipped (graduation_build_id null —
    either it failed, per mark_graduation_failed, or the process crashed
    between deciding and queuing). Manual mode deliberately does NOT auto-
    retry here — a human clicks "Keep this fix"/"Revert" again, same as the
    first time; auto-firing without that click would break Manual mode's
    entire contract. Bounded by _MAX_GRADUATION_ATTEMPTS so a build that
    keeps genuinely failing can't loop forever burning credits every poll."""
    project_id = project_row["id"]
    project = db.get_project(project_id)
    if project is None or not project.get("conversion_agent_enabled"):
        return
    if project.get("autonomy_mode") == "manual":
        return

    for experiment in db.list_undelivered_conversion_decisions(project_id):
        attempts = db.count_conversion_graduation_attempts(experiment["id"])
        if attempts == 0:
            # Never even attempted (e.g. a crash right after deciding, before
            # the first build was queued) — not a failure retry, just catch-up.
            pass
        elif attempts >= _MAX_GRADUATION_ATTEMPTS:
            continue
        credit = db.credits_available(project["owner_id"])
        if not credit.get("allowed"):
            continue
        _graduate_or_revert(project, experiment, experiment["status"])


def apply_experiment_decision(project: dict[str, Any], experiment: dict[str, Any]) -> None:
    """Shared by the autonomous evaluation pass (Solo mode) and the manual
    apply-decision endpoint (Manual mode) — same graduate/revert mechanics
    either way, just a different trigger."""
    _graduate_or_revert(project, experiment, experiment["status"])


def _evaluate_running_experiments(project_row: dict[str, Any]) -> None:
    project_id = project_row["id"]
    project = db.get_project(project_id)
    if project is None or not project.get("conversion_agent_enabled"):
        return
    ref = project.get("supabase_project_ref")
    if not ref:
        return

    settings = get_settings()
    now = datetime.now(timezone.utc)
    try:
        access_token = fresh_access_token(project["owner_id"])
    except SupabaseConnectError:
        return

    for experiment in db.list_running_conversion_experiments(project_id):
        started_at = _parse_ts(experiment.get("started_at"))
        if started_at is None:
            continue
        days_running = (now - started_at).days

        if days_running < settings.conversion_agent_min_runtime_days:
            continue

        counts = fetch_experiment_counts(
            access_token, ref, experiment["experiment_key"], experiment["started_at"]
        )
        min_exposures = min(counts["exposures_a"], counts["exposures_b"])
        ran_out_of_time = days_running >= settings.conversion_agent_max_runtime_days

        if min_exposures < settings.conversion_agent_min_exposures_per_variant:
            if not ran_out_of_time:
                continue
            decision = "inconclusive"
            p_value, lift_pct = None, None
            ci_low_pct, ci_high_pct = None, None
        else:
            p_value, lift_pct = _two_proportion_z_test(counts)
            ci_low_pct, ci_high_pct = _lift_confidence_interval(counts)
            if p_value is not None and p_value < settings.conversion_agent_significance_p_value:
                decision = "winner_b" if (lift_pct or 0) > 0 else "winner_a"
            elif ran_out_of_time:
                decision = "inconclusive"
            else:
                decision = "continue"

        db.create_conversion_result(
            experiment_id=experiment["id"],
            exposures_a=counts["exposures_a"],
            exposures_b=counts["exposures_b"],
            conversions_a=counts["conversions_a"],
            conversions_b=counts["conversions_b"],
            p_value=p_value,
            lift_pct=lift_pct,
            decision=decision,
            ci_low_pct=ci_low_pct,
            ci_high_pct=ci_high_pct,
        )

        if decision == "continue":
            continue

        db.set_conversion_experiment_status(
            experiment["id"], decision, decided_at=now.isoformat()
        )
        publish_event(
            {
                "type": "conversion.experiment_decided",
                "project_id": project_id,
                "experiment_id": experiment["id"],
                "decision": decision,
                "lift_pct": lift_pct,
                "p_value": p_value,
            }
        )

        if project.get("autonomy_mode") == "manual":
            # A human must click "Apply winner"/"Revert" — see
            # POST /projects/{id}/conversion/experiments/{id}/apply-decision.
            continue

        experiment = {**experiment, "status": decision}
        _graduate_or_revert(project, experiment, decision)


# --------------------------------------------------------------------------
# Top-level poll entrypoint — run in-process from app/main.py exactly like
# the runtime monitor / email poller.
# --------------------------------------------------------------------------


def poll_conversion_agent() -> None:
    for project_row in db.list_supabase_linked_projects():
        try:
            _maybe_detect_project(project_row)
        except Exception:
            log.exception(
                "conversion agent: detection pass failed for project %s",
                project_row.get("id"),
            )
        try:
            _maybe_launch_experiment(project_row)
        except Exception:
            log.exception(
                "conversion agent: launch pass failed for project %s",
                project_row.get("id"),
            )
        try:
            _evaluate_running_experiments(project_row)
        except Exception:
            log.exception(
                "conversion agent: evaluation pass failed for project %s",
                project_row.get("id"),
            )
        try:
            _retry_stuck_graduations(project_row)
        except Exception:
            log.exception(
                "conversion agent: graduation retry pass failed for project %s",
                project_row.get("id"),
            )

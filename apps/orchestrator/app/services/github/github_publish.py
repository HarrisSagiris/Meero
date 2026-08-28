"""Publishes a project's real generated source to the user's own GitHub.

OAuth connect (a dedicated per-user OAuth App), real repo creation the moment
the owner connects (ensure_project_repo), and real commits via GitHub's
actual Git Data API (blobs -> tree -> commit -> ref).

Owner decision (2026-07-28): every successful build — and every auto-fix —
commits STRAIGHT to `main` (maybe_commit_build_to_github), giving a clean
linear trace of the app's whole evolution, superseding the earlier
per-build pull-request flow. (Runtime self-heal fixes are intended to ship
as a reviewable PR rather than a direct commit — open_pull_request is kept
for that path.)

Every commit's author/committer identity is "Meero" (settings.github_bot_name
/ github_bot_email), not the connected user's own GitHub name — set via the
Git Data API commit object's `author`/`committer` fields (_create_tree_and_
commit), which GitHub always displays as-is. This is REAL and correct as far
as it goes: commit history and the PR's file diff genuinely show "Meero" as
the author. It is NOT the same as a real bot actor, though — GitHub still
attributes "opened this pull request" / who can be @-mentioned-and-notified
to whichever identity's OAuth token made the API call (the connected user's
own account), because that's tied to the authenticated caller, not a commit
field. Making "Meero" a real, taggable, review-capable GitHub identity needs
an actual GitHub App: its own bot identity + logo (recognized everywhere as
"meero[bot]", the same way "dependabot[bot]" works), a webhook endpoint to
detect @mentions, and installation-token auth instead of per-user OAuth. A
GitHub App must be registered by a human on github.com (there's no API for
creating one programmatically) — that's a real prerequisite, not a decision
this codebase can make on its own.

Nothing here is simulated — every repo, commit, branch, and PR genuinely
exists on GitHub.
"""

import re
import secrets
from typing import Any

import httpx

from app.config import get_settings
from app.infrastructure.queues.queues import get_redis
from app.workers.common import log

GITHUB_API = "https://api.github.com"
_STATE_PREFIX = "meero:gh_oauth_state:"
_STATE_TTL_SECONDS = 600

DEFAULT_BRANCH = "main"


class GithubPublishError(Exception):
    """Raised when a real GitHub API call fails."""


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _slugify_repo_name(name: str, project_id: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", name).strip("-").lower()
    slug = (slug or "meero-app")[:80].strip("-")
    # Project names aren't unique; append a short id suffix so the repo name
    # (which must be unique per GitHub account) reliably is.
    return f"{slug}-{project_id[:8]}"


# --------------------------------------------------------------------------
# OAuth connect
# --------------------------------------------------------------------------


def build_authorize_url(user_id: str, project_id: str | None = None) -> str:
    """Generates a one-time state token bound to this user (and, when
    initiated from a project's Connections tab, that project too — stored
    in Redis, short-lived) and returns the real GitHub OAuth authorize URL.
    `project_id=None` is a real, supported case: the account settings page
    connects GitHub without any project in scope, so a later project just
    reuses the resulting account-level connection (profiles.github_username)
    via POST /projects/{id}/github/publish instead of reconnecting."""
    settings = get_settings()
    if not settings.github_oauth_configured:
        raise GithubPublishError(
            "GitHub isn't configured (set GITHUB_OAUTH_CLIENT_ID / "
            "GITHUB_OAUTH_CLIENT_SECRET)."
        )
    state = secrets.token_urlsafe(24)
    get_redis().setex(
        f"{_STATE_PREFIX}{state}", _STATE_TTL_SECONDS, f"{user_id}:{project_id or ''}"
    )
    params = httpx.QueryParams(
        {
            "client_id": settings.github_oauth_client_id,
            "redirect_uri": settings.github_oauth_redirect_uri,
            "scope": "repo",
            "state": state,
        }
    )
    return f"https://github.com/login/oauth/authorize?{params}"


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


def exchange_code_for_token(code: str) -> str:
    settings = get_settings()
    response = httpx.post(
        "https://github.com/login/oauth/access_token",
        headers={"Accept": "application/json"},
        data={
            "client_id": settings.github_oauth_client_id,
            "client_secret": settings.github_oauth_client_secret,
            "code": code,
            "redirect_uri": settings.github_oauth_redirect_uri,
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    token = data.get("access_token")
    if not token:
        raise GithubPublishError(f"GitHub token exchange failed: {data}")
    return token


def fetch_github_user(access_token: str) -> dict[str, Any]:
    response = httpx.get(f"{GITHUB_API}/user", headers=_headers(access_token), timeout=30)
    response.raise_for_status()
    return response.json()


# --------------------------------------------------------------------------
# Repo creation + commits — real Git Data API
# --------------------------------------------------------------------------


def create_repo(
    access_token: str,
    name: str,
    description: str,
    private: bool = True,
    auto_init: bool = False,
) -> dict[str, Any]:
    response = httpx.post(
        f"{GITHUB_API}/user/repos",
        headers=_headers(access_token),
        json={
            "name": name,
            "description": description,
            "private": private,
            # auto_init creates the repo with an initial README commit on the
            # default branch, so `main` exists immediately — needed when we
            # create the repo at connect time, BEFORE any build has produced
            # files to seed it with.
            "auto_init": auto_init,
        },
        timeout=30,
    )
    if response.status_code >= 300:
        raise GithubPublishError(
            f"Could not create GitHub repo ({response.status_code}): {response.text[:300]}"
        )
    return response.json()


def ensure_project_repo(
    access_token: str, project_name: str, project_id: str
) -> dict[str, str]:
    """Creates a real repo for a project the moment its owner connects GitHub
    — initialized with a README so `main` exists right away and every later
    successful build can commit straight onto it. Idempotent-ish: if the
    slugified name already exists on the account, GitHub 422s and we surface
    that; callers should only invoke this when the project has no repo yet.
    Returns {full_name, html_url}."""
    repo_name = _slugify_repo_name(project_name, project_id)
    repo = create_repo(
        access_token,
        repo_name,
        description=f"Built with Meero — {project_name}",
        auto_init=True,
    )
    return {"full_name": repo["full_name"], "html_url": repo["html_url"]}


def _create_blob(access_token: str, full_name: str, content: str) -> str:
    response = httpx.post(
        f"{GITHUB_API}/repos/{full_name}/git/blobs",
        headers=_headers(access_token),
        json={"content": content, "encoding": "utf-8"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["sha"]


def _get_ref_sha(access_token: str, full_name: str, branch: str) -> str | None:
    response = httpx.get(
        f"{GITHUB_API}/repos/{full_name}/git/ref/heads/{branch}",
        headers=_headers(access_token),
        timeout=30,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()["object"]["sha"]


def _create_tree_and_commit(
    access_token: str,
    full_name: str,
    files: list[dict[str, str]],
    message: str,
    parent_sha: str | None,
) -> str:
    """Builds one real commit holding the complete current project state and
    returns its sha. No base_tree is used on purpose — each Meero build
    regenerates the whole project, so a file removed by a fresh codegen run
    must not linger as a stale leftover in the repo."""
    if not files:
        raise GithubPublishError("Nothing to commit: no generated files.")

    tree_entries = [
        {
            "path": f["path"],
            "mode": "100644",
            "type": "blob",
            "sha": _create_blob(access_token, full_name, f["content"]),
        }
        for f in files
    ]
    tree_response = httpx.post(
        f"{GITHUB_API}/repos/{full_name}/git/trees",
        headers=_headers(access_token),
        json={"tree": tree_entries},
        timeout=60,
    )
    tree_response.raise_for_status()
    tree_sha = tree_response.json()["sha"]

    settings = get_settings()
    bot_identity = {"name": settings.github_bot_name, "email": settings.github_bot_email}
    commit_payload: dict[str, Any] = {
        "message": message,
        "tree": tree_sha,
        # Every commit shows as authored by Meero, not whoever's OAuth token
        # actually pushed it — see this module's docstring for what this
        # does and doesn't cover.
        "author": bot_identity,
        "committer": bot_identity,
    }
    if parent_sha:
        commit_payload["parents"] = [parent_sha]
    commit_response = httpx.post(
        f"{GITHUB_API}/repos/{full_name}/git/commits",
        headers=_headers(access_token),
        json=commit_payload,
        timeout=30,
    )
    commit_response.raise_for_status()
    return commit_response.json()["sha"]


def _set_ref(
    access_token: str,
    full_name: str,
    branch: str,
    commit_sha: str,
    *,
    create: bool,
) -> None:
    if create:
        response = httpx.post(
            f"{GITHUB_API}/repos/{full_name}/git/refs",
            headers=_headers(access_token),
            json={"ref": f"refs/heads/{branch}", "sha": commit_sha},
            timeout=30,
        )
    else:
        response = httpx.patch(
            f"{GITHUB_API}/repos/{full_name}/git/refs/heads/{branch}",
            headers=_headers(access_token),
            json={"sha": commit_sha, "force": False},
            timeout=30,
        )
    if response.status_code >= 300:
        raise GithubPublishError(
            f"Could not update {branch} ref ({response.status_code}): "
            f"{response.text[:300]}"
        )


def push_commit(
    access_token: str,
    full_name: str,
    files: list[dict[str, str]],
    message: str,
    branch: str = DEFAULT_BRANCH,
) -> str:
    """Pushes `files` ([{"path", "content"}]) as ONE real commit representing
    the complete current project state, onto `branch` (created if missing).
    """
    parent_sha = _get_ref_sha(access_token, full_name, branch)
    commit_sha = _create_tree_and_commit(
        access_token, full_name, files, message, parent_sha
    )
    _set_ref(
        access_token, full_name, branch, commit_sha, create=parent_sha is None
    )
    return commit_sha


def open_pull_request(
    access_token: str,
    full_name: str,
    files: list[dict[str, str]],
    branch: str,
    title: str,
    body: str,
    base: str = DEFAULT_BRANCH,
) -> dict[str, str]:
    """Opens a REAL pull request: commits the complete regenerated project to
    a fresh branch (parented on the base branch's current head) and opens a
    PR against the base. Returns {html_url, number}."""
    base_sha = _get_ref_sha(access_token, full_name, base)
    if base_sha is None:
        raise GithubPublishError(
            f"Base branch {base!r} doesn't exist — publish the project first."
        )
    commit_sha = _create_tree_and_commit(access_token, full_name, files, title, base_sha)
    _set_ref(access_token, full_name, branch, commit_sha, create=True)

    response = httpx.post(
        f"{GITHUB_API}/repos/{full_name}/pulls",
        headers=_headers(access_token),
        json={"title": title, "head": branch, "base": base, "body": body},
        timeout=30,
    )
    if response.status_code >= 300:
        raise GithubPublishError(
            f"Could not open the pull request ({response.status_code}): "
            f"{response.text[:300]}"
        )
    pr = response.json()
    return {"html_url": pr["html_url"], "number": str(pr["number"])}


def _build_commit_message(build: dict[str, Any]) -> str:
    """A clear commit subject so the repo's main history reads as a real
    trace of the app's evolution — distinguishing a normal build from an
    automatic error fix."""
    short = build["id"][:8]
    if build.get("retry_of"):
        return f"Auto-fix build {short}\n\nMeero regenerated the app to fix a build error."
    return f"Build {short}\n\nSuccessful Meero build — complete regenerated source."


def maybe_commit_build_to_github(project_id: str, build_id: str) -> None:
    """Best-effort: if this project is linked to a GitHub repo, commit the
    just-generated source straight onto `main` as ONE real commit (owner
    decision 2026-07-28: builds commit to main directly — a clean linear
    trace of every successful build and auto-fix — superseding the earlier
    per-build-PR flow; runtime self-heal fixes still go through a PR, see
    open_runtime_fix_pr). Called right after a build succeeds by the web
    worker. Never raises — a failed push must not retroactively fail a
    genuinely successful build; it logs and moves on, matching
    queues.publish_event()'s best-effort convention.
    """
    from app.infrastructure.database import db  # local import: keeps this a leaf dependency of db.py

    try:
        project = db.get_project(project_id)
        if not project or not project.get("github_repo_full_name"):
            return
        connection = db.get_github_connection(project["owner_id"])
        if not connection:
            return
        build = db.get_build(build_id) or {"id": build_id}
        files = db.list_build_files(build_id)
        commit_sha = push_commit(
            connection["access_token"],
            project["github_repo_full_name"],
            files,
            message=_build_commit_message(build),
            branch=DEFAULT_BRANCH,
        )
        log.info(
            "Committed build %s to %s@%s (%s)",
            build_id,
            project["github_repo_full_name"],
            DEFAULT_BRANCH,
            commit_sha[:8],
        )
    except Exception:  # noqa: BLE001 — a push failure must not fail the build
        log.exception("GitHub auto-commit failed for build %s", build_id)


def maybe_open_runtime_fix_pr(project_id: str, build_id: str) -> None:
    """Best-effort: if this project is linked to a GitHub repo, open a REAL
    pull request carrying the fix for a captured PRODUCTION runtime error
    (see db.create_runtime_fix_build / POST /projects/{id}/runtime-errors/fix).
    Unlike a normal build (which already passed a real `next build` and
    commits straight to main), this is a speculative reaction to a live
    error report, so it stays a reviewable PR rather than a direct commit —
    the one exception to the "builds commit to main" rule (2026-07-28).
    Never raises — a failed PR must not retroactively fail a genuinely
    successful build."""
    from app.infrastructure.database import db  # local import: keeps this a leaf dependency of db.py

    try:
        project = db.get_project(project_id)
        if not project or not project.get("github_repo_full_name"):
            return
        connection = db.get_github_connection(project["owner_id"])
        if not connection:
            return
        files = db.list_build_files(build_id)
        short = build_id[:8]
        result = open_pull_request(
            connection["access_token"],
            project["github_repo_full_name"],
            files,
            branch=f"meero/runtime-fix-{short}",
            title=f"Auto-fix: production error ({short})",
            body=(
                "This pull request was opened automatically by Meero after a "
                "real error was captured from your app's live production "
                "traffic (via the required runtime error reporter every "
                "Meero app ships with) and an automatic fix was generated.\n\n"
                "Review and merge — this did NOT commit straight to main "
                "since it's a reaction to a live error report, not a build "
                "that already passed a real compile."
            ),
        )
        log.info(
            "Opened runtime-fix PR #%s for build %s on %s",
            result["number"],
            build_id,
            project["github_repo_full_name"],
        )
    except Exception:  # noqa: BLE001 — a PR failure must not fail the build
        log.exception("GitHub runtime-fix PR failed for build %s", build_id)

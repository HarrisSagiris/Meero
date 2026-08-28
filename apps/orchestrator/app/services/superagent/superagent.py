"""Superagent — a personal GitHub bot on the user's own repo.

Reuses the SAME real GitHub OAuth connection github_publish.py already
manages (github_connections; scope="repo", which GitHub's own scope docs
document as already covering repository webhook management for repos the
token holder administers — no new OAuth scope/reconnect needed). Connecting
a repo creates a REAL webhook via the GitHub REST API pointed at this
orchestrator's own public URL; GitHub delivers real `issue_comment` /
`pull_request_review_comment` payloads there whenever anyone comments on
that repo, and a genuine "@meero" mention triggers a real LLM agent run
(app/agent/superagent_brain.py) that edits real files and opens a real pull
request via the Git Data API (open_pull_request_with_patch below).

Important, real limitation (not something this codebase can route around):
this is NOT a distinct "meero[bot]" GitHub identity that people can
@-mention the way they mention dependabot. That requires a real GitHub App
— its own bot identity, installation-token auth, a webhook subscription
model — and a GitHub App must be registered by a human on github.com;
there's no API for creating one. Until that exists, every PR/commit/comment
Superagent makes is authenticated as the CONNECTED USER'S OWN GitHub
account (their token), with commit author/committer set to "Meero" the
same way github_publish.py's builds already do — real, but attributed to
the connecting user's account at the GitHub-API-actor level, not a
separate bot user. See github_publish.py's own module docstring for the
same caveat on the existing build-commit flow.

Nothing here is simulated: every repo listing, webhook, file read, commit,
and pull request is a real GitHub API call.
"""

import base64
import hashlib
import hmac
import re
import secrets
from typing import Any

import httpx

from app.config import get_settings
from app.services.github.github_publish import GITHUB_API, GithubPublishError, _create_blob, _get_ref_sha, _headers, _set_ref
from app.infrastructure.queues.queues import get_redis

_STATE_PREFIX = "meero:superagent_oauth_state:"
_STATE_TTL_SECONDS = 600


def make_branch_name(raw: str, suffix: str) -> str:
    """A valid, collision-resistant git branch name — never trusts the raw
    LLM-suggested name alone (it might collide across runs), always
    prefixed under meero/ and disambiguated with a real per-run suffix
    (an event id or a fresh random one for a direct chat call)."""
    slug = re.sub(r"[^a-zA-Z0-9/_-]+", "-", raw or "meero-change").strip("-")
    slug = (slug or "meero/change")[:60].strip("-")
    if not slug.startswith("meero/"):
        slug = f"meero/{slug}"
    return f"{slug}-{suffix[:8]}"

WEBHOOK_EVENTS = ["issue_comment", "pull_request_review_comment"]
MENTION = "@meero"


# --------------------------------------------------------------------------
# OAuth connect — deliberately the SAME GitHub OAuth App and the SAME
# callback URL as github_publish.py's project-connect flow (GET
# /auth/github/callback in main.py just tries resolve_state, then this
# module's resolve_superagent_state, and branches on whichever resolves).
# Classic GitHub OAuth Apps only support ONE registered callback URL — a
# second one would need external dashboard changes this repo can't reach,
# same caveat as github_oauth_redirect_uri below. Using a distinct Redis
# key prefix (rather than a distinct URL) is what tells the two flows apart
# without needing that.
# --------------------------------------------------------------------------


def build_superagent_authorize_url(user_id: str) -> str:
    settings = get_settings()
    if not settings.github_oauth_configured:
        raise GithubPublishError(
            "GitHub isn't configured (set GITHUB_OAUTH_CLIENT_ID / "
            "GITHUB_OAUTH_CLIENT_SECRET)."
        )
    state = secrets.token_urlsafe(24)
    get_redis().setex(f"{_STATE_PREFIX}{state}", _STATE_TTL_SECONDS, user_id)
    params = httpx.QueryParams(
        {
            "client_id": settings.github_oauth_client_id,
            "redirect_uri": settings.github_oauth_redirect_uri,
            "scope": "repo",
            "state": state,
        }
    )
    return f"https://github.com/login/oauth/authorize?{params}"


def resolve_superagent_state(state: str) -> str | None:
    key = f"{_STATE_PREFIX}{state}"
    raw = get_redis().get(key)
    if raw is None:
        return None
    get_redis().delete(key)
    return raw


# --------------------------------------------------------------------------
# Repo listing + webhook management
# --------------------------------------------------------------------------


def list_user_repos(access_token: str) -> list[dict[str, Any]]:
    """Real repos the connected account can administer (needed to create a
    webhook) — up to 100, most-recently-pushed first; plenty for a picker."""
    response = httpx.get(
        f"{GITHUB_API}/user/repos",
        headers=_headers(access_token),
        params={"per_page": 100, "sort": "pushed", "affiliation": "owner,collaborator"},
        timeout=30,
    )
    response.raise_for_status()
    return [
        {
            "full_name": r["full_name"],
            "html_url": r["html_url"],
            "private": r["private"],
            "default_branch": r["default_branch"],
        }
        for r in response.json()
        if r.get("permissions", {}).get("admin")
    ]


def get_default_branch(access_token: str, full_name: str) -> str:
    response = httpx.get(
        f"{GITHUB_API}/repos/{full_name}", headers=_headers(access_token), timeout=30
    )
    response.raise_for_status()
    return response.json()["default_branch"]


def create_webhook(access_token: str, full_name: str, secret: str) -> dict[str, Any]:
    settings = get_settings()
    response = httpx.post(
        f"{GITHUB_API}/repos/{full_name}/hooks",
        headers=_headers(access_token),
        json={
            "name": "web",
            "active": True,
            "events": WEBHOOK_EVENTS,
            "config": {
                "url": f"{settings.public_base_url}/webhooks/github/superagent",
                "content_type": "json",
                "secret": secret,
            },
        },
        timeout=30,
    )
    if response.status_code >= 300:
        raise GithubPublishError(
            f"Could not create the webhook ({response.status_code}): {response.text[:300]}"
        )
    return response.json()


def delete_webhook(access_token: str, full_name: str, webhook_id: int) -> None:
    """Best-effort — called when a connection is removed."""
    httpx.delete(
        f"{GITHUB_API}/repos/{full_name}/hooks/{webhook_id}",
        headers=_headers(access_token),
        timeout=30,
    )


def verify_webhook_signature(secret: str, payload: bytes, signature_header: str | None) -> bool:
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature_header)


# --------------------------------------------------------------------------
# Reading the repo — real content, so the agent has real context.
# --------------------------------------------------------------------------


def get_repo_tree(access_token: str, full_name: str, branch: str) -> list[str]:
    """Every file path in the repo at `branch`'s current head (recursive git
    tree) — cheap, gives the agent real repo structure to reason from."""
    sha = _get_ref_sha(access_token, full_name, branch)
    if sha is None:
        return []
    response = httpx.get(
        f"{GITHUB_API}/repos/{full_name}/git/trees/{sha}",
        headers=_headers(access_token),
        params={"recursive": "1"},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    return [e["path"] for e in data.get("tree", []) if e.get("type") == "blob"]


def get_file_content(access_token: str, full_name: str, path: str, ref: str) -> str | None:
    response = httpx.get(
        f"{GITHUB_API}/repos/{full_name}/contents/{path}",
        headers=_headers(access_token),
        params={"ref": ref},
        timeout=30,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    data = response.json()
    if data.get("encoding") != "base64":
        return None
    return base64.b64decode(data["content"]).decode("utf-8", errors="replace")


# --------------------------------------------------------------------------
# Writing — a REAL pull request that only touches the files the agent
# actually changed. Deliberately NOT github_publish.py's
# _create_tree_and_commit: that one replaces the ENTIRE tree (correct for a
# Meero-generated app, where every build regenerates the whole project) —
# doing that against an arbitrary EXISTING repo would delete everything the
# agent didn't touch. This uses `base_tree` so untouched files are left
# alone, same as a normal `git commit` of a partial change.
# --------------------------------------------------------------------------


def _create_patch_commit(
    access_token: str, full_name: str, files: list[dict[str, str]], message: str, base_sha: str
) -> str:
    base_commit = httpx.get(
        f"{GITHUB_API}/repos/{full_name}/git/commits/{base_sha}",
        headers=_headers(access_token),
        timeout=30,
    )
    base_commit.raise_for_status()
    base_tree_sha = base_commit.json()["tree"]["sha"]

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
        json={"base_tree": base_tree_sha, "tree": tree_entries},
        timeout=60,
    )
    tree_response.raise_for_status()
    tree_sha = tree_response.json()["sha"]

    settings = get_settings()
    bot_identity = {"name": settings.github_bot_name, "email": settings.github_bot_email}
    commit_response = httpx.post(
        f"{GITHUB_API}/repos/{full_name}/git/commits",
        headers=_headers(access_token),
        json={
            "message": message,
            "tree": tree_sha,
            "parents": [base_sha],
            "author": bot_identity,
            "committer": bot_identity,
        },
        timeout=30,
    )
    commit_response.raise_for_status()
    return commit_response.json()["sha"]


def open_pull_request_with_patch(
    access_token: str,
    full_name: str,
    files: list[dict[str, str]],
    branch: str,
    title: str,
    body: str,
    base: str,
) -> dict[str, str]:
    """Opens a REAL pull request touching only `files` — everything else in
    the repo is left exactly as it was. Returns {html_url, number}."""
    base_sha = _get_ref_sha(access_token, full_name, base)
    if base_sha is None:
        raise GithubPublishError(f"Base branch {base!r} doesn't exist.")
    commit_sha = _create_patch_commit(access_token, full_name, files, title, base_sha)
    _set_ref(access_token, full_name, branch, commit_sha, create=True)

    response = httpx.post(
        f"{GITHUB_API}/repos/{full_name}/pulls",
        headers=_headers(access_token),
        json={"title": title, "head": branch, "base": base, "body": body},
        timeout=30,
    )
    if response.status_code >= 300:
        raise GithubPublishError(
            f"Could not open the pull request ({response.status_code}): {response.text[:300]}"
        )
    pr = response.json()
    return {"html_url": pr["html_url"], "number": str(pr["number"])}


def post_comment(access_token: str, full_name: str, issue_number: int, body: str) -> None:
    """Real reply on the issue/PR that mentioned @meero — GitHub's Issues
    API handles top-level PR conversation comments too, not just issues."""
    response = httpx.post(
        f"{GITHUB_API}/repos/{full_name}/issues/{issue_number}/comments",
        headers=_headers(access_token),
        json={"body": body},
        timeout=30,
    )
    if response.status_code >= 300:
        raise GithubPublishError(
            f"Could not post the reply comment ({response.status_code}): {response.text[:300]}"
        )

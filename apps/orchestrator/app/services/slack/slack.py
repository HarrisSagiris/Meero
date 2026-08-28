"""Superagent — real Slack integration (Events API + OAuth v2).

Requires a real Slack App registered by a human at
https://api.slack.com/apps (there's no API to create one) — see
Settings.slack_* in app/config.py for exactly what to configure. Every
function here is a genuine Slack API call; nothing is simulated. Once a
workspace is connected and a channel is linked to a superagent_connections
row (db.link_slack_channel), a real "@Meero" mention in that channel POSTs
a real Events API payload to /webhooks/slack/events (app/main.py), which
enqueues the SAME real agent job app/workers/superagent_worker.py already
runs for a GitHub mention or a direct chat message — this module only
covers the Slack-specific OAuth/webhook/reply plumbing around that shared
pipeline.
"""

import hashlib
import hmac
import secrets
import time
from typing import Any

import httpx

from app.config import get_settings
from app.infrastructure.queues.queues import get_redis

SLACK_API = "https://slack.com/api"
_STATE_PREFIX = "meero:slack_oauth_state:"
_STATE_TTL_SECONDS = 600

# Minimum scopes for: detecting @Meero mentions, replying, and listing
# channels to link one to a repo.
BOT_SCOPES = "app_mentions:read,chat:write,channels:read,groups:read"


class SlackError(Exception):
    """Raised when a real Slack API call fails or reports ok: false."""


def build_authorize_url(user_id: str) -> str:
    settings = get_settings()
    if not settings.slack_configured:
        raise SlackError(
            "Slack isn't configured yet (set SLACK_CLIENT_ID / "
            "SLACK_CLIENT_SECRET / SLACK_SIGNING_SECRET)."
        )
    state = secrets.token_urlsafe(24)
    get_redis().setex(f"{_STATE_PREFIX}{state}", _STATE_TTL_SECONDS, user_id)
    params = httpx.QueryParams(
        {
            "client_id": settings.slack_client_id,
            "scope": BOT_SCOPES,
            "redirect_uri": settings.slack_oauth_redirect_uri,
            "state": state,
        }
    )
    return f"https://slack.com/oauth/v2/authorize?{params}"


def resolve_state(state: str) -> str | None:
    key = f"{_STATE_PREFIX}{state}"
    raw = get_redis().get(key)
    if raw is None:
        return None
    get_redis().delete(key)
    return raw


def exchange_code(code: str) -> dict[str, Any]:
    settings = get_settings()
    response = httpx.post(
        f"{SLACK_API}/oauth.v2.access",
        data={
            "client_id": settings.slack_client_id,
            "client_secret": settings.slack_client_secret,
            "code": code,
            "redirect_uri": settings.slack_oauth_redirect_uri,
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    if not data.get("ok"):
        raise SlackError(f"Slack OAuth exchange failed: {data.get('error')}")
    return data


def verify_signature(timestamp: str | None, body: bytes, signature: str | None) -> bool:
    """Slack's documented v0 signing scheme. Also rejects anything older
    than 5 minutes — a real replay-attack guard, not just a format check."""
    settings = get_settings()
    if not (timestamp and signature and signature.startswith("v0=")):
        return False
    try:
        if abs(time.time() - int(timestamp)) > 60 * 5:
            return False
    except ValueError:
        return False
    base = f"v0:{timestamp}:{body.decode('utf-8')}"
    expected = "v0=" + hmac.new(
        settings.slack_signing_secret.encode("utf-8"), base.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def list_channels(bot_token: str) -> list[dict[str, Any]]:
    """Real channels the bot can see — public + private ones it's already
    a member of. Slack only returns private channels the bot's been
    invited to, which is the correct, least-surprising behavior here."""
    response = httpx.get(
        f"{SLACK_API}/conversations.list",
        headers={"Authorization": f"Bearer {bot_token}"},
        params={"types": "public_channel,private_channel", "limit": 200},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    if not data.get("ok"):
        raise SlackError(f"Could not list Slack channels: {data.get('error')}")
    return [
        {"id": c["id"], "name": c["name"], "is_private": c.get("is_private", False)}
        for c in data.get("channels", [])
    ]


def post_message(bot_token: str, channel: str, text: str, thread_ts: str | None = None) -> None:
    payload: dict[str, Any] = {"channel": channel, "text": text}
    if thread_ts:
        payload["thread_ts"] = thread_ts
    response = httpx.post(
        f"{SLACK_API}/chat.postMessage",
        headers={"Authorization": f"Bearer {bot_token}"},
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    if not data.get("ok"):
        raise SlackError(f"Could not post to Slack: {data.get('error')}")


def strip_bot_mention(text: str, bot_user_id: str) -> str:
    """Slack renders the mention as literal `<@U0123ABC>` in event text —
    strip it so the agent sees a clean request, not raw mention markup."""
    return text.replace(f"<@{bot_user_id}>", "").strip()

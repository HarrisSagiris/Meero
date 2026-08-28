"""Real Redis-backed job queues (blocking lists) and pub/sub events."""

import json
import logging
from typing import Any

import redis

from app.config import get_settings

log = logging.getLogger("meero.queues")

CODEGEN_QUEUE = "meero:codegen"
WEB_BUILD_QUEUE = "meero:build:web"
DEPLOY_QUEUE = "meero:deploy"
SUPERAGENT_QUEUE = "meero:superagent"
EVENTS_CHANNEL = "meero:events"

# Real, working cancellation (POST /builds/{id}/cancel in app/main.py): the
# key's mere existence means "stop as soon as you notice" — workers poll
# is_build_canceled() at safe checkpoints (between streamed LLM chunks,
# before/after the schema apply, during the `next build` subprocess) and
# unwind via app.errors.BuildCanceled the moment they see it.
_CANCEL_KEY_PREFIX = "meero:cancel:"
_CANCEL_TTL_SECONDS = 3600

_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(
            get_settings().redis_url,
            decode_responses=True,
            socket_keepalive=True,
            retry_on_timeout=True,
        )
    return _client


def enqueue(queue: str, payload: dict[str, Any]) -> None:
    get_redis().lpush(queue, json.dumps(payload))


def dequeue_blocking(queue: str, timeout: int = 30) -> dict[str, Any] | None:
    """Blocking pop; returns None on timeout so workers can loop/heartbeat.

    redis-py can surface a blocking pop that outlives the socket read
    timeout as TimeoutError/ConnectionError — treat both as "no job yet"
    so worker loops never die on an idle queue.
    """
    try:
        item = get_redis().brpop([queue], timeout=timeout)
    except (redis.exceptions.TimeoutError, redis.exceptions.ConnectionError):
        return None
    if item is None:
        return None
    _, raw = item
    return json.loads(raw)


def set_build_canceled(build_id: str) -> None:
    """Raises the real cancel signal a build's workers poll for. Called
    exactly once, by the cancel endpoint — never speculatively."""
    get_redis().setex(f"{_CANCEL_KEY_PREFIX}{build_id}", _CANCEL_TTL_SECONDS, "1")


def is_build_canceled(build_id: str) -> bool:
    """Polled by workers at safe checkpoints. Fails OPEN (returns False —
    i.e. "keep going") on a transient Redis error, matching
    dequeue_blocking()'s convention: a Redis blip must never look like a
    cancel request and kill work that was never actually stopped."""
    try:
        return bool(get_redis().exists(f"{_CANCEL_KEY_PREFIX}{build_id}"))
    except (redis.exceptions.RedisError, OSError):
        return False


def publish_event(event: dict[str, Any]) -> None:
    """Fan out a build event to all connected WebSocket sessions.

    Best-effort: a worker on infrastructure that can't reach a locally-hosted
    Redis (e.g. a separate deploy host) shouldn't crash over it. The
    Supabase row update is the source of truth either way, so a broken live
    push just means the browser picks up the change on its next refresh
    instead of instantly.
    """
    try:
        get_redis().publish(EVENTS_CHANNEL, json.dumps(event))
    except (redis.exceptions.RedisError, OSError) as exc:
        log.warning("publish_event: could not reach Redis (%s); skipping", exc)

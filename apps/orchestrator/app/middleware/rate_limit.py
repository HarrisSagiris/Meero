"""Redis-backed rate limiting for the orchestrator API.

Fixed-window counters via Redis INCR + EXPIRE — atomic, O(1) per request,
and reuses the same Redis instance already used for queues/events. Every
real user-facing endpoint gets one of these, including ones already gated
by credits — credits bound *cost*, this bounds *request rate*, which
matters even for calls that get denied before spending anything (or that
don't cost credits at all, like billing/GitHub endpoints).

Bucketed by the caller's bearer token (one bucket per logged-in session,
without re-validating it here — real auth still happens via
`current_user_id` downstream) when present, else by client IP for
pre-auth routes (the GitHub OAuth callback, the Stripe webhook).
"""

import hashlib

from fastapi import HTTPException, Request


def _identity(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth.split(" ", 1)[1]
        return "tok:" + hashlib.sha256(token.encode()).hexdigest()[:24]
    ip = request.client.host if request.client else "unknown"
    return f"ip:{ip}"


def check(key: str, limit: int, window_seconds: int) -> None:
    """Raises 429 (with Retry-After) once `key` exceeds `limit` hits within
    `window_seconds`. Import get_redis() lazily so a Redis outage surfaces
    as a real error on first use, not an import-time crash."""
    from app.infrastructure.queues.queues import get_redis

    redis = get_redis()
    count = redis.incr(key)
    if count == 1:
        redis.expire(key, window_seconds)
    if count > limit:
        ttl = redis.ttl(key)
        retry_after = ttl if ttl and ttl > 0 else window_seconds
        raise HTTPException(
            429,
            f"Too many requests — try again in {retry_after}s.",
            headers={"Retry-After": str(retry_after)},
        )


def rate_limit(scope: str, limit: int, window_seconds: int = 60):
    """FastAPI dependency factory. Usage:

        @app.post("/builds", dependencies=[Depends(rate_limit("builds", 20, 60))])
    """

    def dependency(request: Request) -> None:
        check(f"ratelimit:{scope}:{_identity(request)}", limit, window_seconds)

    return dependency


def check_for_key(scope: str, identity: str, limit: int, window_seconds: int = 60) -> None:
    """For non-HTTP callers (the WebSocket handler) that already have their
    own identity string and can't use the Request-based dependency above."""
    check(f"ratelimit:{scope}:{identity}", limit, window_seconds)

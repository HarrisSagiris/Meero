"""Zero-dependency shared exception types.

Kept dependency-free (no imports from app.agent or app.workers) so both
sides of the layering — the codegen agent and the workers that run it — can
raise/catch the same real signal without either importing the other.
"""


class BuildCanceled(Exception):
    """Raised when a real user-initiated cancel (POST /builds/{id}/cancel)
    is noticed mid-work — during a streaming OpenAI call
    (app/agent/codegen.py) or a running subprocess (app/workers/common.py).
    Distinct from CodegenError: this is never a generation failure, it's the
    user genuinely stopping work that was still in progress.
    """


# Prefix web_worker.py stores on a build's `error` the moment a REAL schema
# apply (run_query against the user's own Supabase) fails — as opposed to a
# `next build` compile failure, whose error text instead carries the
# compiler's own `./app/page.tsx:12:3`-style source pointers. codegen.py's
# targeted-fix scoping checks for this exact prefix to route deterministically
# to schema.sql alone, rather than trying to pattern-match a Postgres error
# message (which never mentions a file path) against known project paths.
SCHEMA_ERROR_MARKER = "[schema.sql]"

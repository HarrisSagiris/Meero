"""Real, automated "is your app ready?" checks — run by the web worker
against a build's own live /preview page right after a successful build.

No DOM/selector guessing needed: every generated app exposes its real
Supabase client on `window.__meeroSupabase` (a required file + marker, like
the "Created by Meero" badge — see codegen.py's MEERO_WINDOW_HOOK_MARKER),
so these checks drive the REAL client, in a REAL headless browser, against
the REAL live app — a genuine signup, a genuine login, and a genuine
anon-role read confirming owner-scoped tables are actually blocked (not
just declared with RLS in schema.sql; RLS that's mistyped or missing a
policy clause can still leave a table readable).

Never fabricated: a check that can't be run safely and generically (no
owner-scoped table exists yet — e.g. every table is intentionally public,
like a feedback board) is reported as NOT APPLICABLE (passed=None), never a
fake pass.
"""

import re
import secrets
from typing import Any

_CHECK_TIMEOUT_MS = 20_000


def _random_email() -> str:
    return f"meero-check-{secrets.token_hex(6)}@example.com"


_POLICY_STATEMENT_RE = re.compile(
    r"create\s+policy\s+.+?\s+on\s+([a-zA-Z0-9_.\"]+)\s+(.*)", re.DOTALL
)
_FOR_CLAUSE_RE = re.compile(r"for\s+(select|all|insert|update|delete)\b")
_USING_CLAUSE_RE = re.compile(r"using\s*\((.*?)\)\s*(?:with\s+check|$)", re.DOTALL)


def owner_scoped_tables(schema_sql: str) -> list[str]:
    """Tables whose SELECT-applicable policy (`for select` or `for all`)
    has a USING clause referencing auth.uid() — i.e. genuinely meant to be
    private/owner-scoped for READS specifically. Deliberately does NOT just
    check "does any policy on this table mention auth.uid() anywhere": a
    table can be intentionally public to read (`for select using (true)`)
    while still having an INSERT policy that checks `auth.uid() = author_id`
    — that table must NOT be flagged, or a working-as-designed public board
    would trigger a false "your data leaked" alarm. Only these tables are
    safe to readiness-check for anonymous-read isolation."""
    no_comments = re.sub(r"--[^\n]*", "", schema_sql)
    lowered = no_comments.lower()
    statements = [s.strip() for s in lowered.split(";") if s.strip()]

    created = {
        m.group(1).strip('"').split(".")[-1]
        for s in statements
        if (
            m := re.match(
                r"create\s+table\s+if\s+not\s+exists\s+([a-zA-Z0-9_.\"]+)", s
            )
        )
    }
    created.discard("_meero_runtime_errors")

    owner_scoped: set[str] = set()
    for s in statements:
        policy_match = _POLICY_STATEMENT_RE.match(s)
        if not policy_match:
            continue
        table = policy_match.group(1).strip('"').split(".")[-1]
        if table not in created or table in owner_scoped:
            continue
        rest = policy_match.group(2)
        for_match = _FOR_CLAUSE_RE.search(rest)
        if not for_match or for_match.group(1) not in ("select", "all"):
            continue
        using_match = _USING_CLAUSE_RE.search(rest)
        if using_match and "auth.uid()" in using_match.group(1):
            owner_scoped.add(table)

    return sorted(owner_scoped)


def run_readiness_checks(preview_url: str, schema_sql: str) -> list[dict[str, Any]]:
    """Returns a list of {key, label, passed, detail}. `passed` is a real
    tri-state: True/False from an actual browser-driven check, or None for
    "not applicable" — never guessed. Raises on infra failure (browser
    launch, page never loading, window.__meeroSupabase never appearing) —
    the caller (web_worker.py) wraps this best-effort, matching
    _capture_screenshot's convention, so a check failure never fails the
    build itself."""
    from playwright.sync_api import sync_playwright

    results: list[dict[str, Any]] = []
    email = _random_email()
    password = secrets.token_urlsafe(16)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(preview_url, wait_until="networkidle", timeout=_CHECK_TIMEOUT_MS)
            page.wait_for_function(
                "() => !!window.__meeroSupabase", timeout=_CHECK_TIMEOUT_MS
            )

            signup = page.evaluate(
                """async ({ email, password }) => {
                    const { data, error } = await window.__meeroSupabase.auth.signUp({ email, password });
                    return { ok: !error && !!(data && data.user), error: error ? error.message : null };
                }""",
                {"email": email, "password": password},
            )
            results.append(
                {
                    "key": "signup",
                    "label": "People can create an account",
                    "passed": bool(signup.get("ok")),
                    "detail": signup.get("error"),
                }
            )

            login = page.evaluate(
                """async ({ email, password }) => {
                    const { data, error } = await window.__meeroSupabase.auth.signInWithPassword({ email, password });
                    return { ok: !error && !!(data && data.session), error: error ? error.message : null };
                }""",
                {"email": email, "password": password},
            )
            results.append(
                {
                    "key": "login",
                    "label": "People can log in",
                    "passed": bool(login.get("ok")),
                    "detail": login.get("error"),
                }
            )

            # Sign out so the privacy check below is a genuine anonymous read,
            # not the just-created (and now privileged) test account's own.
            page.evaluate("() => window.__meeroSupabase.auth.signOut()")

            tables = owner_scoped_tables(schema_sql)
            if not tables:
                results.append(
                    {
                        "key": "data_privacy",
                        "label": "Your private data stays private",
                        "passed": None,
                        "detail": "No owner-scoped tables to check yet.",
                    }
                )
            else:
                leaked = []
                for table in tables:
                    row = page.evaluate(
                        """async (table) => {
                            const { data, error } = await window.__meeroSupabase.from(table).select("*").limit(1);
                            return { count: (data || []).length, error: error ? error.message : null };
                        }""",
                        table,
                    )
                    if row.get("count", 0) > 0:
                        leaked.append(table)
                results.append(
                    {
                        "key": "data_privacy",
                        "label": "Your private data stays private",
                        "passed": len(leaked) == 0,
                        "detail": (
                            f"An anonymous visitor could read real rows from: {', '.join(leaked)}"
                            if leaked
                            else None
                        ),
                    }
                )
        finally:
            browser.close()

    return results

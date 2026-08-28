"""Web worker — turns generated source into a real, running full-stack
Next.js + shadcn/ui app.

Input: {build_id, project_id, storage_path} for a normal codegen build, or
{build_id, project_id, use_build_files: true} for a bundle-only run (a
marketplace clone: the source was already copied into this build's own
build_files rows; codegen is skipped).

Per build, in order — every step real, nothing simulated:
  1. Gate on the project's linked Supabase (ref/url/anon key on the project
     row, plus a live Management API connection for the owner).
  2. Apply the generated schema.sql to the USER'S OWN Postgres via the real
     Supabase Management API — DB-first; a SQL error is a genuine build
     failure fed to the auto-fix loop.
  3. Substitute the __SUPABASE_*__ placeholders with the linked project's
     real URL/anon key, and __BASE_PATH__ with this build's real preview
     path (stored source and GitHub pushes keep the placeholders).
  4. Run a REAL `next build` (static export) against the pre-vendored
     Next/React/Tailwind/shadcn/Supabase toolchain (installed once at
     image-build time — no npm install ever runs per build), then upload
     every file the export produced to the PUBLIC previews bucket — served
     live through the orchestrator's own /preview proxy (see app/main.py
     for why not Storage's own public URL).

The "Created by Meero" badge is required and validated at codegen time
(`components/meero-badge.tsx` + its import in `app/layout.tsx`); as a
belt-and-suspenders fallback, this worker also checks the actual built HTML
and injects a static badge if the marker is somehow absent.

After a successful build, best-effort opens a REAL pull request on the
project's GitHub repo (if published) — see app/github_publish.py — and, for
public projects only, captures a real headless-browser screenshot of the
build's own live /preview page for the logged-out landing page's project
gallery (see _capture_screenshot below).

Run:  python -m app.workers.web_worker
"""

import os
import shutil
from pathlib import Path

from app.services.conversion import conversion_agent
from app.infrastructure.database import db
from app.services.monitoring import runtime_monitor
from app.config import get_settings
from app.models.content_types import content_type_for
from app.errors import SCHEMA_ERROR_MARKER, BuildCanceled
from app.services.github.github_publish import maybe_commit_build_to_github, maybe_open_runtime_fix_pr
from app.infrastructure.queues.queues import WEB_BUILD_QUEUE, dequeue_blocking, is_build_canceled, publish_event
from app.infrastructure.supabase.supabase_connect import SupabaseConnectError, fresh_access_token, run_query
from app.workers.common import extract_build_errors, log, run, tail, unzip_to, workspace_for

# Substituted file types that can plausibly carry a __SUPABASE_*__ /
# __BASE_PATH__ placeholder.
_SUBSTITUTE_SUFFIXES = (".ts", ".tsx", ".mjs", ".js", ".css", ".json")

MEERO_BADGE_MARKER = "data-meero-badge"

# Raw HTML/CSS fallback (no Tailwind utility classes — the app's compiled
# CSS may not include classes the model never used, so this must stand on
# its own inline styles). Only ever used if the required, validated
# components/meero-badge.tsx somehow didn't render into the final HTML.
# Meero's real icon mark (public/meeromodern.png in the main web app,
# downscaled to 64x64 and base64-inlined) — this fallback ships as raw
# HTML with no bundler, so a real <img> data URI is the only way to show
# the actual logo here (no imported asset pipeline to lean on).
_MEERO_BADGE_LOGO_DATA_URI = "data:image/png;base64,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"

_BADGE_FALLBACK_HTML = (
    '<a href="https://meero.im" target="_blank" rel="noopener noreferrer" '
    f'{MEERO_BADGE_MARKER}="" '
    'style="position:fixed;bottom:16px;right:16px;z-index:2147483647;'
    "display:flex;align-items:center;gap:6px;padding:6px 12px;"
    "border-radius:9999px;border:1px solid rgba(0,0,0,.1);"
    "background:rgba(255,255,255,.95);box-shadow:0 2px 8px rgba(0,0,0,.12);"
    "font:500 12px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;"
    'color:#404040;text-decoration:none;">'
    f'<img src="{_MEERO_BADGE_LOGO_DATA_URI}" alt="" width="14" height="14" '
    'style="border-radius:3px;display:block;">'
    "Created by Meero</a>"
)


def _link_vendor_modules(root: Path) -> None:
    """Make the worker's pre-installed Next/React/Tailwind/shadcn/Supabase
    toolchain resolvable from the workspace root, without ever running
    `npm install` per build."""
    vendor = Path(get_settings().app_vendor_dir).resolve() / "node_modules"
    if not vendor.exists():
        raise RuntimeError(
            f"app_vendor_dir has no node_modules ({vendor}) — install the "
            f"Next.js toolchain there once at worker setup time (see "
            f"orchestrator/Dockerfile)."
        )
    target = root / "node_modules"
    try:
        os.symlink(vendor, target, target_is_directory=True)
    except OSError:
        shutil.copytree(vendor, target)


def _substitute_placeholders(
    root: Path, supabase_url: str, anon_key: str, base_path: str
) -> None:
    """Replaces the __SUPABASE_*__ / __BASE_PATH__ placeholders in the
    workspace copy with this build's real values (same pattern as the old
    __OUTPUT_PATTERN__ substitution: the generator doesn't know the target,
    the worker does). Only ever touches this build's workspace — the stored
    build_files and any GitHub push keep the portable placeholder source."""
    ws_url = supabase_url.replace("https://", "wss://", 1)
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix not in _SUBSTITUTE_SUFFIXES:
            continue
        if "node_modules" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        replaced = (
            text.replace("__SUPABASE_URL__", supabase_url)
            .replace("__SUPABASE_ANON_KEY__", anon_key)
            .replace("__SUPABASE_WS_URL__", ws_url)
            .replace("__BASE_PATH__", base_path)
        )
        if replaced != text:
            path.write_text(replaced, encoding="utf-8", newline="\n")


def _materialize_from_build_files(build_id: str, root: Path) -> None:
    """Writes this build's own build_files rows (placeholder source, already
    copied by the clone endpoint) into the workspace."""
    files = db.list_build_files(build_id)
    if not files:
        raise RuntimeError("No source files found for this build.")
    for f in files:
        target = (root / f["path"]).resolve()
        target.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f["content"], encoding="utf-8", newline="\n")


def _next_bin(root: Path) -> str:
    return str(root / "node_modules" / ".bin" / "next")


def _ensure_badge(html: str) -> str:
    """Belt-and-suspenders: the badge is required and validated at codegen
    time, so this should always be a no-op — but if it's ever somehow
    missing from a page's real rendered HTML, inject the static fallback
    rather than ship a page with no badge."""
    if MEERO_BADGE_MARKER in html:
        return html
    if "</body>" in html:
        return html.replace("</body>", f"{_BADGE_FALLBACK_HTML}</body>", 1)
    return html + _BADGE_FALLBACK_HTML


def _upload_export(build_id: str, out_dir: Path) -> None:
    """Uploads every real file the static export produced, preserving its
    directory structure (Next's own _next/static/... asset tree included)."""
    for path in sorted(out_dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(out_dir).as_posix()
        if path.suffix == ".html":
            data = _ensure_badge(path.read_text(encoding="utf-8")).encode("utf-8")
        else:
            data = path.read_bytes()
        db.upload_preview_file(f"{build_id}/{rel}", data, content_type_for(rel))


def _exported_pages(out_dir: Path) -> list[tuple[str, str]]:
    """Every real page the static export produced, as (page_path,
    export_relative_path) — e.g. ("/", "index.html"), ("/about",
    "about/index.html"). `page_path` is written to match what the generated
    app's behavior tracker records (window.location.pathname with the
    /preview/{id} basePath stripped), which is the key the heatmap looks
    screenshots up by."""
    pages: list[tuple[str, str]] = []
    for path in sorted(out_dir.rglob("*.html")):
        if not path.is_file():
            continue
        rel = path.relative_to(out_dir).as_posix()
        if rel == "index.html":
            page_path = "/"
        elif rel.endswith("/index.html"):
            page_path = "/" + rel[: -len("/index.html")]
        else:
            page_path = "/" + rel[: -len(".html")]
        pages.append((page_path, rel))
    # "/" first — it's the page the dashboard opens on by default, so it's
    # the one that must survive the MAX_HEATMAP_PAGES cap.
    pages.sort(key=lambda p: (p[0] != "/", p[0]))
    return pages


def _capture_heatmap_screenshots(build_id: str, project_id: str, out_dir: Path) -> None:
    """Best-effort real per-page screenshots backing the Conversion tab's
    click heatmap — never fails the build. This runs HERE, in the web
    worker, because this is the only image with a headless Chromium; the API
    process can only read what this stores (see app/screenshot.py)."""
    try:
        from app.services.screenshots.screenshot import capture_heatmap_screenshots

        pages = _exported_pages(out_dir)
        n = capture_heatmap_screenshots(build_id, project_id, pages)
        log.info(
            "Heatmap screenshots captured for %s of %s page(s), project %s",
            n,
            len(pages),
            project_id,
        )
    except Exception:
        log.exception(
            "Heatmap screenshot pass failed for build %s (non-fatal)", build_id
        )


def _mark_conversion_build_failed(
    project_id: str, build_id: str, build_row: dict
) -> None:
    """Routes a failed build to the right conversion-agent failure handler
    based on which lifecycle action it was — a launch build that never
    shipped never ran an experiment (mark_launch_failed reopens the
    hypothesis); a graduate/revert build that never shipped must not leave
    the experiment looking permanently "already applied" (mark_graduation_
    failed clears graduation_build_id so it can be retried). A no-op for any
    build that isn't a conversion-experiment build at all."""
    if not build_row.get("is_conversion_experiment"):
        return
    action = build_row.get("conversion_experiment_action")
    experiment_id = build_row.get("conversion_experiment_id")
    if action == "launch":
        conversion_agent.mark_launch_failed(project_id, build_id, experiment_id)
    elif action in ("graduate", "revert") and experiment_id:
        conversion_agent.mark_graduation_failed(project_id, experiment_id, build_id)


def _capture_screenshot(build_id: str, project_id: str) -> None:
    """Best-effort real screenshot of this build's own just-published
    /preview page, via a headless Chromium — never fails the build. Hits the
    orchestrator's internal docker-network address (not public_base_url:
    "localhost" inside this container isn't the api container). Overwrites
    the project's previous screenshot (storage path keyed on project_id, not
    build_id) so the gallery always shows the latest successful build."""
    try:
        from playwright.sync_api import sync_playwright

        url = f"{get_settings().orchestrator_internal_url}/preview/{build_id}/index.html"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": 1280, "height": 800})
                page.goto(url, wait_until="networkidle", timeout=20000)
                data = page.screenshot(type="jpeg", quality=80)
            finally:
                browser.close()
        storage_path = f"{project_id}.jpg"
        db.upload_screenshot(storage_path, data, "image/jpeg")
        db.set_project_screenshot(project_id, db.screenshot_public_url(storage_path))
        log.info("Screenshot captured for project %s (build %s)", project_id, build_id)
    except Exception:
        log.exception(
            "Screenshot capture failed for build %s (non-fatal)", build_id
        )


def _run_readiness_checks(build_id: str, schema_sql: str) -> list[dict] | None:
    """Best-effort real "is your app ready?" checklist — never fails the
    build. See app/readiness_check.py for what actually runs (genuine
    signup, login, and anon-read isolation against the live app). Returns
    the real tri-state check results (or None if the pass itself crashed) —
    an autonomous fix (app/runtime_monitor.py) uses this return value as its
    verify-then-trust gate; every other build ignores it, same as before."""
    try:
        from app.services.readiness.readiness_check import run_readiness_checks

        url = f"{get_settings().orchestrator_internal_url}/preview/{build_id}/index.html"
        results = run_readiness_checks(url, schema_sql)
        db.set_build_readiness_checks(build_id, results)
        log.info("Readiness checks recorded for build %s: %s", build_id, results)
        return results
    except Exception:
        log.exception(
            "Readiness checks failed to run for build %s (non-fatal)", build_id
        )
        return None


def process_job(job: dict) -> None:
    build_id = job["build_id"]
    project_id = job["project_id"]
    settings = get_settings()
    # Hoisted above the try block (not fetched inside it, as it originally
    # was) so it's always safely defined in the except handlers below, even
    # if an exception fires before it would otherwise have been assigned —
    # the except handlers need it to know whether an autonomous fix
    # (app/runtime_monitor.py) that failed outright should report a
    # regression.
    build_row = db.get_build(build_id) or {}

    def phase(p: str) -> None:
        publish_event(
            {
                "type": "build.phase",
                "project_id": project_id,
                "build_id": build_id,
                "platform": "web",
                "phase": p,
            }
        )

    try:
        project = db.get_project(project_id)
        if project is None:
            raise RuntimeError("Project not found.")
        supabase_ref = project.get("supabase_project_ref")
        supabase_url = project.get("supabase_url")
        supabase_anon_key = project.get("supabase_anon_key")
        if not (supabase_ref and supabase_url and supabase_anon_key):
            raise SupabaseConnectError(
                "This app has no linked Supabase project — link one with the "
                "Supabase button in the builder header, then build again."
            )
        # The owner's live Management API token (auto-refreshed) — needed to
        # apply the schema to THEIR database.
        access_token = fresh_access_token(project["owner_id"])

        root = workspace_for(build_id, "web")
        if job.get("use_build_files"):
            _materialize_from_build_files(build_id, root)
        else:
            archive = db.download_artifact_file(job["storage_path"])
            unzip_to(archive, root)

        # Real DDL on the user's real database, before anything is served.
        # Checked right before the call — a real user-initiated stop
        # (POST /builds/{id}/cancel) means we never even issue it.
        if is_build_canceled(build_id):
            raise BuildCanceled()
        schema_path = root / "schema.sql"
        if not schema_path.exists():
            raise RuntimeError("Generated project is missing schema.sql.")
        schema_sql = schema_path.read_text(encoding="utf-8")
        phase("applying_schema")
        try:
            run_query(access_token, supabase_ref, schema_sql)
        except SupabaseConnectError as exc:
            # Tagged so the auto-fix's targeted-scoping (codegen.py) can route
            # straight to schema.sql, deterministically, rather than trying to
            # pattern-match a Postgres error (which never mentions a file
            # path) against known project paths. Only THIS call site's
            # failures are genuinely about schema.sql — fresh_access_token's
            # own errors above are a connection/auth problem, not a schema
            # bug, so they're deliberately left untagged.
            raise SupabaseConnectError(f"{SCHEMA_ERROR_MARKER} {exc}") from exc
        log.info("Schema applied for build %s on %s", build_id, supabase_ref)

        # Wire the app to the linked project and to its real serving path —
        # placeholders never persist past this workspace (build_files/GitHub
        # keep the portable source).
        _substitute_placeholders(
            root, supabase_url, supabase_anon_key, base_path=f"/preview/{build_id}"
        )

        if is_build_canceled(build_id):
            raise BuildCanceled()
        phase("building_app")
        _link_vendor_modules(root)
        build_env = dict(os.environ)
        build_env["NEXT_TELEMETRY_DISABLED"] = "1"  # no network calls at build time either
        # cancel_check makes this genuinely interruptible: a stop mid-`next
        # build` really kills the subprocess (see app/workers/common.py),
        # not just marks it canceled in the DB while it keeps running.
        result = run(
            [_next_bin(root), "build"],
            cwd=root,
            timeout=settings.build_timeout_s,
            env=build_env,
            cancel_check=lambda: is_build_canceled(build_id),
        )
        log.info("next build ok for build %s: %s", build_id, tail(result.stdout or "(no output)", 5))

        out_dir = root / "out"
        if not out_dir.exists():
            raise RuntimeError(
                "next build finished but produced no 'out/' directory — "
                "check that next.config.mjs sets output: 'export'."
            )
        _upload_export(build_id, out_dir)

        db.set_preview_url(build_id, f"{settings.public_base_url}/preview/{build_id}/index.html")
        db.add_artifact(build_id, "web_bundle", f"{build_id}/index.html")
        db.set_build_status(build_id, "succeeded")
        log.info("Web build %s succeeded", build_id)

        # Best-effort, never fails the build. A build fixing a captured
        # PRODUCTION runtime error ships as a reviewable PR (speculative —
        # only this one exception to the "builds commit to main" rule);
        # every other build/compile-fix commits straight to main.
        if build_row.get("is_runtime_fix"):
            maybe_open_runtime_fix_pr(project_id, build_id)
        else:
            maybe_commit_build_to_github(project_id, build_id)

        # Best-effort, never fails the build: only public projects ever show
        # up in the landing-page gallery, so only they pay the real
        # headless-browser cost of a screenshot.
        if project.get("is_public"):
            _capture_screenshot(build_id, project_id)

        # Best-effort, never fails the build: the Conversion tab's click
        # heatmap needs a real screenshot of each page to overlay points on.
        # Not gated on is_public — a private project's owner gets a heatmap
        # too — and re-shot every build so the overlay always matches the
        # layout the clicks were actually recorded against.
        _capture_heatmap_screenshots(build_id, project_id, out_dir)

        # Best-effort, never fails the build: every owner gets a real,
        # freshly-run readiness checklist for their own app.
        checks = _run_readiness_checks(build_id, schema_sql)

        # Verify-then-trust: an autonomous fix (app/runtime_monitor.py, no
        # human click) only gets its original error(s) marked resolved once
        # its OWN readiness checks genuinely pass — never optimistically,
        # unlike a manually-triggered fix. Never fails the build.
        if build_row.get("is_autonomous_fix"):
            try:
                runtime_monitor.evaluate_and_publish(
                    project, build_id, build_row, checks, access_token, supabase_ref
                )
            except Exception:
                log.exception(
                    "runtime monitor: verification step failed for build %s", build_id
                )

        # Same verify-then-trust idea, for the conversion agent's launch
        # builds: an experiment only starts really "running" (eligible for
        # evaluation) once its own readiness checks confirm the shipped
        # variant actually works — never fails the build.
        if (
            build_row.get("is_conversion_experiment")
            and build_row.get("conversion_experiment_action") == "launch"
        ):
            try:
                conversion_agent.mark_experiment_live(project, build_id, build_row, checks)
            except Exception:
                log.exception(
                    "conversion agent: launch verification failed for build %s", build_id
                )

    except BuildCanceled:
        # A real, user-initiated stop. db.set_build_status()'s sticky-
        # canceled guard means this is a no-op if the cancel endpoint's own
        # write already landed; either way the row ends up "canceled".
        log.info("Build %s canceled during web build", build_id)
        db.set_build_status(build_id, "canceled")
    except SupabaseConnectError as exc:
        db.set_build_status(build_id, "failed", error=str(exc))
        if build_row.get("is_autonomous_fix"):
            runtime_monitor.mark_build_failed(project_id, build_id)
        _mark_conversion_build_failed(project_id, build_id, build_row)
    except Exception as exc:  # noqa: BLE001 — worker must not die on one job
        stdout = getattr(exc, "stdout", "") or ""
        stderr = getattr(exc, "stderr", "") or ""
        error = extract_build_errors(stdout, stderr) if (stdout or stderr) else str(exc)
        log.exception("Web build failed for build %s", build_id)
        db.set_build_status(build_id, "failed", error=error)
        if build_row.get("is_autonomous_fix"):
            runtime_monitor.mark_build_failed(project_id, build_id)
        _mark_conversion_build_failed(project_id, build_id, build_row)


def main() -> None:
    log.info("Web worker up; waiting on %s", WEB_BUILD_QUEUE)
    while True:
        job = dequeue_blocking(WEB_BUILD_QUEUE)
        if job is not None:
            process_job(job)


if __name__ == "__main__":
    main()

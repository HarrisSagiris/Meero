"""Real per-page screenshots for the Conversion dashboard's click-heatmap
overlay (see app/conversion_agent.py, src/components/builder/conversion-heatmap.tsx).

WHERE THIS RUNS MATTERS. Capturing needs a headless Chromium, which only the
`web-worker` image installs (orchestrator/Dockerfile — `api`,
`codegen-worker` and `deploy-worker` all build the lean `base` stage on
purpose, and playwright isn't in requirements.txt at all). So capture happens
in the web worker right after a successful build, and the API process only
ever READS what's already stored.

This used to be capture-on-first-dashboard-request, called straight from
main.py's heatmap endpoint — which could never have worked in production:
the import of playwright raised ModuleNotFoundError inside the API
container, the bare `except` swallowed it, and the endpoint returned "no
screenshot" forever. Capturing at build time also keeps every image in sync
with the build it overlays, instead of pinning whatever the first request
happened to shoot (the storage path is keyed on page, not build, so a stale
image would otherwise never be replaced and the heatmap points would drift
against a layout that no longer exists).
"""

import logging

from app.infrastructure.database import db
from app.config import get_settings

log = logging.getLogger("meero.screenshot")

# Upper bound on how many pages one build will shoot. Generated apps have a
# handful of routes; this only exists so a pathologically large app can't
# turn a build into a browser-driven crawl.
MAX_HEATMAP_PAGES = 12


def heatmap_storage_path(project_id: str, page_path: str) -> str:
    slug = page_path.strip("/") or "index"
    # Storage paths can't contain arbitrary characters a page path might —
    # keep this simple and predictable rather than fighting edge cases.
    slug = slug.replace("/", "__")
    return f"heatmap/{project_id}/{slug}.jpg"


def stored_page_screenshot_url(project_id: str, page_path: str) -> str | None:
    """The already-captured screenshot for this page, or None. Read-only by
    design — the API process has no browser, so it must never try to capture
    (see the module docstring). None simply means this build hasn't shot
    this page yet; the heatmap renders its points without a background image
    rather than showing a fabricated one."""
    storage_path = heatmap_storage_path(project_id, page_path)
    if db.screenshot_exists(storage_path):
        return db.screenshot_public_url(storage_path)
    return None


def capture_heatmap_screenshots(
    build_id: str, project_id: str, pages: list[tuple[str, str]]
) -> int:
    """Shoots every page of a just-built app for the heatmap overlay, reusing
    ONE browser across all of them (a launch per page would dominate the
    cost). `pages` is (page_path, export_relative_path) — the real files the
    static export produced, so this never guesses at routes that don't exist.

    Always overwrites, so each successful build refreshes the overlay to
    match the layout the heatmap points were actually recorded against.
    Best-effort per page: one failure never aborts the rest, and the caller
    (the web worker) never fails a build over any of it. Returns how many
    were genuinely captured."""
    if not pages:
        return 0
    from playwright.sync_api import sync_playwright

    captured = 0
    base = get_settings().orchestrator_internal_url
    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            # Matches conversion-heatmap.tsx's overlay coordinate space: the
            # tracker records click x/y against the page's own width, so the
            # background image has to be shot at the same viewport width the
            # overlay assumes.
            page = browser.new_page(viewport={"width": 1280, "height": 2000})
            for page_path, rel in pages[:MAX_HEATMAP_PAGES]:
                try:
                    page.goto(f"{base}/preview/{build_id}/{rel}",
                              wait_until="networkidle", timeout=20000)
                    data = page.screenshot(type="jpeg", quality=80, full_page=True)
                    db.upload_screenshot(
                        heatmap_storage_path(project_id, page_path), data, "image/jpeg"
                    )
                    captured += 1
                except Exception:
                    log.exception(
                        "Heatmap screenshot failed for %s (build %s) — continuing",
                        page_path,
                        build_id,
                    )
        finally:
            browser.close()
    return captured

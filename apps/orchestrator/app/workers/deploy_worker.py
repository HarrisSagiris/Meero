"""Deploy worker — the Pro & Ultra real Vercel production release.

Never part of the base pipeline: triggered by a separate, explicit user
action (POST /builds/{id}/deploy in app/main.py). Ships the build's real
generated Next.js SOURCE (from build_files — the portable, placeholder
form) through Vercel's actual REST API with `projectSettings.framework =
"nextjs"`, so Vercel installs the pinned dependencies and runs its own real
`next build` — the same source the local worker already built and tested,
just built again by Vercel itself (Vercel's static hosting for `output:
"export"` needs no server runtime). Placeholders are substituted for the
linked Supabase project same as the local build, with __BASE_PATH__ → ""
(a Vercel release serves from its own domain root, not a /preview/{id}
subpath). Polls until Vercel reports READY, then persists the real
production URL. This worker only needs outbound HTTPS on a plain Linux
host — no OpenAI/langchain dependency, matching the "type-only" import
pattern other compile-only workers use.

Input: {build_id, project_id}. Never touches builds.status — a
failed/successful release doesn't change whether the base build succeeded.

Run:  python -m app.workers.deploy_worker
"""

import base64
import re
import time

import httpx

from app.infrastructure.database import db
from app.config import get_settings
from app.infrastructure.queues.queues import DEPLOY_QUEUE, dequeue_blocking, publish_event
from app.workers.common import log

VERCEL_API = "https://api.vercel.com"


class DeployError(Exception):
    """Raised when a real Vercel API call fails."""


def _vercel_params() -> dict[str, str]:
    team_id = get_settings().vercel_team_id
    return {"teamId": team_id} if team_id else {}


def _vercel_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {get_settings().vercel_token}"}


def vercel_project_name(project_name: str, project_id: str) -> str:
    """Stable, unique-per-Meero-project Vercel project name, so every release
    of the same project lands on the same Vercel project (and keeps its
    production domain) instead of minting a new one per deploy."""
    slug = re.sub(r"[^a-z0-9-]+", "-", project_name.lower()).strip("-")
    return f"{(slug or 'meero-app')[:80].strip('-')}-{project_id[:8]}"


def create_deployment(name: str, files: dict[str, str]) -> dict:
    """Creates a REAL production deployment from inline source files, with
    Vercel building it as a real Next.js app (installing the pinned
    dependencies from package.json and running its own `next build`).
    Returns the Vercel deployment object (id + url)."""
    payload = {
        "name": name,
        "target": "production",
        "files": [
            {
                "file": path,
                "data": base64.b64encode(content.encode("utf-8")).decode("ascii"),
                "encoding": "base64",
            }
            for path, content in files.items()
        ],
        "projectSettings": {"framework": "nextjs"},
    }
    response = httpx.post(
        f"{VERCEL_API}/v13/deployments",
        headers=_vercel_headers(),
        params=_vercel_params(),
        json=payload,
        timeout=120,
    )
    if response.status_code >= 300:
        raise DeployError(
            f"Vercel rejected the deployment ({response.status_code}): "
            f"{response.text[:300]}"
        )
    return response.json()


def wait_until_ready(deployment_id: str, timeout_s: int) -> dict:
    """Polls the real deployment until Vercel reports a terminal state."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        response = httpx.get(
            f"{VERCEL_API}/v13/deployments/{deployment_id}",
            headers=_vercel_headers(),
            params=_vercel_params(),
            timeout=60,
        )
        response.raise_for_status()
        deployment = response.json()
        state = deployment.get("readyState") or deployment.get("status")
        if state == "READY":
            return deployment
        if state in ("ERROR", "CANCELED"):
            raise DeployError(f"Vercel deployment ended in state {state}.")
        time.sleep(3)
    raise DeployError(
        f"Vercel didn't reach READY within {timeout_s}s — check the "
        f"deployment in your Vercel dashboard."
    )


def add_domain(vercel_project: str, domain: str) -> dict:
    """Adds a REAL custom domain to a Vercel project via the Management API
    (Pro/Ultra, after at least one real release — see POST
    /projects/{id}/domain in app/main.py). Returns Vercel's own response:
    `verified` (bool) and, when not yet verified, the real `verification`
    challenge(s) (DNS records) Vercel needs before it'll serve traffic on
    this domain — never a guessed/hardcoded set of DNS instructions."""
    response = httpx.post(
        f"{VERCEL_API}/v10/projects/{vercel_project}/domains",
        headers=_vercel_headers(),
        params=_vercel_params(),
        json={"name": domain},
        timeout=30,
    )
    if response.status_code >= 300:
        raise DeployError(
            f"Vercel rejected adding domain {domain!r} ({response.status_code}): "
            f"{response.text[:300]}"
        )
    return response.json()


def get_domain_status(vercel_project: str, domain: str) -> dict:
    """Reads the REAL current verification/config status of a domain
    already added to the Vercel project — used to re-check whether DNS has
    propagated since add_domain."""
    response = httpx.get(
        f"{VERCEL_API}/v9/projects/{vercel_project}/domains/{domain}",
        headers=_vercel_headers(),
        params=_vercel_params(),
        timeout=30,
    )
    if response.status_code >= 300:
        raise DeployError(
            f"Could not check domain {domain!r} status ({response.status_code}): "
            f"{response.text[:300]}"
        )
    return response.json()


def get_domain_config(domain: str) -> dict:
    """Reads the REAL live DNS state of a domain from Vercel's own resolver
    (`GET /v6/domains/{domain}/config`).

    This answers a genuinely different question from get_domain_status()
    above, and conflating the two is why a domain could previously read
    "Live" while not actually serving: the project-domain object's
    `verified` flag is about OWNERSHIP (has this account proven it may use
    the name), whereas `misconfigured` here is about whether the domain's
    DNS actually points at Vercel yet. A domain can be verified and still
    completely unreachable because the A/CNAME record was never added.

    Deliberately NOT scoped to a project or to domains already added —
    it's a pure DNS lookup, which is what makes the pre-add "is this
    domain already connected?" check possible. `recommendedIPv4` /
    `recommendedCNAME` in the response are Vercel's own current values, so
    the DNS instructions shown to the user are read from the API rather
    than hardcoded (they used to be a guessed literal in the UI)."""
    response = httpx.get(
        f"{VERCEL_API}/v6/domains/{domain}/config",
        headers=_vercel_headers(),
        params=_vercel_params(),
        timeout=30,
    )
    if response.status_code >= 300:
        raise DeployError(
            f"Could not read DNS config for {domain!r} ({response.status_code}): "
            f"{response.text[:300]}"
        )
    return response.json()


def verify_domain(vercel_project: str, domain: str) -> dict:
    """Asks Vercel to re-run the REAL ownership verification for a domain
    already added to the project (`POST .../domains/{domain}/verify`) —
    what turns `verified` true once the TXT challenge from add_domain()'s
    `verification` list is actually present in DNS.

    A 4xx here means "still not verifiable" (the challenge record isn't
    visible yet), which is a normal waiting state rather than a failure, so
    the caller gets the current status back instead of an exception."""
    response = httpx.post(
        f"{VERCEL_API}/v9/projects/{vercel_project}/domains/{domain}/verify",
        headers=_vercel_headers(),
        params=_vercel_params(),
        timeout=30,
    )
    if response.status_code >= 300:
        log.info(
            "Domain %s not verifiable yet (%s): %s",
            domain,
            response.status_code,
            response.text[:200],
        )
        return {}
    return response.json()


def remove_domain(vercel_project: str, domain: str) -> None:
    """Removes a REAL custom domain from the Vercel project. A 404 (already
    gone, e.g. removed directly in the Vercel dashboard) is not an error —
    the end state the caller wants is already true."""
    response = httpx.delete(
        f"{VERCEL_API}/v9/projects/{vercel_project}/domains/{domain}",
        headers=_vercel_headers(),
        params=_vercel_params(),
        timeout=30,
    )
    if response.status_code >= 300 and response.status_code != 404:
        raise DeployError(
            f"Could not remove domain {domain!r} ({response.status_code}): "
            f"{response.text[:300]}"
        )


def _deployed_url(deployment: dict) -> str:
    # Prefer the stable production alias (name.vercel.app) when Vercel
    # reports one; the per-deployment URL always works as a fallback.
    aliases = deployment.get("alias") or []
    host = aliases[0] if aliases else deployment.get("url")
    if not host:
        raise DeployError("Vercel returned no URL for the deployment.")
    return host if host.startswith("https://") else f"https://{host}"


def _substitute_for_deploy(
    rows: list[dict], supabase_url: str, anon_key: str
) -> dict[str, str]:
    """Same placeholder substitution as the local build worker's
    _substitute_placeholders(), but in-memory over build_files rows and with
    __BASE_PATH__ → "" — a Vercel release serves from its own domain root,
    not the orchestrator's /preview/{build_id} subpath."""
    ws_url = supabase_url.replace("https://", "wss://", 1)
    files: dict[str, str] = {}
    for row in rows:
        content = (
            row["content"]
            .replace("__SUPABASE_URL__", supabase_url)
            .replace("__SUPABASE_ANON_KEY__", anon_key)
            .replace("__SUPABASE_WS_URL__", ws_url)
            .replace("__BASE_PATH__", "")
        )
        files[row["path"]] = content
    return files


def process_job(job: dict) -> None:
    build_id = job["build_id"]
    project_id = job["project_id"]
    settings = get_settings()

    def phase(p: str, **extra) -> None:
        publish_event(
            {
                "type": "build.deploy_phase",
                "project_id": project_id,
                "build_id": build_id,
                "phase": p,
                **extra,
            }
        )

    try:
        phase("deploying")

        project = db.get_project(project_id)
        if project is None:
            raise DeployError("Project not found.")
        supabase_url = project.get("supabase_url")
        supabase_anon_key = project.get("supabase_anon_key")
        if not (supabase_url and supabase_anon_key):
            raise DeployError("This app has no linked Supabase project.")

        # The real generated Next.js source (placeholder form) — Vercel
        # builds it itself, so it needs the actual project files, not the
        # already-built preview bundle.
        rows = db.list_build_files(build_id)
        if not rows:
            raise DeployError("No generated source found for this build.")
        files = _substitute_for_deploy(rows, supabase_url, supabase_anon_key)

        name = vercel_project_name(project.get("name") or "Meero App", project_id)
        deployment = create_deployment(name, files)
        deployment = wait_until_ready(deployment["id"], settings.deploy_timeout_s)
        url = _deployed_url(deployment)

        db.set_build_deployment(build_id, project_id, url, deployment.get("id") or "")
        phase("succeeded", deploy_url=url)
        log.info("Release succeeded for build %s → %s", build_id, url)

    except Exception as exc:  # noqa: BLE001 — worker must not die on one job
        log.exception("Release failed for build %s", build_id)
        phase("failed", error=str(exc)[:500])


def main() -> None:
    log.info("Deploy worker up; waiting on %s", DEPLOY_QUEUE)
    while True:
        job = dequeue_blocking(DEPLOY_QUEUE)
        if job is not None:
            process_job(job)


if __name__ == "__main__":
    main()

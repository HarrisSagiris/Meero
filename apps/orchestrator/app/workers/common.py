"""Shared helpers for worker processes."""

from __future__ import annotations

import io
import logging
import shutil
import subprocess
import time
import zipfile
from pathlib import Path
from typing import TYPE_CHECKING, Callable

from app.config import get_settings
from app.errors import BuildCanceled

if TYPE_CHECKING:
    # Type-only: keeps this module importable without langchain_openai for
    # contexts that never generate code (workers that only bundle/deploy
    # already-generated source).
    from app.agents.codegen import ProjectBundle

log = logging.getLogger("meero.worker")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


def workspace_for(build_id: str, platform: str) -> Path:
    root = Path(get_settings().workspace_dir).resolve() / build_id / platform
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    return root


def write_bundle(bundle: ProjectBundle, root: Path) -> None:
    for f in bundle.files:
        target = (root / f.path).resolve()
        # Paths were validated at generation time; re-assert containment.
        target.relative_to(root)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f.content, encoding="utf-8", newline="\n")


def zip_dir(root: Path) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(root).as_posix())
    return buf.getvalue()


def unzip_to(data: bytes, root: Path) -> None:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for member in zf.namelist():
            # Reject absolute paths / traversal from archives, defensively.
            target = (root / member).resolve()
            target.relative_to(root.resolve())
        zf.extractall(root)


def run(
    cmd: list[str],
    cwd: Path,
    timeout: int = 1800,
    env: dict[str, str] | None = None,
    cancel_check: Callable[[], bool] | None = None,
    poll_interval: float = 1.0,
) -> subprocess.CompletedProcess[str]:
    """Run a real build command; raises CalledProcessError on failure.

    `env`, when given, fully replaces the child environment (pass a copy of
    os.environ with your overrides merged in). None inherits the parent env.

    `cancel_check`, when given, makes this genuinely interruptible: instead
    of one blocking `subprocess.run`, the process is polled every
    `poll_interval` seconds (via the documented "call communicate() again
    after a TimeoutExpired" pattern — no output is lost across polls). The
    moment `cancel_check()` returns True, the process is asked to terminate
    (SIGTERM), given a short grace period, then killed outright if it
    hasn't exited — real interruption of a real `next build`, not a UI
    fiction — and BuildCanceled is raised. Omitting `cancel_check` (the
    default; all pre-existing callers) preserves the exact original
    single-call blocking behavior.
    """
    log.info("$ %s (cwd=%s)", " ".join(cmd), cwd)
    if cancel_check is None:
        return subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=True,
            env=env,
        )

    proc = subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
    )
    deadline = time.monotonic() + timeout
    try:
        while True:
            try:
                stdout, stderr = proc.communicate(timeout=poll_interval)
                break
            except subprocess.TimeoutExpired:
                if cancel_check():
                    log.info("Cancel noticed mid-run; terminating: %s", " ".join(cmd))
                    proc.terminate()
                    try:
                        proc.communicate(timeout=10)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.communicate()
                    raise BuildCanceled() from None
                if time.monotonic() > deadline:
                    proc.kill()
                    proc.communicate()
                    raise subprocess.TimeoutExpired(cmd, timeout)
    finally:
        # Belt-and-suspenders: never leak a child process on any exit path.
        if proc.poll() is None:
            proc.kill()

    if proc.returncode != 0:
        raise subprocess.CalledProcessError(
            proc.returncode, cmd, output=stdout, stderr=stderr
        )
    return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)


def tail(text: str, lines: int = 60) -> str:
    return "\n".join(text.splitlines()[-lines:])


def extract_build_errors(
    stdout: str, stderr: str = "", *, max_chars: int = 3500
) -> str:
    """Pull the real build diagnostics out of a failed build's output.

    Covers both `next build`'s real diagnostics (`Failed to compile.` /
    `Type error: ...` / a `./app/page.tsx:12:3` source pointer) and generic
    tracebacks. This lifts those out so both the UI and the AI auto-fix
    receive the genuine cause, not a summary. Falls back to a tail of the
    raw log when no explicit diagnostic line is found, so the stored error
    is never empty or misleading.
    """
    combined = "\n".join(p for p in (stdout, stderr) if p)
    lines = combined.splitlines()
    picked: list[str] = []
    for i, line in enumerate(lines):
        low = line.lower().strip()
        is_error = (
            "[error]" in low
            or low.startswith("error:")
            or low.startswith("type error:")
            or low.startswith("syntax error")
            or low.startswith("failed to compile")
            or low.startswith("traceback (most recent call last)")
            or ": error " in low
            or "error generated." in low
        )
        if is_error:
            picked.append(line.rstrip())
            for ctx in lines[i + 1 : i + 6]:
                if ctx.strip():
                    picked.append(ctx.rstrip())

    if not picked:
        return tail(combined, 60)

    deduped: list[str] = []
    for entry in picked:
        if not deduped or deduped[-1] != entry:
            deduped.append(entry)
    return "\n".join(deduped)[-max_chars:]


# Extension → syntax label, used by the builder's Code tab for highlighting.
_LANGUAGE_BY_EXT = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".html": "html",
    ".css": "css",
    ".json": "json",
    ".py": "python",
    ".md": "markdown",
    ".txt": "text",
}


def language_for(path: str) -> str:
    """Best-effort syntax label for a generated file path."""
    name = path.rsplit("/", 1)[-1]
    dot = name.rfind(".")
    if dot == -1:
        return "text"
    return _LANGUAGE_BY_EXT.get(name[dot:].lower(), "text")

#!/usr/bin/env python3
"""Guards against the 2026-07-25 tailwind incident happening again: codegen.py's
VENDORED_PACKAGE_VERSIONS, prompts.py's literal copy of the same table, and the
Dockerfile's vendor-stage `npm install` args are three independently-edited
sources of truth for the exact same data. This diffs all three and fails loudly
on any drift, instead of silently breaking every generated app's build the next
time only one of the three gets updated.

Run manually: python3 apps/orchestrator/scripts/check_vendored_versions.py
Exits 0 if all three agree, 1 (with a diff) otherwise.
"""

from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ORCHESTRATOR_DIR = Path(__file__).resolve().parent.parent
CODEGEN_PY = ORCHESTRATOR_DIR / "app" / "agents" / "codegen.py"
PROMPTS_PY = ORCHESTRATOR_DIR / "app" / "agents" / "prompts.py"
DOCKERFILE = ORCHESTRATOR_DIR / "Dockerfile"


def load_codegen_versions() -> dict[str, str]:
    tree = ast.parse(CODEGEN_PY.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            if node.target.id == "VENDORED_PACKAGE_VERSIONS" and node.value is not None:
                return ast.literal_eval(node.value)
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "VENDORED_PACKAGE_VERSIONS":
                    return ast.literal_eval(node.value)
    raise RuntimeError(f"VENDORED_PACKAGE_VERSIONS not found in {CODEGEN_PY}")


def load_prompts_versions() -> dict[str, str]:
    text = PROMPTS_PY.read_text()
    anchor = "EXACT version strings"
    idx = text.find(anchor)
    if idx == -1:
        raise RuntimeError(f"Anchor text {anchor!r} not found in {PROMPTS_PY}")
    fence_start = text.find("```", idx)
    fence_end = text.find("```", fence_start + 3)
    if fence_start == -1 or fence_end == -1:
        raise RuntimeError(f"Could not find fenced version table in {PROMPTS_PY}")
    block = text[fence_start + 3 : fence_end]
    versions: dict[str, str] = {}
    for line in block.splitlines():
        match = re.match(r'\s*"([^"]+)":\s*"([^"]+)"\s*$', line)
        if match:
            versions[match.group(1)] = match.group(2)
    if not versions:
        raise RuntimeError(f"Parsed zero packages from the fenced table in {PROMPTS_PY}")
    return versions


def load_dockerfile_versions() -> dict[str, str]:
    text = DOCKERFILE.read_text()
    versions: dict[str, str] = {}
    for match in re.finditer(r"(@?[\w.\-/]+)@(\^[\w.]+)", text):
        versions[match.group(1)] = match.group(2)
    if not versions:
        raise RuntimeError(f"Parsed zero packages from {DOCKERFILE}")
    return versions


def main() -> int:
    sources = {
        "codegen.py (VENDORED_PACKAGE_VERSIONS)": load_codegen_versions(),
        "prompts.py (_SHARED_CODEGEN_RULES table)": load_prompts_versions(),
        "Dockerfile (vendor stage npm install)": load_dockerfile_versions(),
    }

    all_packages = sorted(set().union(*sources.values()))
    problems: list[str] = []

    for pkg in all_packages:
        versions_seen = {name: src.get(pkg) for name, src in sources.items()}
        distinct = set(versions_seen.values())
        if len(distinct) > 1:
            detail = ", ".join(f"{name}={ver!r}" for name, ver in versions_seen.items())
            problems.append(f"  {pkg}: {detail}")

    if problems:
        print("VENDORED PACKAGE VERSION MISMATCH — the three sources disagree:\n")
        print("\n".join(problems))
        print(
            "\nKeep app/agents/codegen.py's VENDORED_PACKAGE_VERSIONS, "
            "app/agents/prompts.py's _SHARED_CODEGEN_RULES table, and "
            "Dockerfile's vendor-stage npm install in exact sync."
        )
        return 1

    print(f"OK — {len(all_packages)} packages match exactly across all three sources.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

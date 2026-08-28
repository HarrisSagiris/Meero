"""Shared file-extension -> MIME type mapping for live app bundles. Used
both when uploading to the previews bucket (app/workers/web_worker.py) and
when the orchestrator re-serves those files itself (app/main.py's /preview
route) — see that route's docstring for why serving Supabase Storage's own
public URL directly doesn't work.
"""

from pathlib import Path

CONTENT_TYPES: dict[str, str] = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".map": "application/json",
    ".wasm": "application/wasm",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".txt": "text/plain",
    ".mp4": "video/mp4",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
}


def content_type_for(path: str) -> str:
    return CONTENT_TYPES.get(Path(path).suffix.lower(), "application/octet-stream")

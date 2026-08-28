"""Real transactional email via Resend's REST API.

Generated apps request a send by inserting a row into their own
`_meero_emails` table (see MEERO_EMAILS_TABLE in app/agent/codegen.py);
`_start_email_poller` in app/main.py reads real pending rows back across
every Supabase-linked project and calls `send_email` here. No mock/queue-only
mode — a missing RESEND_API_KEY just means the poller skips its pass
entirely (Settings.resend_configured), never a fake "sent" status.
"""

import httpx

from app.config import get_settings

RESEND_API = "https://api.resend.com"


class EmailSendError(Exception):
    """Raised when Resend genuinely rejects or fails to send a message."""


def send_email(
    to_email: str, subject: str, body: str, html: str | None = None
) -> None:
    """`html` is optional so every existing caller (generated apps'
    _meero_emails poller) keeps sending plain text exactly as before —
    pass it to send a real HTML email, with `body` as the plain-text
    fallback Resend includes alongside it for clients that want it."""
    settings = get_settings()
    payload: dict[str, object] = {
        "from": settings.resend_from_email,
        "to": [to_email],
        "subject": subject,
        "text": body,
    }
    if html is not None:
        payload["html"] = html
    response = httpx.post(
        f"{RESEND_API}/emails",
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if response.status_code >= 300:
        raise EmailSendError(
            f"Resend rejected the send to {to_email!r} ({response.status_code}): "
            f"{response.text[:300]}"
        )

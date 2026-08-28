"""Real, self-hosted email OTP verification for signup.

Replaces reliance on Supabase's own "Confirm signup" email template (its
dashboard editor proved unreliable to customize) with a genuine 6-digit
code: generated with a real CSPRNG, stored hashed with a real expiry and a
real attempt limit (never the raw code), and sent through the exact same
real Resend integration (email_send.py) generated apps already use for
their own transactional email. Nothing here is simulated — a wrong or
expired code genuinely fails.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from app.infrastructure.database.db import get_supabase
from app.services.email.send import send_email

OTP_TTL_MINUTES = 10
MAX_ATTEMPTS = 5


class OtpError(Exception):
    """Raised when sending a real OTP email genuinely fails."""


def _hash(user_id: str, code: str) -> str:
    # Not a password — a 10-minute, 5-attempt-limited, single-use code
    # stored in a service-role-only table. A plain hash keeps the raw code
    # out of the database without needing a per-row salt for this threat
    # model.
    return hashlib.sha256(f"{user_id}:{code}".encode("utf-8")).hexdigest()


def _otp_email_html(code: str) -> str:
    # code is always exactly 6 digits (see send_otp) — no user input ever
    # reaches this template, so no escaping is needed to interpolate it.
    return f"""\
<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f6f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f5f4;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="padding:40px 36px 36px;">
                <p style="margin:0 0 32px;font-size:19px;font-weight:700;letter-spacing:-0.02em;color:#0a0a0a;">Meero</p>
                <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;letter-spacing:-0.01em;color:#0a0a0a;">Verify your email</h1>
                <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#454545;">
                  Enter this code to finish creating your Meero account:
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                  <tr>
                    <td align="center" style="background-color:#f6f5f4;border-radius:16px;padding:22px 0;">
                      <span style="font-family:'SF Mono',Consolas,Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#0a0a0a;">{code}</span>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#8a8a8a;">
                  This code expires in {OTP_TTL_MINUTES} minutes. If you didn't request this, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px;border-top:1px solid #e7e5e3;">
                <p style="margin:0;font-size:12px;color:#8a8a8a;">Meero &middot; Describe it. Ship it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def send_otp(user_id: str, email: str) -> None:
    """Generates a real 6-digit code, stores its hash (replacing any
    previous one for this user), and emails it for real via Resend."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    expires_at = (
        datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES)
    ).isoformat()

    get_supabase().table("email_otps").upsert(
        {
            "user_id": user_id,
            "code_hash": _hash(user_id, code),
            "expires_at": expires_at,
            "attempts": 0,
        }
    ).execute()

    send_email(
        email,
        "Your Meero verification code",
        f"Your verification code is {code}\n\n"
        f"It expires in {OTP_TTL_MINUTES} minutes. If you didn't request "
        f"this, you can safely ignore this email.",
        html=_otp_email_html(code),
    )


def verify_otp(user_id: str, code: str) -> bool:
    """Real, one-shot verification: wrong code increments a real attempt
    counter (capped at MAX_ATTEMPTS); a correct code deletes the row and
    marks profiles.email_verified — for real, not optimistically."""
    client = get_supabase()
    res = (
        client.table("email_otps")
        .select("*")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    row = res.data if res else None
    if row is None:
        return False
    if row["attempts"] >= MAX_ATTEMPTS:
        return False

    expires_at = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        return False

    if row["code_hash"] != _hash(user_id, code):
        client.table("email_otps").update({"attempts": row["attempts"] + 1}).eq(
            "user_id", user_id
        ).execute()
        return False

    client.table("email_otps").delete().eq("user_id", user_id).execute()
    client.table("profiles").update({"email_verified": True}).eq(
        "id", user_id
    ).execute()
    return True

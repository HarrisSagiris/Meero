"use client";

import { useEffect, useRef, useState } from "react";
import { OtpInput } from "@/modules/auth/views/ui/otp-input";
import { createClient } from "@/lib/supabase/client";

async function authHeader(): Promise<{ base: string; headers: Record<string, string> } | null> {
  const base = process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!base || !session) return null;
  return { base, headers: { Authorization: `Bearer ${session.access_token}` } };
}

/**
 * Real OTP verification against OUR OWN orchestrator endpoints
 * (/auth/otp/verify, /auth/otp/send — app/email_otp.py), not Supabase's
 * verifyOtp — the session already exists (signup() created it the moment
 * Supabase's "Confirm email" toggle is off); this just marks
 * profiles.email_verified so the proxy stops routing here.
 */
export function VerifyEmailForm({
  email,
  initialSendFailed = false,
}: {
  email: string;
  initialSendFailed?: boolean;
}) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const autoRetried = useRef(false);

  async function verify(code: string) {
    setVerifying(true);
    setError(null);
    const auth = await authHeader();
    if (!auth) {
      setError("Session expired — reload and sign in again.");
      setVerifying(false);
      return;
    }
    let res: Response;
    try {
      res = await fetch(`${auth.base}/auth/otp/verify`, {
        method: "POST",
        headers: { ...auth.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
    } catch {
      // A thrown fetch (network/CORS failure) carries no useful message for
      // a real user, unlike the server's own `detail` on a clean non-2xx
      // response below — never surface the raw browser exception text.
      setError("Couldn't reach Meero — check your connection and try again.");
      setVerifying(false);
      setAttempt((a) => a + 1);
      return;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setError(body?.detail || "That code didn't work.");
      setVerifying(false);
      setAttempt((a) => a + 1); // remounts OtpInput, clearing the boxes
      return;
    }
    // Real full reload so the proxy re-checks email_verified fresh on the
    // very first request and lets it through.
    window.location.href = "/";
  }

  async function resend() {
    setResending(true);
    setError(null);
    setResent(false);
    const auth = await authHeader();
    if (!auth) {
      setResending(false);
      setError("Session expired — reload and sign in again.");
      return;
    }
    let res: Response;
    try {
      res = await fetch(`${auth.base}/auth/otp/send`, {
        method: "POST",
        headers: auth.headers,
      });
    } catch {
      // Same reasoning as verify() above — a raw network/CORS exception has
      // no message worth showing a real user.
      setError("Couldn't reach Meero — check your connection and try again.");
      setResending(false);
      return;
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.detail || "Could not resend the code.");
      setResending(false);
      return;
    }
    setResent(true);
    setResending(false);
  }

  // The signup action's own send is best-effort (a network blip there
  // shouldn't strand the user with no path forward) — this retries it for
  // real the moment the page mounts, instead of silently claiming success
  // on a code that was never sent.
  useEffect(() => {
    if (initialSendFailed && !autoRetried.current) {
      autoRetried.current = true;
      void resend();
    }
  }, [initialSendFailed]);

  const emailEl = <span className="font-medium text-foreground">{email}</span>;
  const introText =
    !initialSendFailed || resent ? (
      <>
        We sent a 6-digit code to {emailEl}. Enter it below — or paste the whole thing into any box.
      </>
    ) : error ? (
      <>We couldn&apos;t send a code to {emailEl} — try again below.</>
    ) : (
      <>Sending your code to {emailEl}…</>
    );

  return (
    <div>
      <h1 className="text-4xl font-semibold tracking-tight">Check your email</h1>
      <p className="mt-4 text-[15px] leading-relaxed text-secondary-foreground">{introText}</p>

      <div className="mt-8">
        <OtpInput key={attempt} onComplete={verify} disabled={verifying} />
      </div>

      {verifying && <p className="mt-4 text-center text-sm text-muted-foreground">Verifying…</p>}
      {error && (
        <p role="alert" className="mt-4 text-center text-sm text-red-600">
          {error}
        </p>
      )}

      <p className="mt-8 text-center text-sm text-secondary-foreground">
        Didn&apos;t get it?{" "}
        <button
          type="button"
          onClick={() => void resend()}
          disabled={resending}
          className="font-medium underline disabled:opacity-50"
        >
          {resending ? "Sending…" : "Resend code"}
        </button>
        {resent && <span className="ml-1 text-emerald-700">Sent.</span>}
      </p>
    </div>
  );
}

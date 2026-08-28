"use client";

import Link from "next/link";
import { useState } from "react";
import { OtpInput } from "@/modules/auth/views/ui/otp-input";
import { createClient } from "@/lib/supabase/client";

/**
 * Real OTP verification — no email link, no separate tab/page to get
 * "stuck" on. Supabase's "Confirm signup" email must include {{ .Token }}
 * (the real 6-digit code) for this to have anything to check against; see
 * deploy/README.md / project setup notes. verifyOtp runs on the BROWSER
 * client on purpose: @supabase/ssr's browser client writes the resulting
 * session straight into real cookies, which every server component then
 * sees on the next request — same mechanism the rest of the app's
 * cookie-based auth already relies on.
 */
export function VerifyCodeForm({ email }: { email: string }) {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [attempt, setAttempt] = useState(0);

  async function verify(code: string) {
    setVerifying(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });
    if (error) {
      setError(error.message || "That code didn't work — check it and try again.");
      setVerifying(false);
      setAttempt((a) => a + 1); // remounts OtpInput, clearing the boxes
      return;
    }
    // Real session now set via cookies — a full reload (not router.push)
    // so every server component, and the onboarding-redirect proxy, sees
    // it fresh on the very first request.
    window.location.href = "/";
  }

  async function resend() {
    setResending(true);
    setError(null);
    setResent(false);
    const supabase = createClient();
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setResending(false);
    if (error) {
      setError(error.message || "Could not resend the code.");
      return;
    }
    setResent(true);
  }

  return (
    <div>
      <h1 className="font-serif text-[40px] leading-[1.1] tracking-tight text-foreground">
        Check your email
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed text-secondary-foreground">
        We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>.
        Enter it below — or paste the whole thing into any box.
      </p>

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
      <p className="mt-2 text-center text-sm text-secondary-foreground">
        Wrong address?{" "}
        <Link href="/signup" className="font-medium underline">
          Start over
        </Link>
      </p>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { login, signup, type AuthState } from "@/modules/auth/actions/auth-actions";
import { GoogleButton } from "@/modules/auth/views/ui/google-button";
import { VerifyCodeForm } from "@/modules/auth/views/ui/verify-code-form";

const initialState: AuthState = {};

export function AuthForm({
  mode,
  initialError,
  invitedBy,
}: {
  mode: "login" | "signup";
  initialError?: string;
  /** Creator name from a referral link (meero.im/{slug}) — signup only. */
  invitedBy?: string | null;
}) {
  const action = mode === "login" ? login : signup;
  const [state, formAction, pending] = useActionState(action, initialState);
  // Tracked locally (not just read from the form on submit) so it's still
  // available to pass to VerifyCodeForm once the server action's pending-
  // confirmation message comes back.
  const [email, setEmail] = useState("");

  const isSignup = mode === "signup";
  const error = state.error ?? initialError;

  if (state.message) {
    return <VerifyCodeForm email={email} />;
  }

  return (
    <div>
      {isSignup && invitedBy && (
        <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[12.5px] font-medium text-primary">
          Invited by {invitedBy}
        </div>
      )}
      <h1 className="font-sans text-[32px] font-bold leading-[1.15] tracking-tight text-foreground">
        {isSignup ? "Create your account" : "Welcome back"}
        <span className="text-primary">.</span>
      </h1>

      <div className="mt-8 space-y-3">
        <GoogleButton label={isSignup ? "Continue with Google" : "Sign in with Google"} />
      </div>

      <div className="my-7 flex items-center gap-4">
        <span className="h-px flex-1 bg-border" />
        <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground">
          OR
        </span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-foreground">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-2xl border border-input bg-white px-4 py-3 text-[15px] outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-foreground">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            required
            minLength={isSignup ? 8 : undefined}
            placeholder={isSignup ? "At least 8 characters" : "Your password"}
            className="w-full rounded-2xl border border-input bg-white px-4 py-3 text-[15px] outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}

        {isSignup && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            By continuing, you agree to the Terms of Service and Privacy Policy.
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-primary px-4 py-3 text-[15px] font-medium text-white shadow-primary/10 transition hover:bg-primary/85 disabled:pointer-events-none disabled:opacity-60"
        >
          {pending ? "One moment…" : "Continue"}
        </button>
      </form>

      <p className="mt-6 text-sm text-secondary-foreground">
        {isSignup ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium underline">
              Log in
            </Link>
          </>
        ) : (
          <>
            New to Meero?{" "}
            <Link href="/signup" className="font-medium underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

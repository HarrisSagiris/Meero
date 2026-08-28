"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { REFERRAL_COOKIE } from "@/modules/auth/utils/referral";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  /** Set after signup when email confirmation is pending. */
  message?: string;
};

function credentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

/** Catch obviously unconfigured env before making a doomed network call. */
function envProblem(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key || url.includes("YOUR-PROJECT-REF") || key.startsWith("YOUR-")) {
    return "Supabase isn't configured: fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env, then restart the dev server.";
  }
  return null;
}

/**
 * Supabase auth errors sometimes carry useless messages (e.g. "{}") when
 * the request never reached the auth server. Log the raw error for the dev
 * console and show something actionable instead.
 */
function humanizeAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : String(error).trim();
  if (!message || message === "{}" || message.toLowerCase().includes("fetch")) {
    console.error("[auth] unreadable Supabase auth error:", error);
    return "Couldn't reach Supabase. Check NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env (restart the dev server after editing) and your network.";
  }
  return message;
}

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = credentials(formData);
  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  const misconfig = envProblem();
  if (misconfig) return { error: misconfig };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: humanizeAuthError(error) };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const { email, password } = credentials(formData);
  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  const misconfig = envProblem();
  if (misconfig) return { error: misconfig };

  const supabase = await createClient();

  // Real cap check, not just cosmetic — handle_new_user() (00019) enforces
  // the same limit at the DB trigger regardless of this pre-check, so a
  // race here just means a less friendly error, never an over-admit.
  const { data: settings } = await supabase
    .from("app_settings")
    .select("signup_cap")
    .eq("id", true)
    .maybeSingle<{ signup_cap: number | null }>();
  if (settings?.signup_cap != null) {
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= settings.signup_cap) {
      return { error: "Signups are full for now — check back soon." };
    }
  }

  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    return { error: humanizeAuthError(error) };
  }

  // Supabase obfuscates duplicate signups: it "succeeds" but returns a user
  // with no identities and sends nothing. Surface that honestly.
  if (data.user && data.user.identities?.length === 0) {
    return {
      error: "This email is already registered. Log in instead (or reset your password).",
    };
  }

  // If Supabase's own "Confirm email" toggle is still on (Authentication →
  // Providers → Email), no session exists yet and this is the fallback
  // path — Supabase's own link/OTP flow, verified by VerifyCodeForm via
  // supabase.auth.verifyOtp. Turning that toggle OFF (see
  // 00037_email_otp.sql) makes signUp() return a real session immediately
  // instead, which is what routes through the real path below.
  if (!data.session) {
    return {
      message: "Check your inbox — we sent a 6-digit code.",
    };
  }

  // Attribute the signup to a creator referral link, if one was clicked
  // in the last 30 days (src/app/[creator]/route.ts sets the cookie).
  // Best-effort under the new user's own fresh session — auth.uid()
  // already equals data.user.id, so the normal owner-scoped RLS policies
  // cover both writes with no elevated privilege needed.
  const refSlug = (await cookies()).get(REFERRAL_COOKIE)?.value;
  if (refSlug && data.user) {
    const { data: referral } = await supabase
      .from("creator_referrals")
      .select("id")
      .eq("slug", refSlug)
      .maybeSingle();
    if (referral) {
      await supabase.from("profiles").update({ referred_by: referral.id }).eq("id", data.user.id);
      await supabase.from("creator_referral_events").insert({
        referral_id: referral.id,
        event_type: "signup",
        user_id: data.user.id,
      });
    }
    (await cookies()).delete(REFERRAL_COOKIE);
  }

  // Real session exists — send our OWN 6-digit code for real via Resend
  // (app/email_otp.py) rather than relying on Supabase's email template.
  // Best-effort: /verify-email has its own "Resend code" button if this
  // particular request fails, so a network blip here doesn't strand the
  // user with no way to get a code.
  const orchestratorUrl =
    process.env.ORCHESTRATOR_INTERNAL_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  // Still best-effort — a network blip here shouldn't block the redirect —
  // but the outcome rides along so /verify-email can retry for real instead
  // of claiming a code was sent when it wasn't (VerifyEmailForm's
  // initialSendFailed prop).
  let sendOk = false;
  if (orchestratorUrl) {
    sendOk = await fetch(`${orchestratorUrl}/auth/otp/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      cache: "no-store",
    })
      .then((res) => res.ok)
      .catch(() => false);
  }

  revalidatePath("/", "layout");
  redirect(sendOk ? "/verify-email" : "/verify-email?sendFailed=1");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

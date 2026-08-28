import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { RESERVED_TOP_LEVEL_SLUGS } from "@/lib/reserved-slugs";

/** Route prefixes reachable without a session. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/error", "/news"];

/** This proxy runs on nearly every request (see `config.matcher` in
 *  src/proxy.ts), so an unbounded Supabase call here hangs the ENTIRE
 *  site — the request just sits until nginx's own proxy_read_timeout
 *  gives up (observed 2026-08-23: intermittent 504s on plain GET/POST /
 *  with a perfectly healthy container and zero app-level errors, because
 *  the hang never throws or logs anything). Bounding every call this
 *  proxy makes means a slow/unreachable Supabase degrades to "treated as
 *  logged-out" for that one request instead of stalling the whole site. */
const AUTH_TIMEOUT_MS = 5000;

function timeoutFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(AUTH_TIMEOUT_MS) });
}

/**
 * Refreshes the Supabase session on every request (official @supabase/ssr
 * pattern) and enforces auth: everything except the public prefixes
 * requires a real signed-in user.
 *
 * IMPORTANT: the returned response must carry the refreshed auth cookies
 * exactly as set below — do not mutate cookies afterwards.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: timeoutFetch },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and auth.getUser() —
  // it can cause random logouts. A timed-out/unreachable Supabase is
  // treated as logged-out rather than left to hang the request.
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  const path = request.nextUrl.pathname;
  // A bare single-segment path (no further slashes) that isn't one of the
  // app's known top-level routes might be a creator referral link
  // (src/app/[creator]/route.ts, meero.im/{slug}) — those are anonymous,
  // pre-signup links, so let them through without a DB lookup here. The
  // route handler itself does the real slug validation and redirects
  // anything invalid home, so this is just deferring, not skipping, the check.
  const singleSegment = path.match(/^\/([^/]+)$/);
  const isPotentialCreatorLink =
    singleSegment !== null && !RESERVED_TOP_LEVEL_SLUGS.has(singleSegment[1]);

  // The root "/" is public: logged-out visitors get the marketing landing
  // (page.tsx renders <Landing/>), logged-in users get their dashboard.
  // Every OTHER non-public path still requires a session.
  const isPublic =
    path === "/" ||
    PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ||
    isPotentialCreatorLink;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (user && (path.startsWith("/login") || path.startsWith("/signup"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Funnel a freshly signed-up user through email verification
  // (profiles.email_verified, 00037_email_otp.sql) and then onboarding
  // (profiles.onboarded, 00036_onboarding.sql) before anywhere else — but
  // never intercept the OAuth/email-confirm exchange itself (/auth/*),
  // and never loop on the two gate pages themselves. Verification comes
  // first: onboarding shouldn't start before the account is confirmed.
  if (user && path !== "/onboarding" && path !== "/verify-email" && !path.startsWith("/auth")) {
    let profile: { onboarded: boolean; email_verified: boolean } | null = null;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("onboarded, email_verified")
        .eq("id", user.id)
        .maybeSingle();
      profile = data;
    } catch {
      // Timed-out/unreachable Supabase — don't block the request on an
      // onboarding/verification state we can't actually confirm.
      profile = null;
    }
    if (profile && profile.email_verified === false) {
      const url = request.nextUrl.clone();
      url.pathname = "/verify-email";
      url.search = "";
      return NextResponse.redirect(url);
    }
    if (profile && profile.onboarded === false) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

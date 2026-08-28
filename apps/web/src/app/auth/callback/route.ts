import { createClient } from "@/lib/supabase/server";

/**
 * OAuth / PKCE callback: exchanges the `code` from Supabase for a real
 * cookie-based session.
 *
 * Redirects with a bare relative Location header, never an absolute URL
 * built from the incoming request's origin. Behind a reverse proxy that
 * doesn't perfectly preserve Host/X-Forwarded-Proto, `new URL(request.url)`
 * can reflect the container's own bind address (e.g. 0.0.0.0:3000) instead
 * of the real public domain — a relative Location is resolved by the
 * browser against whatever host it's actually on, so it's correct
 * regardless of what the proxy did to the request it forwarded.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  // Only allow relative redirect targets.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return new Response(null, { status: 302, headers: { Location: safeNext } });
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: `/login?error=${encodeURIComponent("Sign-in failed. Please try again.")}`,
    },
  });
}

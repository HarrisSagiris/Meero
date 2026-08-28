import { NextResponse, type NextRequest } from "next/server";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE_S } from "@/modules/auth/utils/referral";
import { createClient } from "@/lib/supabase/server";

/**
 * Public creator referral link (meero.im/{slug}) — src/lib/supabase/proxy.ts
 * lets any unrecognized single-segment path through unauthenticated so it
 * can reach here. A route handler (not a page) because setting the
 * attribution cookie needs Set-Cookie on the redirect response itself —
 * Server Components can't write cookies.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ creator: string }> },
) {
  const { creator: slug } = await params;
  const supabase = await createClient();

  const { data: referral } = await supabase
    .from("creator_referrals")
    .select("id, slug")
    .eq("slug", slug)
    .maybeSingle();

  // Unknown or deactivated slug (RLS already hides inactive rows) — land
  // on the normal site, no cookie, no event.
  if (!referral) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Best-effort click log — never blocks the redirect.
  await supabase
    .from("creator_referral_events")
    .insert({ referral_id: referral.id, event_type: "click" });

  const response = NextResponse.redirect(new URL("/signup", request.url));
  response.cookies.set(REFERRAL_COOKIE, referral.slug, {
    maxAge: REFERRAL_COOKIE_MAX_AGE_S,
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
  return response;
}

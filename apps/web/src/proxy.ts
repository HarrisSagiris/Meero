import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and crawler files (those
     * must be reachable without a session — Googlebot never logs in).
     * Video extensions matter here too: the landing page's hero video
     * (public/videos/*.mp4) must load for logged-out visitors — without
     * this, the proxy 307-redirected the video request itself to /login,
     * so the <video> element got HTML back instead of video bytes.
     * Auth enforcement itself lives in updateSession().
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm)$).*)",
  ],
};

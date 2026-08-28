/**
 * Shared between src/app/[creator]/route.ts (sets it on click) and
 * src/app/(auth)/actions.ts (reads it on signup) — kept here rather than
 * duplicated since route.ts's exports are restricted to HTTP method
 * handlers and a few reserved config names by Next's route handler convention.
 */
export const REFERRAL_COOKIE = "meero_ref";
export const REFERRAL_COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days

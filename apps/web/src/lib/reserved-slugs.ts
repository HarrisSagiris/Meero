/**
 * Every top-level route segment already used under src/app. Next's static
 * routes always win over the [creator] dynamic route regardless of what's
 * in this set, so this isn't a security control — it just stops the admin
 * from minting a creator link that could never actually be reached.
 */
export const RESERVED_TOP_LEVEL_SLUGS = new Set([
  "admin",
  "auth",
  "billing",
  "login",
  "signup",
  "news",
  "onboarding",
  "profile",
  "project",
  "projects",
  "verify-email",
  "error",
]);

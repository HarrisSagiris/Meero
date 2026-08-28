import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Safe to call in Client Components;
 * `createBrowserClient` returns a singleton under the hood.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

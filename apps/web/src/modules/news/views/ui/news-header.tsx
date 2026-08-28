import Link from "next/link";
import { MeeroWordmark } from "@/components/logo";
import { createClient } from "@/lib/supabase/server";

/** Shared header for the public /news pages — auth-aware so a signed-in
 *  visitor gets a way back into the app instead of "Log in"/"Sign up". */
export async function NewsHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5">
      <MeeroWordmark height={34} />
      {user ? (
        <Link
          href="/"
          className="rounded-xl bg-foreground px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-neutral-800"
        >
          Back to dashboard
        </Link>
      ) : (
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="rounded-xl px-3.5 py-2 text-[13.5px] font-medium text-secondary-foreground transition hover:text-foreground"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-xl bg-foreground px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-neutral-800"
          >
            Sign up
          </Link>
        </div>
      )}
    </header>
  );
}

import { cookies } from "next/headers";
import { AuthShell } from "@/modules/auth/views/ui/auth-shell";
import { AuthForm } from "@/modules/auth/views/ui/auth-form";
import { REFERRAL_COOKIE } from "@/modules/auth/utils/referral";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Sign up — Meero" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Set by src/app/[creator]/route.ts when this visitor came in through a
  // creator referral link — shown as an "Invited by {creator}" badge below.
  const refSlug = (await cookies()).get(REFERRAL_COOKIE)?.value;
  let invitedBy: string | null = null;
  if (refSlug) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("creator_referrals")
      .select("creator_name")
      .eq("slug", refSlug)
      .maybeSingle();
    invitedBy = data?.creator_name ?? null;
  }

  return (
    <AuthShell>
      <AuthForm mode="signup" initialError={error} invitedBy={invitedBy} />
    </AuthShell>
  );
}

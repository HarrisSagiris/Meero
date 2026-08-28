import { redirect } from "next/navigation";
import { AuthShell } from "@/modules/auth/views/ui/auth-shell";
import { VerifyEmailForm } from "@/modules/auth/views/ui/verify-email-form";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Verify your email — Meero" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ sendFailed?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("email_verified")
    .eq("id", user.id)
    .maybeSingle();
  // Defensive — the proxy already keeps a verified user from reaching
  // this route, this just covers a stale/cached direct hit.
  if (profile?.email_verified) redirect("/");

  const { sendFailed } = await searchParams;

  return (
    <AuthShell>
      <VerifyEmailForm email={user.email ?? ""} initialSendFailed={sendFailed === "1"} />
    </AuthShell>
  );
}

import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/modules/onboarding/views/ui/onboarding-wizard";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Welcome — Meero" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, onboarded")
    .eq("id", user.id)
    .maybeSingle();
  // Defensive — the proxy already keeps an onboarded user from reaching
  // this route, this just covers a stale/cached direct hit.
  if (profile?.onboarded) redirect("/");

  return <OnboardingWizard initialName={profile?.display_name ?? ""} email={user.email ?? ""} />;
}

"use server";

import { redirect } from "next/navigation";
import {
  createCheckoutSession,
  type BillingState,
} from "@/modules/billing/actions/billing-actions";
import { createClient } from "@/lib/supabase/server";

/**
 * The one real write the onboarding wizard makes: marks profiles.onboarded
 * true (so the proxy stops routing this user here), saves their name,
 * referral source, and role if given (00039_onboarding_profile_fields.sql),
 * and — if they picked Pro/Ultra — kicks off the exact same real Stripe
 * Checkout flow the billing settings tab uses (createCheckoutSession),
 * which redirects the browser to a genuine Checkout session. onboarded is
 * set BEFORE that redirect fires so there's no race where a slow/aborted
 * client request could leave the user stuck looping back into onboarding
 * after they return from Stripe.
 */
export async function completeOnboarding(
  _prev: BillingState,
  formData: FormData,
): Promise<BillingState> {
  const name = String(formData.get("name") ?? "").trim();
  const referralSource = String(formData.get("referralSource") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const plan = String(formData.get("plan") ?? "free");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const update: {
    onboarded: true;
    display_name?: string;
    referral_source?: string;
    role?: string;
  } = { onboarded: true };
  if (name) update.display_name = name.slice(0, 80);
  if (referralSource) update.referral_source = referralSource.slice(0, 80);
  if (role) update.role = role.slice(0, 80);

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) return { error: error.message };

  if (plan === "pro" || plan === "ultra") {
    const checkoutFormData = new FormData();
    checkoutFormData.set("plan", plan);
    // Real Checkout session — redirects on success (throws), so nothing
    // after this line runs unless it genuinely failed.
    return createCheckoutSession({}, checkoutFormData);
  }

  redirect("/");
}

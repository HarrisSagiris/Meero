"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type BillingState = { error?: string };

async function orchestratorAuth() {
  const orchestratorUrl =
    process.env.ORCHESTRATOR_INTERNAL_URL ?? process.env.NEXT_PUBLIC_ORCHESTRATOR_URL;
  if (!orchestratorUrl) {
    return {
      error:
        "Orchestrator is not configured (NEXT_PUBLIC_ORCHESTRATOR_URL). Billing requires the real build service.",
    } as const;
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  return { orchestratorUrl, accessToken: session.access_token } as const;
}

/**
 * Creates a real Stripe Checkout session for the chosen plan and redirects
 * the browser to it. Requires STRIPE_* env vars on the orchestrator.
 */
export async function createCheckoutSession(
  _prev: BillingState,
  formData: FormData,
): Promise<BillingState> {
  const plan = String(formData.get("plan") ?? "");
  if (plan !== "pro" && plan !== "ultra") {
    return { error: "Invalid plan." };
  }

  const auth = await orchestratorAuth();
  if ("error" in auth) return auth;

  let res: Response;
  try {
    res = await fetch(`${auth.orchestratorUrl}/billing/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ plan }),
      cache: "no-store",
    });
  } catch {
    return { error: "Could not reach the billing service." };
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((b) => b?.detail)
      .catch(() => null);
    return { error: detail ?? `Checkout failed (${res.status}).` };
  }

  const { url } = (await res.json()) as { url: string };
  redirect(url);
}

/**
 * Creates a real Stripe Checkout session (mode=payment, one-time) for the
 * 50-credit top-up and redirects the browser to it.
 */
// useActionState requires this exact (prevState, formData) signature.
export async function createCreditsCheckout(
  _prev: BillingState,
  _formData: FormData,
): Promise<BillingState> {
  // eslint-disable-line @typescript-eslint/no-unused-vars
  const auth = await orchestratorAuth();
  if ("error" in auth) return auth;

  let res: Response;
  try {
    res = await fetch(`${auth.orchestratorUrl}/billing/checkout-credits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: "no-store",
    });
  } catch {
    return { error: "Could not reach the billing service." };
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((b) => b?.detail)
      .catch(() => null);
    return { error: detail ?? `Checkout failed (${res.status}).` };
  }

  const { url } = (await res.json()) as { url: string };
  redirect(url);
}

/**
 * Opens the real Stripe billing portal so the user can manage or cancel
 * their subscription.
 */
// useActionState requires this exact (prevState, formData) signature.
export async function openBillingPortal(
  _prev: BillingState,
  _formData: FormData,
): Promise<BillingState> {
  // eslint-disable-line @typescript-eslint/no-unused-vars
  const auth = await orchestratorAuth();
  if ("error" in auth) return auth;

  let res: Response;
  try {
    res = await fetch(`${auth.orchestratorUrl}/billing/portal`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      cache: "no-store",
    });
  } catch {
    return { error: "Could not reach the billing service." };
  }

  if (!res.ok) {
    const detail = await res
      .json()
      .then((b) => b?.detail)
      .catch(() => null);
    return { error: detail ?? `Could not open billing portal (${res.status}).` };
  }

  const { url } = (await res.json()) as { url: string };
  redirect(url);
}

import type { Plan } from "@/lib/types";

/** Shared between the billing settings tab and the onboarding wizard, so
 *  pricing/copy can never drift out of sync between the two places a user
 *  picks a plan. Credit line is always derived from PLAN_CREDIT_LIMITS. */

export const PLAN_LABEL: Record<Plan, string> = {
  free: "Free",
  pro: "Pro",
  ultra: "Ultra",
};

export const PLAN_RANK: Record<Plan, number> = {
  free: 0,
  pro: 1,
  ultra: 2,
};

export type PlanCard = {
  plan: Plan;
  price: string;
  period: string;
  tagline: string;
  model: string;
  /** Feature bullets other than the credit line. */
  features: string[];
};

export const PLAN_CARDS: PlanCard[] = [
  {
    plan: "free",
    price: "$0",
    period: "forever",
    tagline: "Try Meero for real, no card needed",
    model: "Free model",
    features: ["Real full-stack app on your Supabase", "Always public on the Marketplace"],
  },
  {
    plan: "pro",
    price: "$9.99",
    period: "/mo",
    tagline: "For shipping real projects",
    model: "Standard model",
    features: ["One-click Vercel production release", "Private projects (opt-in)"],
  },
  {
    plan: "ultra",
    price: "$24.99",
    period: "/mo",
    tagline: "Highest limits, flagship model",
    model: "Flagship model",
    features: ["One-click Vercel production release", "Private projects (opt-in)"],
  },
];

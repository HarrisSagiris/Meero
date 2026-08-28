import type { Profile } from "@/lib/types";

export type SettingsProfile = Pick<
  Profile,
  | "display_name"
  | "email"
  | "plan"
  | "credits_remaining"
  | "bonus_credits"
  | "credits_reset_at"
  | "stripe_customer_id"
  | "stripe_subscription_status"
  | "created_at"
>;

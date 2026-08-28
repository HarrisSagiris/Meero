"use client";

import { useActionState } from "react";
import { createCheckoutSession } from "@/modules/billing/actions/billing-actions";
import { SparkleIcon } from "@/components/icons";
import { formatTokens } from "@/lib/format";
import { PLAN_LABEL } from "@/modules/billing/utils/plans";
import { PLAN_CREDIT_LIMITS, type Plan } from "@/lib/types";

// Below this share of a plan's own weekly allowance, the composer nudges an
// upgrade — a real number per plan (100k/2M/10M all mean different absolute
// thresholds), not one fixed token count for everyone.
const LOW_BALANCE_SHARE = 0.2;

const NEXT_PLAN: Partial<Record<Plan, "pro" | "ultra">> = {
  free: "pro",
  pro: "ultra",
};

/** Small real-balance strip for the main prompt composer — reads the same
 *  profiles.credits_remaining/bonus_credits/plan every other usage surface
 *  does (see UsageBar), and nudges an upgrade once a plan runs low. Ultra
 *  never shows the nudge — there's nowhere left to upgrade to. */
export function TokensBar({
  plan,
  creditsRemaining,
  bonusCredits,
}: {
  plan: Plan;
  creditsRemaining: number;
  bonusCredits: number;
}) {
  const limit = PLAN_CREDIT_LIMITS[plan];
  const total = creditsRemaining + bonusCredits;
  const nextPlan = NEXT_PLAN[plan];
  const low = !!nextPlan && total < limit * LOW_BALANCE_SHARE;
  const pct = limit > 0 ? Math.min(100, Math.max(0, (total / limit) * 100)) : 0;

  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-2">
        <p className="text-[12px] font-medium text-secondary-foreground">
          <span className={low ? "text-primary" : "text-foreground"}>{formatTokens(total)}</span>{" "}
          tokens left this week
        </p>
        <span
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Tokens remaining"
          className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-border"
        >
          <span
            className="block h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </span>
      </div>
      {low && <UpgradeButton plan={nextPlan} />}
    </div>
  );
}

function UpgradeButton({ plan }: { plan: "pro" | "ultra" }) {
  const [state, formAction, pending] = useActionState(createCheckoutSession, {});
  return (
    <form action={formAction} className="shrink-0">
      <input type="hidden" name="plan" value={plan} />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1.5 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-primary/85 disabled:opacity-60"
      >
        <SparkleIcon size={12} />
        {pending ? "Redirecting…" : `Upgrade to ${PLAN_LABEL[plan]}`}
      </button>
      {state.error && <p className="mt-1 text-[10px] text-red-600">{state.error}</p>}
    </form>
  );
}

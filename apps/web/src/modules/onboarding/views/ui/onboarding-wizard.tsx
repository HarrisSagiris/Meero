"use client";

import { useActionState, useState } from "react";
import { completeOnboarding } from "@/modules/onboarding/actions/onboarding-actions";
import { MeeroMark } from "@/components/logo";
import { formatTokens } from "@/lib/format";
import { PLAN_CARDS, type PlanCard } from "@/modules/billing/utils/plans";
import { PLAN_CREDIT_LIMITS, type Plan } from "@/lib/types";

const STEP_COUNT = 4;

const REFERRAL_OPTIONS = [
  "Twitter / X",
  "Google search",
  "Product Hunt",
  "YouTube",
  "A friend or colleague",
  "Other",
];

const ROLE_OPTIONS = [
  "Founder / indie hacker",
  "Software developer",
  "Designer",
  "Product / marketing",
  "Student",
  "Other",
];

/**
 * Real 4-step post-signup wizard (src/app/onboarding/page.tsx, gated by
 * profiles.onboarded via src/lib/supabase/proxy.ts). Steps 1-3 are local
 * state only — nothing's written until the final submit
 * (app/onboarding/actions.ts's completeOnboarding), which saves the real
 * name/referral source/role and marks onboarding done in one write, and —
 * if Pro/Ultra was picked — kicks off the exact same real Stripe Checkout
 * the billing settings tab uses.
 *
 * Same visual language as the rest of the product (landing, auth, the
 * signed-in home): the quiet `meero-landing-hero-bg` glow, serif display
 * headlines, soft pill buttons (shadow-primary/10, no border), and the plan-card
 * treatment already used in settings-page-view.tsx for the same PLAN_CARDS data
 * — not a separate style of its own. Every step (including picking a
 * referral source or role) needs an explicit Continue click; nothing
 * auto-advances on selection, so a click never fires the user past a step
 * before they've actually decided.
 */
export function OnboardingWizard({ initialName, email }: { initialName: string; email: string }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [referralSource, setReferralSource] = useState("");
  const [role, setRole] = useState("");
  const [clickedPlan, setClickedPlan] = useState<Plan | null>(null);
  const [state, formAction, pending] = useActionState(completeOnboarding, {});

  const isPlanStep = step === 3;

  return (
    <main className="meero-landing-hero-bg flex min-h-screen flex-col items-center px-4 py-14">
      <MeeroMark size={34} className="mb-8" />

      <div className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        Step {step + 1} of {STEP_COUNT}
      </div>
      <div className="mb-12 h-1.5 w-40 overflow-hidden rounded-full bg-input">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `${((step + 1) / STEP_COUNT) * 100}%` }}
        />
      </div>

      <div
        className={`w-full transition-[max-width] duration-300 ${isPlanStep ? "max-w-4xl" : "max-w-md"}`}
      >
        {step === 0 && (
          <div key="name" className="animate-rise flex flex-col items-center gap-6 text-center">
            <div>
              <h1 className="font-serif text-[40px] leading-[1.1] tracking-tight text-foreground">
                Welcome to Meero
              </h1>
              <p className="mt-1.5 text-[15px] text-secondary-foreground">
                What should we call you?
              </p>
            </div>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setStep(1);
                }
              }}
              placeholder={email.split("@")[0] || "Your name"}
              maxLength={80}
              className="w-full rounded-2xl border border-input bg-white px-4 py-3 text-center text-[16px] outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
              >
                Skip
              </button>
              <StepButton onClick={() => setStep(1)}>Continue</StepButton>
            </div>
          </div>
        )}

        {step === 1 && (
          <div key="referral" className="animate-rise flex flex-col items-center gap-6">
            <div className="text-center">
              <h1 className="font-serif text-[40px] leading-[1.1] tracking-tight text-foreground">
                How did you hear about Meero?
              </h1>
              <p className="mt-1.5 text-[15px] text-secondary-foreground">
                Helps us know what&apos;s actually working.
              </p>
            </div>
            <OptionGrid
              options={REFERRAL_OPTIONS}
              selected={referralSource}
              onSelect={setReferralSource}
            />
            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(0)}
                className="text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
              >
                Back
              </button>
              <StepButton onClick={() => setStep(2)} disabled={!referralSource}>
                Continue
              </StepButton>
            </div>
          </div>
        )}

        {step === 2 && (
          <div key="role" className="animate-rise flex flex-col items-center gap-6">
            <div className="text-center">
              <h1 className="font-serif text-[40px] leading-[1.1] tracking-tight text-foreground">
                What best describes you?
              </h1>
              <p className="mt-1.5 text-[15px] text-secondary-foreground">
                We&apos;ll tailor a few things to fit.
              </p>
            </div>
            <OptionGrid options={ROLE_OPTIONS} selected={role} onSelect={setRole} />
            <div className="flex w-full items-center justify-between">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="text-[13px] font-medium text-muted-foreground transition hover:text-foreground"
              >
                Back
              </button>
              <StepButton onClick={() => setStep(3)} disabled={!role}>
                Continue
              </StepButton>
            </div>
          </div>
        )}

        {step === 3 && (
          <form
            key="plan"
            action={formAction}
            className="animate-rise flex flex-col items-center gap-8"
          >
            <input type="hidden" name="name" value={name} readOnly />
            <input type="hidden" name="referralSource" value={referralSource} readOnly />
            <input type="hidden" name="role" value={role} readOnly />
            <div className="text-center">
              <h1 className="font-serif text-[40px] leading-[1.1] tracking-tight text-foreground">
                Choose your plan
              </h1>
              <p className="mt-1.5 text-[15px] text-secondary-foreground">
                Start free — upgrade anytime.
              </p>
            </div>

            <div className="grid w-full gap-5 sm:grid-cols-3">
              {PLAN_CARDS.map((card) => (
                <PlanOption
                  key={card.plan}
                  card={card}
                  pending={pending && clickedPlan === card.plan}
                  disabled={pending}
                  onClick={() => setClickedPlan(card.plan)}
                />
              ))}
            </div>

            {state.error && (
              <p role="alert" className="text-[13px] text-red-600">
                {state.error}
              </p>
            )}

            <button
              type="button"
              onClick={() => setStep(2)}
              disabled={pending}
              className="text-[13px] font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              Back
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

function OptionGrid({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="grid w-full grid-cols-2 gap-2.5">
      {options.map((option) => {
        const active = option === selected;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onSelect(option)}
            aria-pressed={active}
            className={`flex items-center gap-2 rounded-2xl border bg-white px-3.5 py-3 text-left text-[13.5px] font-medium transition-all ${
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-secondary-foreground hover:border-foreground/30 hover:text-foreground"
            }`}
          >
            <span
              className={`flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors ${
                active ? "border-primary bg-primary" : "border-input"
              }`}
            >
              {active && (
                <svg
                  width="8"
                  height="8"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="white"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="m4 10.5 4 4 8-9" />
                </svg>
              )}
            </span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

function StepButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full bg-primary px-6 py-2.5 text-[14px] font-medium text-white shadow-primary/10 transition hover:bg-primary/85 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function CheckIcon() {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
      <svg
        width="9"
        height="9"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m4 10.5 4 4 8-9" />
      </svg>
    </span>
  );
}

function PlanOption({
  card,
  pending,
  disabled,
  onClick,
}: {
  card: PlanCard;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isPro = card.plan === "pro";
  return (
    <button
      type="submit"
      name="plan"
      value={card.plan}
      onClick={onClick}
      disabled={disabled}
      className={`relative flex flex-col rounded-2xl bg-white p-6 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
        isPro
          ? "border border-foreground shadow-composer"
          : "border border-border hover:-translate-y-0.5 hover:border-foreground/40 hover:shadow-primary/10"
      }`}
    >
      {isPro && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[10px] font-bold tracking-wide text-white shadow-primary/10">
          MOST POPULAR
        </span>
      )}

      <p className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wide">
        {card.plan === "free" ? "Free" : card.plan === "pro" ? "Pro" : "Ultra"}
      </p>
      <p className="mt-2 font-serif text-[34px] tracking-tight text-foreground">
        {card.price}
        <span className="text-[13px] font-medium text-muted-foreground"> {card.period}</span>
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">{card.tagline}</p>

      <ul className="mt-5 flex-1 space-y-2.5 text-[12.5px] text-secondary-foreground">
        <li className="flex items-center gap-2">
          <CheckIcon />
          {formatTokens(PLAN_CREDIT_LIMITS[card.plan])} tokens / week
        </li>
        <li className="flex items-center gap-2">
          <CheckIcon />
          {card.model}
        </li>
        {card.features.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <CheckIcon />
            {f}
          </li>
        ))}
      </ul>

      <span
        className={`mt-6 block rounded-full px-3 py-2.5 text-center text-[13px] font-semibold transition-all ${
          isPro
            ? "bg-primary text-white shadow-primary/10"
            : "border border-input bg-muted text-foreground"
        }`}
      >
        {pending
          ? "Redirecting…"
          : card.plan === "free"
            ? "Continue free"
            : "Choose " + (card.plan === "pro" ? "Pro" : "Ultra")}
      </span>
    </button>
  );
}

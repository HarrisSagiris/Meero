"use client";

import { useState, useActionState, useTransition } from "react";
import {
  createCreatorReferral,
  deleteCreatorReferral,
  toggleCreatorReferralActive,
  type AdminState,
} from "@/modules/admin/actions/admin-actions";
import { formatStamp } from "@/lib/time";
import type { CreatorReferral } from "@/lib/types";

const initialState: AdminState = {};

export type CreatorReferralWithStats = CreatorReferral & {
  clicks: number;
  signups: number;
};

/** Create + manage creator referral links (00047_creator_referrals.sql) —
 *  meero.im/{slug}, minted per creator, tracked via creator_referral_events. */
export function CreatorReferrals({ referrals }: { referrals: CreatorReferralWithStats[] }) {
  const [state, formAction, pending] = useActionState(createCreatorReferral, initialState);
  const [key, setKey] = useState(0);
  const [prevState, setPrevState] = useState(state);
  if (state !== prevState) {
    setPrevState(state);
    if (state.saved) setKey((k) => k + 1);
  }

  return (
    <div className="mt-8 rounded-2xl border border-border bg-white p-6 shadow-primary/10">
      <h2 className="mb-1 text-[15px] font-semibold text-foreground">Creator referrals</h2>
      <p className="mb-5 text-[13px] text-muted-foreground">
        Mint a meero.im/{"{creatorname}"} link for a creator to share. Clicks and signups from that
        link are tracked automatically.
      </p>

      <form
        key={key}
        action={formAction}
        className="mb-6 flex flex-col gap-2.5 sm:flex-row sm:items-start"
      >
        <input
          name="creator_name"
          placeholder="Creator name"
          required
          className="w-full rounded-xl border border-input bg-white px-3.5 py-2.5 text-[14px] outline-none transition focus:border-foreground sm:flex-1"
        />
        <input
          name="slug"
          placeholder="Custom slug (optional)"
          className="w-full rounded-xl border border-input bg-white px-3.5 py-2.5 text-[14px] outline-none transition focus:border-foreground sm:flex-1"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Creating…" : "Create link"}
        </button>
      </form>
      {state.error && <p className="mb-4 text-[12px] text-red-600">{state.error}</p>}

      <ul className="flex flex-col gap-2">
        {referrals.length === 0 && (
          <li className="text-[13px] text-muted-foreground">No creator links yet.</li>
        )}
        {referrals.map((referral) => (
          <ReferralRow key={referral.id} referral={referral} />
        ))}
      </ul>
    </div>
  );
}

function ReferralRow({ referral }: { referral: CreatorReferralWithStats }) {
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);

  function link(): string {
    if (typeof window === "undefined") return `/${referral.slug}`;
    return `${window.location.origin}/${referral.slug}`;
  }

  async function copyLink() {
    await navigator.clipboard.writeText(link());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded-xl border border-border p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-foreground">
            {referral.creator_name}
          </span>
          <span
            className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
              referral.active
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-border bg-muted text-muted-foreground"
            }`}
          >
            {referral.active ? "Active" : "Inactive"}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="mt-0.5 block truncate text-[12px] text-muted-foreground underline decoration-dotted transition hover:text-foreground"
        >
          {copied ? "Copied!" : `meero.im/${referral.slug}`}
        </button>
        <p className="mt-1 text-[11.5px] text-muted-foreground">
          {referral.clicks} clicks · {referral.signups} signups · {formatStamp(referral.created_at)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(() => {
              void toggleCreatorReferralActive(referral.id, !referral.active);
            })
          }
          className="rounded-lg border border-border px-2.5 py-1 text-[11.5px] font-medium text-secondary-foreground transition hover:border-foreground hover:text-foreground disabled:opacity-50"
        >
          {referral.active ? "Deactivate" : "Activate"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (
              !window.confirm(
                `Delete the link for "${referral.creator_name}"? This also deletes its ${referral.clicks} click and ${referral.signups} signup records — this can't be undone.`,
              )
            )
              return;
            startTransition(() => {
              void deleteCreatorReferral(referral.id);
            });
          }}
          className="rounded-lg border border-border px-2.5 py-1 text-[11.5px] font-medium text-red-600 transition hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

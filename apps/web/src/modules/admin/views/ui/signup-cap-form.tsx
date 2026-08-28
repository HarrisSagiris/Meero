"use client";

import { useActionState } from "react";
import { updateSignupCap, type AdminState } from "@/modules/admin/actions/admin-actions";

const initialState: AdminState = {};

export function SignupCapForm({
  signupCap,
  userCount,
}: {
  signupCap: number | null;
  userCount: number;
}) {
  const [state, formAction, pending] = useActionState(updateSignupCap, initialState);

  return (
    <form action={formAction} className="max-w-sm">
      <label
        htmlFor="signup-cap"
        className="mb-1.5 block text-[12px] font-medium text-secondary-foreground"
      >
        Signup cap
      </label>
      <div className="flex gap-2">
        <input
          id="signup-cap"
          name="signupCap"
          type="number"
          min={0}
          inputMode="numeric"
          defaultValue={signupCap ?? ""}
          placeholder="Unlimited"
          className="w-full rounded-xl border border-input bg-white px-3.5 py-2.5 text-[14px] outline-none transition focus:border-foreground"
        />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 rounded-xl bg-foreground px-4 py-2.5 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="mt-1.5 text-[12px] text-muted-foreground">
        {userCount} signed up so far. Leave blank to remove the cap.
      </p>
      {state.error && <p className="mt-2 text-[12px] text-red-600">{state.error}</p>}
      {state.saved && <p className="mt-2 text-[12px] text-emerald-700">Saved.</p>}
    </form>
  );
}

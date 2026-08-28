"use client";

import { useRouter } from "next/navigation";
import { PENDING_PROMPT_KEY } from "@/modules/landing/views/ui/landing-composer";

/** Hands a starter spec to the composer using the SAME sessionStorage
 *  handoff the landing composer already uses (PENDING_PROMPT_KEY), so the
 *  prompt is genuinely prefilled on arrival rather than the button just
 *  navigating home and dropping the template on the floor. */
export function UseTemplateButton({ prompt }: { prompt: string }) {
  const router = useRouter();

  function onClick() {
    try {
      sessionStorage.setItem(PENDING_PROMPT_KEY, prompt);
    } catch {
      // sessionStorage unavailable — still navigate; the user can type or
      // pick the same idea from the composer's own starter chips.
    }
    router.push("/");
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-6 self-start rounded-full bg-primary px-4 py-2 text-[13.5px] font-medium text-white transition hover:bg-primary/85"
    >
      Build this
    </button>
  );
}

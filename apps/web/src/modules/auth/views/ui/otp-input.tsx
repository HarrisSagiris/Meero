"use client";

import { useRef, useState } from "react";

/**
 * Six real digit boxes for a Supabase email OTP — typing auto-advances,
 * backspace on an empty box steps back, and pasting a full code into ANY
 * box (not just the first) distributes it across the rest. Calls
 * onComplete the instant all six are filled — no separate submit click.
 */
export function OtpInput({
  length = 6,
  onComplete,
  disabled,
}: {
  length?: number;
  onComplete: (code: string) => void;
  disabled?: boolean;
}) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function commit(next: string[]) {
    setDigits(next);
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  }

  function handleChange(i: number, raw: string) {
    const digitsOnly = raw.replace(/\D/g, "");
    if (!digitsOnly) {
      const next = [...digits];
      next[i] = "";
      commit(next);
      return;
    }
    const next = [...digits];
    next[i] = digitsOnly[digitsOnly.length - 1];
    commit(next);
    if (i < length - 1) inputRefs.current[i + 1]?.focus();
  }

  function handlePaste(i: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!pasted) return;
    e.preventDefault();
    const next = [...digits];
    for (let j = 0; j < length - i && j < pasted.length; j++) {
      next[i + j] = pasted[j];
    }
    const lastFilledIndex = Math.min(i + pasted.length, length) - 1;
    inputRefs.current[Math.min(lastFilledIndex + 1, length - 1)]?.focus();
    commit(next);
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      inputRefs.current[i - 1]?.focus();
    }
  }

  return (
    <div className="flex justify-center gap-2" role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el;
          }}
          value={d}
          onChange={(e) => handleChange(i, e.target.value)}
          onPaste={(e) => handlePaste(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          aria-label={`Digit ${i + 1} of ${length}`}
          className="size-12 rounded-xl border-2 border-input bg-white text-center text-[20px] font-bold text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/10 disabled:opacity-50 sm:size-14"
        />
      ))}
    </div>
  );
}

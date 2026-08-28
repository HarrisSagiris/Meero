"use client";

import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowUpIcon, SparkleIcon } from "@/components/icons";
import ShinyText from "@/components/ui/shiny-text";
import { STARTER_IDEAS } from "@/modules/landing/utils/starter-ideas";

/** Where the typed idea is parked across the login hop. Read back by the
 *  dashboard's PromptComposer the moment the user lands signed-in. */
export const PENDING_PROMPT_KEY = "meero:pending-prompt";

/** Critically damped default — settles cleanly, no overshoot. */
const SPRING = { type: "spring" as const, damping: 1, duration: 0.35 };

/**
 * The hero's prompt box — fully usable while logged out (type, pick an idea),
 * but submitting requires an account. On submit we stash the prompt and send
 * the visitor to sign up; after auth the dashboard composer restores it, so
 * the idea they typed here is never lost across the login hop.
 */
export function LandingComposer() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [prompt, setPrompt] = useState("");

  function go() {
    const trimmed = prompt.trim();
    if (trimmed) {
      try {
        sessionStorage.setItem(PENDING_PROMPT_KEY, trimmed);
      } catch {
        // sessionStorage can throw in private modes — the redirect still works,
        // the prompt just won't pre-fill. Not worth blocking on.
      }
    }
    router.push("/signup");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      go();
    }
  }

  function fillRandomIdea() {
    const idea = STARTER_IDEAS[Math.floor(Math.random() * STARTER_IDEAS.length)];
    setPrompt(idea.prompt);
    textareaRef.current?.focus();
  }

  const hasText = prompt.trim().length > 0;

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
      className="w-full rounded-3xl border border-white/40 bg-white p-4 shadow-composer transition-shadow duration-300 focus-within:shadow-[0_4px_10px_rgb(0_0_0_/_0.1),0_32px_80px_rgb(0_0_0_/_0.35)]"
    >
      {hasText && (
        <div className="mb-1.5 flex items-center gap-2 px-1">
          <ShinyText
            text="Looks good — let's build it"
            speed={1.4}
            color="#9a9a9a"
            shineColor="#0a0a0a"
            className="text-[12.5px] font-medium"
          />
        </div>
      )}

      <textarea
        ref={textareaRef}
        name="prompt"
        rows={2}
        maxLength={20000}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="A CRM to track deals, with login and a Kanban pipeline…"
        className="w-full resize-none bg-transparent px-1 pt-0.5 text-[16px] leading-relaxed outline-none placeholder:text-muted-foreground"
      />

      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={go}
          aria-label="Attach files"
          title="Sign up to attach files"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-white text-lg leading-none text-secondary-foreground transition hover:border-foreground hover:text-foreground"
        >
          +
        </button>
        <button
          type="button"
          onClick={fillRandomIdea}
          aria-label="Fill with an app idea"
          title="Get an app idea"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-border bg-white px-3 text-[12.5px] font-medium text-secondary-foreground transition hover:border-foreground hover:text-foreground"
        >
          <SparkleIcon size={14} />
          Idea
        </button>

        <div className="ml-auto flex items-center gap-3">
          {hasText && (
            <span className="hidden text-[11px] font-medium text-muted-foreground sm:block">
              ↵ Enter to continue
            </span>
          )}
          <motion.button
            type="submit"
            aria-label="Continue"
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.94 }}
            transition={SPRING}
            className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/85"
          >
            <ArrowUpIcon size={16} />
          </motion.button>
        </div>
      </div>
    </form>
  );
}

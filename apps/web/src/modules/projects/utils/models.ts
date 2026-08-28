export type ModelId = "claude-sonnet-5" | "gpt-5.6-terra";

export type ModelOption = {
  id: ModelId;
  label: string;
  description: string;
};

/**
 * The two models a Pro/Ultra owner can choose between to build their app —
 * mirrors app/config.py's `anthropic_model` / `openai_model` exactly, and
 * must stay in sync with the check constraint in
 * 00049_model_preference_gpt_5_6.sql. Free-plan projects always build on
 * the separate free-tier model (openai_model_free) regardless of this list
 * — the database gates that server-side, so it's never a real choice here.
 */
export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    description: "Anthropic's flagship model — the Pro & Ultra default.",
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "OpenAI's GPT-5.6, balanced for capability and cost.",
  },
];

export const DEFAULT_MODEL: ModelId = "claude-sonnet-5";

/** What free-plan projects actually build on — shown, never selectable. */
export const FREE_PLAN_MODEL_LABEL = "GPT-5.6 Luna";

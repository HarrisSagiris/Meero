"use client";

import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CheckIcon,
  ChevronDownIcon,
  ClaudeIcon,
  LockIcon,
  OpenAIIcon,
  SparkleIcon,
} from "@/components/icons";
import {
  FREE_PLAN_MODEL_LABEL,
  MODEL_OPTIONS,
  type ModelId,
} from "@/modules/projects/utils/models";
import type { Plan } from "@/lib/types";

/** Real provider marks, not a generic stand-in — Claude Sonnet 5 gets
 *  Claude's own mark (not Anthropic's corporate wordmark), the GPT models
 *  get OpenAI's. */
const MODEL_ICON: Record<ModelId, typeof ClaudeIcon> = {
  "claude-sonnet-5": ClaudeIcon,
  "gpt-5.6-terra": OpenAIIcon,
};

/** Where a locked model row / the upgrade nudge sends a Free-plan owner. */
const UPGRADE_HREF = "/settings?section=billing";

/**
 * Which model actually generates this project's code. Pro/Ultra owners
 * switch freely between the models in MODEL_OPTIONS (persisted to
 * projects.preferred_model, read by codegen_worker.py). Free-plan owners
 * get the SAME dropdown, but every paid model is shown locked — picking one
 * routes to billing instead of switching the model — and the only live row
 * is the free-tier model their builds actually run on (openai_model_free).
 */
export function ModelSelector({
  plan,
  value,
  onChange,
  disabled,
}: {
  plan: Plan;
  value: ModelId;
  onChange: (model: ModelId) => void;
  disabled?: boolean;
}) {
  const canChoose = plan === "pro" || plan === "ultra";

  const selected = MODEL_OPTIONS.find((option) => option.id === value) ?? MODEL_OPTIONS[0];
  const TriggerIcon = canChoose ? MODEL_ICON[selected.id] : OpenAIIcon;
  const triggerLabel = canChoose ? selected.label : FREE_PLAN_MODEL_LABEL;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            title={
              canChoose
                ? "Choose the model that builds this app"
                : `Free plan builds on ${FREE_PLAN_MODEL_LABEL}`
            }
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-secondary-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-60"
          />
        }
      >
        <TriggerIcon size={14} className="text-foreground" />
        <span className="max-w-[110px] truncate">{triggerLabel}</span>
        <ChevronDownIcon
          size={11}
          className="text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
        />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72 rounded-xl p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel>MODEL</DropdownMenuLabel>

          {/* Free plan: the model builds actually run on, shown as the
              active row — there's only one, so it's not a real choice. */}
          {!canChoose && (
            <DropdownMenuItem className="items-start gap-2.5 rounded-lg bg-muted px-2.5 py-2.5">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-white">
                <OpenAIIcon size={14} className="text-foreground" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-foreground">
                    {FREE_PLAN_MODEL_LABEL}
                  </span>
                  <CheckIcon size={13} className="text-emerald-600" />
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                  OpenAI&apos;s fast, low-cost model — included on the Free plan.
                </span>
              </span>
            </DropdownMenuItem>
          )}

          {MODEL_OPTIONS.map((option) => {
            const OptionIcon = MODEL_ICON[option.id];
            const isSelected = canChoose && option.id === value;

            const body = (
              <>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-white">
                  <OptionIcon
                    size={14}
                    className={canChoose ? "text-foreground" : "text-muted-foreground"}
                  />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`text-[13px] font-semibold ${
                        canChoose ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {option.label}
                    </span>

                    {!canChoose && <LockIcon size={11} className="text-muted-foreground" />}
                    {isSelected && <CheckIcon size={13} className="text-emerald-600" />}
                  </span>

                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                    {canChoose ? option.description : "Upgrade to Pro to build with this model."}
                  </span>
                </span>
              </>
            );

            return canChoose ? (
              <DropdownMenuItem
                key={option.id}
                onClick={() => onChange(option.id)}
                className={`items-start gap-2.5 rounded-lg px-2.5 py-2.5 ${
                  isSelected ? "bg-muted" : ""
                }`}
              >
                {body}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                key={option.id}
                render={<Link href={UPGRADE_HREF} />}
                className="items-start gap-2.5 rounded-lg px-2.5 py-2.5"
              >
                {body}
              </DropdownMenuItem>
            );
          })}

          {!canChoose && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                render={<Link href={UPGRADE_HREF} />}
                className="gap-2 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-foreground"
              >
                <SparkleIcon size={13} className="text-foreground" />
                Upgrade to Pro to choose your model
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

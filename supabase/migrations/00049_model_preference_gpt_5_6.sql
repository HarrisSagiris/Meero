-- Meero — bump the paid-plan "GPT" model option from GPT-5.1 to GPT-5.6
-- Terra (owner decision, 2026-08-27). OpenAI's GPT-5.6 family splits into
-- three durable tiers: Sol (flagship, `gpt-5.6`), Terra (balanced,
-- `gpt-5.6-terra`), and Luna (budget, `gpt-5.6-luna`). Terra is the model a
-- Pro/Ultra owner now gets when they pick "GPT" in the composer's model
-- selector; free-plan builds move to Luna (see app/config.py's
-- `openai_model` / `openai_model_free` and apps/orchestrator/.env).
--
-- Keep the allowed set below in sync with app/config.py's `anthropic_model`
-- / `openai_model` and apps/web/src/modules/projects/utils/models.ts —
-- exactly the "hardcoded literals, not read from config" contract 00048
-- established.

-- Repoint existing explicit overrides at the replacement model. model_for_plan()
-- only honors projects.preferred_model while it still matches
-- settings.openai_model, so a row left on the stale 'gpt-5.1' would silently
-- fall back to the Claude default instead of building on GPT.
update public.projects
  set preferred_model = 'gpt-5.6-terra'
  where preferred_model = 'gpt-5.1';

-- Swap the check constraint (00048 added it inline, so Postgres auto-named
-- it `projects_preferred_model_check`).
alter table public.projects
  drop constraint if exists projects_preferred_model_check;

alter table public.projects
  add constraint projects_preferred_model_check
    check (preferred_model is null or preferred_model in ('claude-sonnet-5', 'gpt-5.6-terra'));

-- Meero — per-project model selector (owner decision, 2026-08-18).
--
-- The prompt composer on the home page lets Pro/Ultra owners choose which
-- model actually generates their app's code: Claude Sonnet 5 (the default
-- for paid plans) or GPT-5.1 (previously only an unused llm() fallback —
-- see app/config.py's `openai_model`). Free-plan users never get a real
-- choice — codegen_worker.py always falls back to the free-tier model
-- (openai_model_free) regardless of what's stored here, but the DB layer
-- also guarantees a free project can never PERSIST an override, the same
-- "product rule enforced for every role, not just a privileged-column
-- bypass concern" pattern 00015_marketplace.sql uses for is_public.
--
-- The two allowed values are hardcoded literals, not read from config —
-- keep this check constraint in sync with app/config.py's `anthropic_model`
-- / `openai_model` if either ever changes.
alter table public.projects
  add column if not exists preferred_model text
    check (preferred_model is null or preferred_model in ('claude-sonnet-5', 'gpt-5.1'));

-- ---------------------------------------------------------------------------
-- Enforce "free plan => no stored model override" at the database layer,
-- fired on every insert/update regardless of which client role is writing —
-- same shape as enforce_free_plan_public_projects() above it.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_model_preference_gating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_plan text;
begin
  if new.preferred_model is not null then
    select plan into owner_plan from public.profiles where id = new.owner_id;
    if owner_plan is distinct from 'pro' and owner_plan is distinct from 'ultra' then
      new.preferred_model := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger projects_enforce_model_gating
  before insert or update on public.projects
  for each row execute function public.enforce_model_preference_gating();

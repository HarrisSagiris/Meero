-- Meero — credit bump (owner decision, 2026-07-28): free 20k -> 100k/week
-- (5x), pro and ultra scaled by the same 5x multiplier so the relative gap
-- between plans is unchanged: pro 400k -> 2,000,000/week, ultra 2,000,000 ->
-- 10,000,000/week. Single source of truth, same as 00010_token_billing.sql
-- — nothing else needs to change, every credits_available/charge_credits/
-- reset path already reads through this one function.
--
-- Real cost note: this is a genuine 5x increase in the real OpenAI token
-- budget every plan is entitled to each week — a direct increase in Meero's
-- own per-user API cost exposure, not just a display number. Revisit
-- pricing/margins if usage climbs toward these new ceilings.
create or replace function public.plan_daily_tokens(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'ultra' then 10000000
    when 'pro' then 2000000
    else 100000
  end;
$$;

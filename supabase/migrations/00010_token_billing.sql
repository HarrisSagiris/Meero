-- Zylo — token-based billing.
--
-- Credits are no longer a per-interaction count (2/25/100) — they are a daily
-- TOKEN budget. Chat turns deduct the real OpenAI tokens they consume; builds
-- deduct a large flat amount (real GitHub-Actions compile + Appetize hosting
-- cost, not just LLM tokens). The `credits_remaining` / `bonus_credits` columns
-- keep their names — only the unit and scale change.
--
-- Billing model: gate on a minimum balance BEFORE running (credits_available),
-- then reconcile the true cost AFTER (charge_credits). See app/main.py.

-- Single source of truth for the daily token budget per plan.
create or replace function public.plan_daily_tokens(p_plan text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_plan
    when 'ultra' then 2000000
    when 'pro' then 400000
    else 20000
  end;
$$;

-- Pre-gate: rolls the daily allowance over if it has expired, persists that
-- rollover, and reports whether the user has ANY balance left (daily + bonus).
-- Deducts nothing — the real cost isn't known until the model has responded.
create or replace function public.credits_available(p_user_id uuid)
returns table(allowed boolean, remaining integer, plan text, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_credits integer;
  v_bonus integer;
  v_reset timestamptz;
begin
  select p.plan, p.credits_remaining, p.bonus_credits, p.credits_reset_at
    into v_plan, v_credits, v_bonus, v_reset
    from public.profiles p
    where p.id = p_user_id
    for update;

  if not found then
    return query select false, 0, 'free'::text, now();
    return;
  end if;

  if now() >= v_reset then
    v_credits := public.plan_daily_tokens(v_plan);
    v_reset := now() + interval '24 hours';
    update public.profiles
      set credits_remaining = v_credits, credits_reset_at = v_reset
      where id = p_user_id;
  end if;

  return query select (v_credits + v_bonus) > 0, v_credits + v_bonus, v_plan, v_reset;
end;
$$;

revoke all on function public.credits_available(uuid) from public;
grant execute on function public.credits_available(uuid) to service_role;

-- Post-hoc deduct: rolls over first, then UNCONDITIONALLY subtracts p_amount —
-- daily allowance first, then bonus_credits — each floored at 0 (never
-- negative, so real paid bonus credits are never wiped). Always succeeds; the
-- caller has already used the tokens/compute by the time this runs.
create or replace function public.charge_credits(p_user_id uuid, p_amount integer)
returns table(remaining integer, plan text, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_credits integer;
  v_bonus integer;
  v_reset timestamptz;
  v_spend_daily integer;
  v_spend_bonus integer;
begin
  select p.plan, p.credits_remaining, p.bonus_credits, p.credits_reset_at
    into v_plan, v_credits, v_bonus, v_reset
    from public.profiles p
    where p.id = p_user_id
    for update;

  if not found then
    return query select 0, 'free'::text, now();
    return;
  end if;

  if now() >= v_reset then
    v_credits := public.plan_daily_tokens(v_plan);
    v_reset := now() + interval '24 hours';
  end if;

  v_spend_daily := least(greatest(p_amount, 0), v_credits);
  v_credits := v_credits - v_spend_daily;
  v_spend_bonus := least(greatest(p_amount, 0) - v_spend_daily, v_bonus);
  v_bonus := v_bonus - v_spend_bonus;

  update public.profiles
    set credits_remaining = v_credits, credits_reset_at = v_reset, bonus_credits = v_bonus
    where id = p_user_id;

  return query select v_credits + v_bonus, v_plan, v_reset;
end;
$$;

revoke all on function public.charge_credits(uuid, integer) from public;
grant execute on function public.charge_credits(uuid, integer) to service_role;

-- Keep the legacy consume_credits() consistent (token budgets, not 2/25/100)
-- so it isn't a landmine, even though callers now use the gate/charge pair.
create or replace function public.consume_credits(p_user_id uuid, p_amount integer default 1)
returns table(allowed boolean, remaining integer, plan text, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_credits integer;
  v_bonus integer;
  v_reset timestamptz;
  v_limit integer;
  v_shortfall integer;
begin
  select p.plan, p.credits_remaining, p.bonus_credits, p.credits_reset_at
    into v_plan, v_credits, v_bonus, v_reset
    from public.profiles p
    where p.id = p_user_id
    for update;

  if not found then
    return query select false, 0, 'free'::text, now();
    return;
  end if;

  v_limit := public.plan_daily_tokens(v_plan);

  if now() >= v_reset then
    v_credits := v_limit;
    v_reset := now() + interval '24 hours';
  end if;

  if v_credits >= p_amount then
    v_credits := v_credits - p_amount;
    update public.profiles
      set credits_remaining = v_credits, credits_reset_at = v_reset
      where id = p_user_id;
    return query select true, v_credits + v_bonus, v_plan, v_reset;
  elsif v_credits + v_bonus >= p_amount then
    v_shortfall := p_amount - v_credits;
    v_bonus := v_bonus - v_shortfall;
    v_credits := 0;
    update public.profiles
      set credits_remaining = v_credits, credits_reset_at = v_reset, bonus_credits = v_bonus
      where id = p_user_id;
    return query select true, v_credits + v_bonus, v_plan, v_reset;
  else
    update public.profiles
      set credits_remaining = v_credits, credits_reset_at = v_reset
      where id = p_user_id;
    return query select false, v_credits + v_bonus, v_plan, v_reset;
  end if;
end;
$$;

revoke all on function public.consume_credits(uuid, integer) from public;
grant execute on function public.consume_credits(uuid, integer) to service_role;

-- New signups get a full daily token budget instead of the old default of 5.
alter table public.profiles
  alter column credits_remaining set default 20000;

-- One-time backfill: lift everyone off the old tiny interaction counts to the
-- new token budget so nobody is stranded at a 2-credit balance.
update public.profiles
  set credits_remaining = public.plan_daily_tokens(plan),
      credits_reset_at = now() + interval '24 hours';

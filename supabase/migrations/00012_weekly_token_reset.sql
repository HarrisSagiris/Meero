-- Zylo — weekly token refresh.
--
-- Token budgets now refresh WEEKLY, every Sunday at 00:00 UTC, instead of every
-- 24 hours. The per-plan amount (plan_daily_tokens) is unchanged — only the
-- reset cadence moves from daily to weekly. All three credit functions roll the
-- allowance over the same way; they just compute the next reset with the shared
-- helper below instead of `now() + interval '24 hours'`.

-- Next Sunday at 00:00 UTC, strictly in the future. Timezone-independent: the
-- day-of-week and midnight are both computed in UTC regardless of the session's
-- TimeZone setting, so the schedule is stable everywhere.
create or replace function public.next_weekly_reset()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case when d <= now() then d + interval '7 days' else d end
  from (
    select (
      date_trunc('day', now() at time zone 'UTC')
      + ((7 - extract(dow from now() at time zone 'UTC')::int) % 7) * interval '1 day'
    ) at time zone 'UTC' as d
  ) s;
$$;

-- Pre-gate: rolls the weekly allowance over if it has expired, persists that
-- rollover, and reports whether the user has ANY balance left (weekly + bonus).
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
    v_reset := public.next_weekly_reset();
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
-- weekly allowance first, then bonus_credits — each floored at 0.
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
    v_reset := public.next_weekly_reset();
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

-- Keep the legacy consume_credits() on the same weekly cadence so it isn't a
-- landmine, even though callers now use the gate/charge pair.
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
    v_reset := public.next_weekly_reset();
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

-- New signups get their first refresh on the next Sunday instead of +24h.
alter table public.profiles
  alter column credits_reset_at set default public.next_weekly_reset();

-- Move everyone onto the weekly schedule now (reschedules the next reset only;
-- current balances are untouched).
update public.profiles
  set credits_reset_at = public.next_weekly_reset();

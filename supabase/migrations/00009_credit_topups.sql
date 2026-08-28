-- Zylo — one-time credit top-ups (real $5 Stripe purchase -> 50 real credits).
--
-- Bonus credits live in a SEPARATE column from the daily plan allowance so
-- consume_credits()'s daily rollover never silently wipes credits someone
-- actually paid for. They're spent only after the daily allowance runs out.

alter table public.profiles
  add column if not exists bonus_credits integer not null default 0;

-- Extend the existing billing-column trigger (00004) to also protect
-- bonus_credits — only the orchestrator's service-role client may change it.

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    if new.plan is distinct from old.plan
       or new.credits_remaining is distinct from old.credits_remaining
       or new.credits_reset_at is distinct from old.credits_reset_at
       or new.bonus_credits is distinct from old.bonus_credits
       or new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_subscription_id is distinct from old.stripe_subscription_id
       or new.stripe_subscription_status is distinct from old.stripe_subscription_status
    then
      raise exception 'Billing and credit fields can only be changed by the orchestrator.';
    end if;
  end if;
  return new;
end;
$$;

-- Trigger itself (name + attachment) is unchanged from 00004; replacing the
-- function body above is enough since it's the same function name.

-- Adds real, non-expiring bonus credits after a real Stripe payment. Called
-- only by the orchestrator's Stripe webhook handler.

create or replace function public.add_bonus_credits(p_user_id uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
    set bonus_credits = bonus_credits + p_amount
    where id = p_user_id;
end;
$$;

revoke all on function public.add_bonus_credits(uuid, integer) from public;
grant execute on function public.add_bonus_credits(uuid, integer) to service_role;

-- consume_credits(): spend the daily allowance first; once that's zero,
-- dip into bonus_credits for the remainder. Denial only happens when BOTH
-- pools combined can't cover the amount. `remaining` in the result is the
-- combined total (daily + bonus) so callers report an accurate balance.

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

  v_limit := case v_plan when 'ultra' then 100 when 'pro' then 25 else 2 end;

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
    -- Still persist a rolled-over reset even on denial, so the clock
    -- doesn't get stuck re-evaluating "now() >= v_reset" every call.
    update public.profiles
      set credits_remaining = v_credits, credits_reset_at = v_reset
      where id = p_user_id;
    return query select false, v_credits + v_bonus, v_plan, v_reset;
  end if;
end;
$$;

revoke all on function public.consume_credits(uuid, integer) from public;
grant execute on function public.consume_credits(uuid, integer) to service_role;

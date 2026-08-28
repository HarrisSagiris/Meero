-- Zylo — plans, daily credits, Stripe billing.
--
-- Free: 5 credits/day (cheaper model). Pro ($9.99/mo): 100/day. Ultra
-- ($24.99/mo): 400/day. Credits reset 24 hours after they were last reset —
-- enforced lazily inside consume_credits(), so no cron job is required.

alter table public.profiles
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'pro', 'ultra')),
  add column if not exists credits_remaining integer not null default 5,
  add column if not exists credits_reset_at timestamptz not null default (now() + interval '24 hours'),
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_subscription_status text;

create unique index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- The existing "profiles: owner can update" policy lets a user update any
-- column on their own row (display_name, avatar_url, ...). Block plan and
-- credit/billing fields from that path with a trigger — only the
-- orchestrator's service-role client (which this trigger recognizes via
-- auth.role() and lets through) may change them.

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

drop trigger if exists profiles_protect_privileged on public.profiles;
create trigger profiles_protect_privileged
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- Atomic "spend N credits": lazily rolls the daily allowance over if the
-- reset time has passed, then decrements only if there's enough left.
-- `for update` row-locks the profile so concurrent requests (e.g. two chat
-- messages in flight) can't both read a stale balance. Called exclusively
-- by the orchestrator via the service-role client.

create or replace function public.consume_credits(p_user_id uuid, p_amount integer default 1)
returns table(allowed boolean, remaining integer, plan text, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_credits integer;
  v_reset timestamptz;
  v_limit integer;
begin
  select p.plan, p.credits_remaining, p.credits_reset_at
    into v_plan, v_credits, v_reset
    from public.profiles p
    where p.id = p_user_id
    for update;

  if not found then
    return query select false, 0, 'free'::text, now();
    return;
  end if;

  v_limit := case v_plan when 'ultra' then 400 when 'pro' then 100 else 5 end;

  if now() >= v_reset then
    v_credits := v_limit;
    v_reset := now() + interval '24 hours';
  end if;

  if v_credits >= p_amount then
    v_credits := v_credits - p_amount;
    update public.profiles
      set credits_remaining = v_credits, credits_reset_at = v_reset
      where id = p_user_id;
    return query select true, v_credits, v_plan, v_reset;
  else
    -- Still persist a rolled-over reset even on denial, so the clock
    -- doesn't get stuck re-evaluating "now() >= v_reset" every call.
    update public.profiles
      set credits_remaining = v_credits, credits_reset_at = v_reset
      where id = p_user_id;
    return query select false, v_credits, v_plan, v_reset;
  end if;
end;
$$;

revoke all on function public.consume_credits(uuid, integer) from public;
grant execute on function public.consume_credits(uuid, integer) to service_role;

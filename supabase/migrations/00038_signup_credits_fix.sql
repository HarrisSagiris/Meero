-- Meero — fixes a real gap in 00023_credit_bump.sql's free 20k -> 100k
-- bump: it updated plan_daily_tokens() (read by the WEEKLY reset), but
-- never touched the profiles.credits_remaining / credits_reset_at column
-- DEFAULTs that handle_new_user() actually relies on at signup — so every
-- new signup since 00023 landed was still seeded with the stale 20,000 /
-- 24-hour values, only self-correcting to 100,000 at their first weekly
-- reset (up to 7 days later).
--
-- Redefines handle_new_user() to read plan_daily_tokens('free') /
-- next_weekly_reset() directly at insert time instead of a hardcoded
-- column default, so a future change to either function can never drift
-- out of sync with real signups again. Column defaults are also bumped
-- for defense-in-depth (in case anything else ever inserts a profiles row
-- outside this trigger), but the trigger is the real fix.
--
-- Deliberately NOT backfilling existing users' current credits_remaining
-- — anyone already past their first weekly reset already has the correct
-- 100k-based balance (minus real usage since); blindly topping everyone
-- up would incorrectly refund usage for accounts already on the bump.

alter table public.profiles
  alter column credits_remaining set default 100000,
  alter column credits_reset_at set default (now() + interval '7 days');

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_count integer;
  v_email_verified boolean;
begin
  select signup_cap into v_cap from public.app_settings where id = true for update;

  if v_cap is not null then
    select count(*) into v_count from public.profiles;
    if v_count >= v_cap then
      raise exception 'Signups are full for now — check back soon.' using errcode = 'P0001';
    end if;
  end if;

  v_email_verified := coalesce(new.raw_app_meta_data ->> 'provider', 'email') <> 'email';

  insert into public.profiles (
    id, email, display_name, avatar_url, email_verified,
    credits_remaining, credits_reset_at
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    v_email_verified,
    public.plan_daily_tokens('free'),
    public.next_weekly_reset()
  );
  return new;
end;
$$;

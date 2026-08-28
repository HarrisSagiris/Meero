-- Meero — real, self-hosted email OTP verification, replacing reliance on
-- Supabase's own "Confirm signup" email template (its dashboard editor
-- proved unreliable to customize). Requires "Confirm email" turned OFF in
-- Supabase Auth settings (Authentication → Providers → Email) — a single
-- toggle, not a template edit — so signUp() returns a real session
-- immediately; THIS schema + the orchestrator (app/email_otp.py) then
-- gates real app access behind a genuine 6-digit code sent via the
-- existing real Resend integration (app/email_send.py), the same one
-- generated apps' transactional email already uses.
--
-- Google/OAuth signups skip this entirely — the provider already verified
-- the email — via the provider check in handle_new_user() below.

alter table public.profiles add column email_verified boolean not null default false;
-- Backfill: existing users were already real, working accounts under the
-- old flow — never retroactively gate them behind a new requirement.
update public.profiles set email_verified = true;

-- Real hashed, expiring, attempt-limited one-time codes. Service-role-only
-- (holds a real secret, if only briefly) — same pattern as
-- github_connections: zero RLS policies for authenticated/anon.
create table public.email_otps (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now()
);

alter table public.email_otps enable row level security;

-- Redefines handle_new_user() (00001/00019) to also set email_verified —
-- true for any non-"email" provider (Google today; any future OAuth
-- provider tomorrow) since the identity's already verified there, false
-- for a real password signup so the new /verify-email gate (proxy.ts)
-- applies. Every other line is unchanged from 00019's version.
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

  insert into public.profiles (id, email, display_name, avatar_url, email_verified)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    v_email_verified
  );
  return new;
end;
$$;

-- Meero — post-signup onboarding wizard (name, first idea, plan).
--
-- `onboarded` is a plain, non-privileged profiles column — NOT touched by
-- protect_profile_privileged_columns() (00004/00009), so it's covered by
-- the existing "profiles: owner can update" RLS policy (00001_init.sql)
-- like display_name already is; no new policy or trigger needed.
--
-- Default false so every NEW signup (handle_new_user()'s plain insert,
-- 00001/00019) starts un-onboarded and the proxy (src/lib/supabase/proxy.ts)
-- routes them to /onboarding — but backfill every EXISTING row to true
-- right away so current users are never retroactively sent through it.

alter table public.profiles add column onboarded boolean not null default false;
update public.profiles set onboarded = true;

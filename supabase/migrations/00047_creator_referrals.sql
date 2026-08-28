-- Meero — creator referral links: the admin mints a named link
-- (meero.im/{slug}) for a creator to share with their audience. Same
-- single-operator content model as news_posts (00031) / app_settings
-- (00019) — hardcoded to the one admin account, not a roles system.
--
-- creator_referrals is the link itself; creator_referral_events is an
-- append-only log of clicks (logged anonymously by the public route
-- handler at src/app/[creator]/route.ts) and signups (logged by the new
-- user themselves right after supabase.auth.signUp() succeeds, under
-- their own fresh session — same pattern AGENTS.md documents for
-- per-user rows instead of a signup trigger).

create table public.creator_referrals (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  creator_name text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.creator_referrals enable row level security;

-- The public route handler resolves a slug with just the anon key —
-- inactive links stay invisible (and behave like an unknown slug).
create policy "creator_referrals: anyone can select active"
  on public.creator_referrals for select
  to anon, authenticated
  using (active);

create policy "creator_referrals: admin can select all"
  on public.creator_referrals for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create policy "creator_referrals: admin can insert"
  on public.creator_referrals for insert
  to authenticated
  with check ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create policy "creator_referrals: admin can update"
  on public.creator_referrals for update
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

-- A real delete, same as news_posts — cascades to that link's
-- creator_referral_events (on delete cascade below), so only delete a link
-- whose click/signup history you're fine losing; deactivate (`active =
-- false`) is the non-destructive alternative for just cutting off new clicks.
create policy "creator_referrals: admin can delete"
  on public.creator_referrals for delete
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create index creator_referrals_slug_idx on public.creator_referrals (slug);

create table public.creator_referral_events (
  id          uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.creator_referrals (id) on delete cascade,
  event_type  text not null check (event_type in ('click', 'signup')),
  user_id     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table public.creator_referral_events enable row level security;

-- Public click logging: anyone hitting a creator link records a click,
-- no session required yet at that point.
create policy "creator_referral_events: anyone can insert clicks"
  on public.creator_referral_events for insert
  to anon, authenticated
  with check (event_type = 'click' and user_id is null);

-- Signup attribution: a freshly-created account records its own
-- conversion under its own session — auth.uid() already equals the new
-- user's id right after signUp(), so no elevated privilege is needed.
create policy "creator_referral_events: user can insert own signup event"
  on public.creator_referral_events for insert
  to authenticated
  with check (event_type = 'signup' and user_id = (select auth.uid()));

create policy "creator_referral_events: admin can select"
  on public.creator_referral_events for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

-- Append-only by design — no update/delete policies.

create index creator_referral_events_referral_type_idx
  on public.creator_referral_events (referral_id, event_type);

-- Plain nullable attribution column on profiles, same pattern as
-- referral_source (00039_onboarding_profile_fields.sql) — NOT added to
-- protect_profile_privileged_columns() (00004/00009), so it's covered by
-- the existing "profiles: owner can update" policy (00001_init.sql). No
-- financial stake rides on this yet (see AGENTS.md — real creator payouts
-- are a future, not-yet-built direction), so a user "faking" their own
-- attribution isn't a security concern worth trigger-protecting against.
alter table public.profiles
  add column referred_by uuid references public.creator_referrals (id) on delete set null;

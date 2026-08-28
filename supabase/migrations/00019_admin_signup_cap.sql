-- Meero — admin-editable signup cap ("50 users for the first week" soft
-- launch gate) + the single-owner admin dashboard that edits it.
--
-- app_settings is a singleton row (id is always `true`) so the admin
-- dashboard has exactly one thing to read/update. signup_cap is nullable —
-- null means unlimited. Nothing in this table is sensitive, so it's
-- world-readable (the signup form pre-checks it for a clean error message);
-- only the one admin account can write it.

create table public.app_settings (
  id          boolean primary key default true check (id),
  signup_cap  integer check (signup_cap >= 0),
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (id, signup_cap) values (true, 50);

alter table public.app_settings enable row level security;

create policy "app_settings: anyone can select"
  on public.app_settings for select
  to anon, authenticated
  using (true);

-- Hardcoded to one owner account by design — this is a single-operator
-- admin dashboard, not a roles system.
create policy "app_settings: admin can update"
  on public.app_settings for update
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Enforce the cap where signups actually happen: the trigger that fires for
-- EVERY new auth.users row, regardless of how it was created (password,
-- magic link, OAuth, the Admin API). Raising here rolls back the whole
-- transaction — including the auth.users insert itself — so a signup past
-- the cap genuinely fails, not just its profile row. `for update` locks the
-- singleton settings row so concurrent signups can't both read the same
-- under-cap count and both squeeze through.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer;
  v_count integer;
begin
  select signup_cap into v_cap from public.app_settings where id = true for update;

  if v_cap is not null then
    select count(*) into v_count from public.profiles;
    if v_count >= v_cap then
      raise exception 'Signups are full for now — check back soon.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

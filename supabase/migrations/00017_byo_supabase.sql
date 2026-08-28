-- Meero — full-stack generated apps via the user's OWN linked Supabase
-- (owner decision, 2026-07-24).
--
-- Each Meero user connects their Supabase account (OAuth, orchestrator-
-- brokered — same pattern as the GitHub connect flow) and binds every Meero
-- project to one of their Supabase projects. Generated apps talk to that
-- Supabase directly from the browser (supabase-js + anon key + RLS);
-- Postgres, PostgREST, and Supabase Auth ARE the generated app's backend —
-- Meero never runs arbitrary AI-generated server code.

-- ---------------------------------------------------------------------------
-- supabase_connections — holds the real OAuth access/refresh tokens used to
-- drive the Supabase Management API on the user's behalf (apply schema.sql,
-- list projects, read anon keys). Bearer credentials, so — exactly like
-- github_connections (00008) — RLS is enabled with ZERO policies for
-- authenticated/anon: completely inaccessible from the browser; only the
-- service-role orchestrator ever reads or writes it.
-- ---------------------------------------------------------------------------

create table public.supabase_connections (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  access_token  text not null,
  refresh_token text not null,
  expires_at    timestamptz not null,
  connected_at  timestamptz not null default now()
);

alter table public.supabase_connections enable row level security;
-- No policies: default-deny for authenticated/anon.

-- ---------------------------------------------------------------------------
-- Non-secret projections the UI can safely read to render connection state.
-- Trigger-protected (orchestrator-only writes), same pattern as the GitHub
-- fields in 00008.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists supabase_connected boolean not null default false;

-- Which of the user's Supabase projects this Meero project builds against.
-- The anon key is public by design (it ships in every generated bundle), so
-- it's safe in a user-readable column — but only the orchestrator may WRITE
-- any of these, after a real Management API call confirmed them.
alter table public.projects add column if not exists supabase_project_ref text;
alter table public.projects add column if not exists supabase_url text;
alter table public.projects add column if not exists supabase_anon_key text;

create or replace function public.protect_supabase_connected()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and new.supabase_connected is distinct from old.supabase_connected then
    raise exception 'supabase_connected can only be changed by the orchestrator.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_supabase on public.profiles;
create trigger profiles_protect_supabase
  before update on public.profiles
  for each row execute function public.protect_supabase_connected();

create or replace function public.protect_supabase_link_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    if new.supabase_project_ref is distinct from old.supabase_project_ref
       or new.supabase_url is distinct from old.supabase_url
       or new.supabase_anon_key is distinct from old.supabase_anon_key
    then
      raise exception 'Supabase link fields can only be changed by the orchestrator.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_protect_supabase on public.projects;
create trigger projects_protect_supabase
  before update on public.projects
  for each row execute function public.protect_supabase_link_fields();

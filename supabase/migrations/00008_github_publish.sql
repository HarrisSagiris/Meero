-- Zylo — publish a project's real generated source to the user's own GitHub.
--
-- Flow: user connects their GitHub account (OAuth, orchestrator-brokered) →
-- Zylo creates a real private repo on first publish → every subsequent
-- successful build pushes the newly generated files as a real commit via
-- GitHub's Git Data API. Nothing here is simulated: every repo and commit
-- is real, made through GitHub's actual REST API.

-- ---------------------------------------------------------------------------
-- github_connections — holds the real OAuth access token used to push
-- commits on the user's behalf. This is a bearer credential, not just an
-- identifier, so unlike other tables it gets ZERO policies for
-- authenticated/anon: RLS is enabled (required before any row is written,
-- per project convention) but with no grants, the table is completely
-- inaccessible from the browser under the anon/authenticated roles. Only
-- the orchestrator's service-role client (which bypasses RLS) ever reads
-- or writes it.
-- ---------------------------------------------------------------------------

create table public.github_connections (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  github_username text not null,
  access_token    text not null,
  connected_at    timestamptz not null default now()
);

alter table public.github_connections enable row level security;
-- No policies: default-deny for authenticated/anon.

-- ---------------------------------------------------------------------------
-- Non-secret projections the UI can safely read to render connection state.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists github_username text;

alter table public.projects add column if not exists github_repo_full_name text;
alter table public.projects add column if not exists github_repo_url text;

-- Same pattern as protect_profile_privileged_columns() in 00004: the
-- existing "owner can update" policies on profiles/projects would otherwise
-- let a user's own client overwrite these — block that with triggers so
-- only the orchestrator (after a real GitHub API call succeeds) sets them.

create or replace function public.protect_github_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and new.github_username is distinct from old.github_username then
    raise exception 'github_username can only be changed by the orchestrator.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_protect_github on public.profiles;
create trigger profiles_protect_github
  before update on public.profiles
  for each row execute function public.protect_github_username();

create or replace function public.protect_github_repo_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    if new.github_repo_full_name is distinct from old.github_repo_full_name
       or new.github_repo_url is distinct from old.github_repo_url
    then
      raise exception 'GitHub repo fields can only be changed by the orchestrator.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_protect_github on public.projects;
create trigger projects_protect_github
  before update on public.projects
  for each row execute function public.protect_github_repo_fields();

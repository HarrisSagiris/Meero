-- Meero — public projects + marketplace cloning.
--
-- Free-plan projects are ALWAYS public (no toggle) — enforced by a trigger,
-- not just app logic, so it can't be bypassed by a direct API call from the
-- browser. Pro/Ultra projects default to private but can opt in via the
-- same `is_public` column (a normal user-settable field for paid plans).
--
-- "Cloning" a public project is an instant copy of its latest successful
-- build's real files + spec into a new project owned by the cloner — done
-- server-side by the orchestrator (service role), which is why build_files
-- itself never needs a public RLS policy: the browser never reads another
-- user's build_files directly, only through the trusted clone endpoint.

alter table public.projects
  add column is_public boolean not null default false,
  add column clone_of uuid references public.projects (id) on delete set null;

create index projects_is_public_idx on public.projects (is_public, updated_at desc)
  where is_public;

-- ---------------------------------------------------------------------------
-- RLS: public projects (and their builds/specs) are readable by ANY
-- authenticated user, not just the owner — additive to the existing
-- owner-only policies (Postgres OR's multiple permissive policies together).
-- ---------------------------------------------------------------------------

create policy "projects: public projects are readable"
  on public.projects for select
  to authenticated
  using (is_public);

create policy "builds: public project builds are readable"
  on public.builds for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.is_public
    )
  );

create policy "specs: public project specs are readable"
  on public.specs for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.is_public
    )
  );

-- build_files and build_artifacts deliberately get NO public policy — the
-- clone endpoint reads them server-side with the service-role client, so
-- the browser never needs direct cross-user access to generated source.

-- ---------------------------------------------------------------------------
-- Enforce "free plan => always public" at the database layer. Fires on
-- every insert/update regardless of which client role is writing, since
-- this is a product rule (not a privileged-column bypass concern like the
-- billing/GitHub triggers) — a free user's project can never be flipped
-- private, full stop.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_free_plan_public_projects()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_plan text;
begin
  select plan into owner_plan from public.profiles where id = new.owner_id;
  if owner_plan = 'free' then
    new.is_public := false;
  end if;
  return new;
end;
$$;

create trigger projects_enforce_free_public
  before insert or update on public.projects
  for each row execute function public.enforce_free_plan_public_projects();

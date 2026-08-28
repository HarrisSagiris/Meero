-- Meero — team/collaborator invites (owner decision, 2026-07-29).
--
-- v1 scope, deliberately: a collaborator is added by email (must already
-- have a Meero account — the orchestrator resolves the email to a real
-- user_id via service-role, since a regular user's browser can't query
-- other users' profiles by email under RLS; see POST
-- /projects/{id}/collaborators in app/main.py). No pending/accepted state —
-- every row here is an active collaborator; the owner adds or removes.
--
-- A collaborator can WORK on the app (chat, trigger builds/fixes, see
-- everything the owner sees) but NOT touch account-level connections
-- (GitHub/Supabase OAuth, custom domains, production releases) — those stay
-- gated to the real owner_id in app/main.py, unchanged.
create table public.project_collaborators (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  invited_by  uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);

create index project_collaborators_project_id_idx on public.project_collaborators (project_id);
create index project_collaborators_user_id_idx on public.project_collaborators (user_id);

alter table public.project_collaborators enable row level security;

create policy "project_collaborators: owner can select"
  on public.project_collaborators for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

create policy "project_collaborators: owner can insert"
  on public.project_collaborators for insert
  to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

create policy "project_collaborators: owner can delete"
  on public.project_collaborators for delete
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

-- A collaborator can see their own membership rows — e.g. a future "shared
-- with me" list — additive to the owner policy above.
create policy "project_collaborators: member can select own"
  on public.project_collaborators for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Collaborator access to the project's real working data — additive to the
-- existing owner-only policies (Postgres ORs permissive policies together).
-- These cover the browser's OWN direct Supabase reads (the web app reads
-- projects/messages/specs/builds/build_files directly, not only through the
-- orchestrator) plus real chat participation (messages insert). Actually
-- TRIGGERING a build/fix/deploy is a separate, service-role-mediated
-- orchestrator action (app/main.py) — RLS alone can't express "can start a
-- real build," so those endpoints gate on db.can_access_project() instead.
-- ---------------------------------------------------------------------------

create policy "projects: collaborator can select"
  on public.projects for select
  to authenticated
  using (
    exists (
      select 1 from public.project_collaborators c
      where c.project_id = id and c.user_id = (select auth.uid())
    )
  );

create policy "messages: collaborator can select"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.project_collaborators c
      where c.project_id = messages.project_id and c.user_id = (select auth.uid())
    )
  );

create policy "messages: collaborator can insert"
  on public.messages for insert
  to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.project_collaborators c
      where c.project_id = messages.project_id and c.user_id = (select auth.uid())
    )
  );

create policy "specs: collaborator can select"
  on public.specs for select
  to authenticated
  using (
    exists (
      select 1 from public.project_collaborators c
      where c.project_id = specs.project_id and c.user_id = (select auth.uid())
    )
  );

create policy "builds: collaborator can select"
  on public.builds for select
  to authenticated
  using (
    exists (
      select 1 from public.project_collaborators c
      where c.project_id = builds.project_id and c.user_id = (select auth.uid())
    )
  );

create policy "build_files: collaborator can select"
  on public.build_files for select
  to authenticated
  using (
    exists (
      select 1 from public.project_collaborators c
      where c.project_id = build_files.project_id and c.user_id = (select auth.uid())
    )
  );

-- A collaborator's builder view needs to know whether the OWNER'S Supabase/
-- GitHub are connected and what plan gates their Pro/Ultra features — but
-- profiles carries real billing internals (stripe_customer_id,
-- credits_remaining, bonus_credits, email) that a collaborator must never
-- see. Rather than widen `profiles` RLS (which is row-level, not
-- column-level, and would leak all of it), this returns exactly the three
-- public-projection columns the UI actually reads, and only to someone who
-- is genuinely the project's owner or an active collaborator.
create or replace function public.project_owner_public_profile(p_project_id uuid)
returns table (github_username text, supabase_connected boolean, plan text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1 from public.project_collaborators c
          where c.project_id = p_project_id and c.user_id = auth.uid()
        )
      )
  ) then
    return;
  end if;

  return query
    select pr.github_username, pr.supabase_connected, pr.plan
    from public.profiles pr
    join public.projects p on p.owner_id = pr.id
    where p.id = p_project_id;
end;
$$;

revoke all on function public.project_owner_public_profile(uuid) from public;
grant execute on function public.project_owner_public_profile(uuid) to authenticated;

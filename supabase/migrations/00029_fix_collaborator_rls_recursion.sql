-- Fixes "infinite recursion detected in policy for relation projects",
-- introduced by 00027_collaborators.sql.
--
-- Root cause: "projects: collaborator can select" queries
-- project_collaborators to check membership, but project_collaborators has
-- RLS enabled and its OWN "owner can select" policy queries projects right
-- back to check ownership. Postgres evaluates policies live, so this is a
-- genuine two-table cycle (projects -> project_collaborators -> projects ->
-- ...), not just a performance concern — it hard-fails every query against
-- either table for every user, which is why no projects were loading at all.
--
-- Standard fix: route the membership check through a SECURITY DEFINER
-- function. Running as the function owner, its internal query against
-- project_collaborators bypasses RLS entirely, so evaluating it never
-- re-triggers project_collaborators' own policies (which are what queried
-- projects and closed the loop). project_collaborators' policies are left
-- untouched — after this, only project_collaborators -> projects is a real
-- dependency; projects' own policies no longer touch project_collaborators
-- directly, so there is no cycle left to detect.
create or replace function public.is_project_collaborator(p_project_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.project_collaborators c
    where c.project_id = p_project_id and c.user_id = p_user_id
  );
$$;

revoke all on function public.is_project_collaborator(uuid, uuid) from public;
grant execute on function public.is_project_collaborator(uuid, uuid) to authenticated;

drop policy if exists "projects: collaborator can select" on public.projects;
create policy "projects: collaborator can select"
  on public.projects for select
  to authenticated
  using (public.is_project_collaborator(id, (select auth.uid())));

drop policy if exists "messages: collaborator can select" on public.messages;
create policy "messages: collaborator can select"
  on public.messages for select
  to authenticated
  using (public.is_project_collaborator(messages.project_id, (select auth.uid())));

drop policy if exists "messages: collaborator can insert" on public.messages;
create policy "messages: collaborator can insert"
  on public.messages for insert
  to authenticated
  with check (
    role = 'user'
    and public.is_project_collaborator(messages.project_id, (select auth.uid()))
  );

drop policy if exists "specs: collaborator can select" on public.specs;
create policy "specs: collaborator can select"
  on public.specs for select
  to authenticated
  using (public.is_project_collaborator(specs.project_id, (select auth.uid())));

drop policy if exists "builds: collaborator can select" on public.builds;
create policy "builds: collaborator can select"
  on public.builds for select
  to authenticated
  using (public.is_project_collaborator(builds.project_id, (select auth.uid())));

drop policy if exists "build_files: collaborator can select" on public.build_files;
create policy "build_files: collaborator can select"
  on public.build_files for select
  to authenticated
  using (public.is_project_collaborator(build_files.project_id, (select auth.uid())));

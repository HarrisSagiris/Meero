-- Zylo — generated source files, per build.
--
-- The codegen agent produces a complete native project (SwiftUI / Compose).
-- Those files are the source of truth for the compile, and we surface them in
-- the builder's "Code" tab so the user can watch the real code being written.
--
-- Like builds/build_artifacts, this table is written ONLY by the orchestrator
-- (service role) and is read-only to end users, scoped to their own projects.
-- RLS is enabled BEFORE any row is written — no exceptions.

create table public.build_files (
  id          uuid primary key default gen_random_uuid(),
  build_id    uuid not null references public.builds (id) on delete cascade,
  -- Denormalized so the builder can fetch "the newest generated project for
  -- this project" in one query without first resolving the latest build.
  project_id  uuid not null references public.projects (id) on delete cascade,
  path        text not null,
  content     text not null,
  language    text,
  seq         integer not null default 0,
  created_at  timestamptz not null default now()
);

create index build_files_build_id_idx on public.build_files (build_id, seq);
create index build_files_project_id_idx
  on public.build_files (project_id, created_at desc);

alter table public.build_files enable row level security;

create policy "build_files: project owner can select"
  on public.build_files for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

-- No insert/update/delete policies: only the service-role orchestrator writes
-- generated source. End users read their own project's code, nothing more.

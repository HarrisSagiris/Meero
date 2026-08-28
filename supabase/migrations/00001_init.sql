-- Zylo — initial schema
-- Every table gets Row Level Security BEFORE any data can be written to it.
-- Regular users interact through the anon/publishable key and are constrained
-- by these policies. The Python orchestrator (Milestone 2) will use the
-- service-role key, which bypasses RLS — hence builds/build_artifacts are
-- read-only for end users.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles — one row per auth user, created by trigger on signup
-- ---------------------------------------------------------------------------

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  display_name text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: owner can select"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: owner can update"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Inserts happen only via the security-definer trigger below; no insert
-- policy is granted to users on purpose.

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------

create table public.projects (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  description text,
  platforms   text[] not null default '{ios,android}'::text[]
              check (platforms <@ '{ios,android}'::text[]
                     and array_length(platforms, 1) between 1 and 2),
  is_starred  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index projects_owner_id_idx on public.projects (owner_id, updated_at desc);

alter table public.projects enable row level security;

create policy "projects: owner can select"
  on public.projects for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "projects: owner can insert"
  on public.projects for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "projects: owner can update"
  on public.projects for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "projects: owner can delete"
  on public.projects for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- specs — versioned natural-language prompts (+ parsed spec JSON, later
-- produced by the real Claude API in the orchestrator)
-- ---------------------------------------------------------------------------

create table public.specs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  version     integer not null check (version >= 1),
  prompt      text not null check (char_length(prompt) between 1 and 20000),
  parsed_spec jsonb,
  -- [{"path": "<owner_id>/<uuid>-name.pdf", "name": "name.pdf"}, …]
  attachments jsonb not null default '[]'::jsonb,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (project_id, version)
);

create index specs_project_id_idx on public.specs (project_id, version desc);

alter table public.specs enable row level security;

create policy "specs: project owner can select"
  on public.specs for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

create policy "specs: project owner can insert"
  on public.specs for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

-- Specs are immutable once written: no update/delete policies.

-- ---------------------------------------------------------------------------
-- builds — written exclusively by the orchestrator (service role).
-- End users can only read the builds of their own projects.
-- ---------------------------------------------------------------------------

create type public.build_platform as enum ('ios', 'android');
create type public.build_status as enum
  ('queued', 'running', 'succeeded', 'failed', 'canceled');

create table public.builds (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects (id) on delete cascade,
  spec_id     uuid not null references public.specs (id) on delete cascade,
  platform    public.build_platform not null,
  status      public.build_status not null default 'queued',
  queued_at   timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  worker_id   text,
  log_url     text,
  error       text
);

create index builds_project_id_idx on public.builds (project_id, queued_at desc);

alter table public.builds enable row level security;

create policy "builds: project owner can select"
  on public.builds for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

-- No insert/update/delete policies: only the service-role orchestrator
-- mutates builds.

-- ---------------------------------------------------------------------------
-- build_artifacts — .app bundles, APKs, logs; written by orchestrator only
-- ---------------------------------------------------------------------------

create table public.build_artifacts (
  id           uuid primary key default gen_random_uuid(),
  build_id     uuid not null references public.builds (id) on delete cascade,
  kind         text not null check (kind in ('app_bundle', 'apk', 'aab', 'log', 'source_archive')),
  storage_path text not null,
  size_bytes   bigint,
  metadata     jsonb,
  created_at   timestamptz not null default now()
);

create index build_artifacts_build_id_idx on public.build_artifacts (build_id);

alter table public.build_artifacts enable row level security;

create policy "build_artifacts: project owner can select"
  on public.build_artifacts for select
  to authenticated
  using (
    exists (
      select 1
      from public.builds b
      join public.projects p on p.id = b.project_id
      where b.id = build_id and p.owner_id = (select auth.uid())
    )
  );

-- No insert/update/delete policies: orchestrator only.

-- ---------------------------------------------------------------------------
-- Storage buckets
--   attachments — user-uploaded documents feeding into specs (user-scoped)
--   artifacts   — build outputs; written only by the orchestrator
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false), ('artifacts', 'artifacts', false)
on conflict (id) do nothing;

create policy "attachments: users insert into own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "attachments: users read own folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "attachments: users delete own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- artifacts bucket: no user policies — service-role orchestrator only.

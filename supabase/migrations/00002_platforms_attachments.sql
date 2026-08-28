-- Zylo — platforms + attachments (idempotent catch-up migration)
-- Run this if you applied an earlier version of 00001_init.sql that lacked
-- projects.platforms, specs.attachments, and the storage buckets/policies.
-- Fresh databases that ran the current 00001 can run this safely too.

alter table public.projects
  add column if not exists platforms text[] not null default '{ios,android}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'projects_platforms_check'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_platforms_check
      check (platforms <@ '{ios,android}'::text[]
             and array_length(platforms, 1) between 1 and 2);
  end if;
end $$;

alter table public.specs
  add column if not exists attachments jsonb not null default '[]'::jsonb;

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false), ('artifacts', 'artifacts', false)
on conflict (id) do nothing;

drop policy if exists "attachments: users insert into own folder" on storage.objects;
create policy "attachments: users insert into own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "attachments: users read own folder" on storage.objects;
create policy "attachments: users read own folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "attachments: users delete own folder" on storage.objects;
create policy "attachments: users delete own folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

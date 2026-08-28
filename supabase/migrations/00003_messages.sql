-- Zylo — real chat between the user and the build agent.
-- Users write only their own 'user' messages; 'assistant' rows are written
-- exclusively by the orchestrator (service role).

create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects (id) on delete cascade,
  role         text not null check (role in ('user', 'assistant')),
  content      text not null check (char_length(content) between 1 and 20000),
  -- Set when this message produced a new spec version
  spec_version integer,
  created_at   timestamptz not null default now()
);

create index messages_project_id_idx on public.messages (project_id, created_at);

alter table public.messages enable row level security;

create policy "messages: project owner can select"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

create policy "messages: project owner can insert user messages"
  on public.messages for insert
  to authenticated
  with check (
    role = 'user'
    and exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

-- No update/delete; assistant rows come from the service role only.

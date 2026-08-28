-- Meero — real chat with Superagent (00033_superagent.sql), not just a
-- one-time "assign a task" instructions field. Every message — from the
-- user AND the agent's real reply — is a row here, scoped to one connected
-- repo. Distinct from superagent_events (which logs a webhook-triggered
-- @meero mention run): this is the direct, synchronous "message the agent"
-- path (POST /superagent/connections/{id}/chat) — same real brain
-- (app/agent/superagent_brain.py) and same real PR-opening
-- (app/superagent.py), just invoked from a chat composer instead of a
-- GitHub comment.
--
-- Same service-role-only pattern as superagent_connections — never read
-- directly by the browser; the builder reads it through
-- GET /superagent/connections/{id}/messages instead.

create table public.superagent_messages (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.superagent_connections (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  role           text not null check (role in ('user', 'assistant')),
  content        text not null,
  pr_url         text,
  created_at     timestamptz not null default now()
);

alter table public.superagent_messages enable row level security;

create index superagent_messages_connection_id_idx
  on public.superagent_messages (connection_id, created_at);

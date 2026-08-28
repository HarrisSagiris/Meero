-- Meero — Superagent: a personal GitHub bot. The user connects one of
-- their own real repos; a real webhook (created via the GitHub REST API,
-- using their existing OAuth token from github_connections/00008) notifies
-- the orchestrator whenever someone comments "@meero" on an issue or PR in
-- that repo; the orchestrator runs a real LLM agent against the repo's
-- real files and opens a genuine pull request via the Git Data API (see
-- app/superagent.py, app/workers/superagent_worker.py).
--
-- Same service-role-only pattern as github_connections (00008) and
-- supabase_connections (00017): this table holds a real per-repo webhook
-- secret (used to verify inbound GitHub payloads), so RLS is enabled with
-- ZERO policies for authenticated/anon — the browser must never read it
-- directly. The builder reads connection/event state through narrow
-- orchestrator endpoints instead (GET /superagent/connections, GET
-- /superagent/connections/{id}/events).

create table public.superagent_connections (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.profiles (id) on delete cascade,
  github_repo_full_name  text not null,
  github_repo_url        text not null,
  github_webhook_id      bigint not null,
  webhook_secret         text not null,
  instructions           text not null default '',
  status                 text not null default 'active' check (status in ('active', 'paused')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (user_id, github_repo_full_name)
);

alter table public.superagent_connections enable row level security;

create trigger superagent_connections_set_updated_at
  before update on public.superagent_connections
  for each row execute function public.set_updated_at();

create index superagent_connections_user_id_idx
  on public.superagent_connections (user_id);

-- One row per real @meero mention this connection has handled — a genuine
-- audit trail: what triggered it, whether the agent run actually succeeded,
-- and the real PR it opened (if any). Never a fake/simulated status.
create table public.superagent_events (
  id             uuid primary key default gen_random_uuid(),
  connection_id  uuid not null references public.superagent_connections (id) on delete cascade,
  user_id        uuid not null references public.profiles (id) on delete cascade,
  event_type     text not null,
  issue_number   integer,
  status         text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  pr_url         text,
  summary        text,
  error          text,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz
);

alter table public.superagent_events enable row level security;

create index superagent_events_connection_id_idx
  on public.superagent_events (connection_id);
create index superagent_events_user_id_idx
  on public.superagent_events (user_id);

-- Meero — real Slack integration for Superagent: link one connected repo
-- (superagent_connections, 00033) to a real Slack channel, so an
-- "@Meero" mention there picks up the exact same real agent run a GitHub
-- "@meero" mention or a chat message already does (see
-- app/main.py's /webhooks/slack/events and app/workers/superagent_worker.py).
--
-- Requires a real Slack App (Settings.slack_configured in app/config.py) —
-- until one's registered and its credentials are set, every Slack code
-- path is a clean no-op; this schema exists either way since it costs
-- nothing to have ready.
--
-- Same service-role-only pattern as github_connections/superagent_connections
-- — a real bot OAuth token lives here, never read directly by the browser.

create table public.slack_connections (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  team_id       text not null,
  team_name     text not null,
  bot_token     text not null,
  bot_user_id   text not null,
  created_at    timestamptz not null default now()
);

alter table public.slack_connections enable row level security;

-- One repo connection can be triggered from one Slack channel (nullable —
-- most connections have no Slack channel linked at all). Unique so a
-- channel can't accidentally fan out to two different repos.
alter table public.superagent_connections
  add column slack_channel_id text,
  add column slack_channel_name text;

create unique index superagent_connections_slack_channel_idx
  on public.superagent_connections (slack_channel_id)
  where slack_channel_id is not null;

-- Meero — autonomous conversion optimization agent (owner decision, 2026-08-04).
--
-- Every generated app already ships a required behavior tracker
-- (components/meero-behavior-tracker.tsx) that unconditionally records
-- visitor events into `_meero_behavior_events` on the app owner's OWN
-- Supabase project — same pattern as _meero_runtime_errors, always on,
-- never gated by any toggle here.
--
-- conversion_agent_enabled gates a DIFFERENT thing: whether the
-- orchestrator's background agent (app/conversion_agent.py) analyzes that
-- data and proposes/runs experiments for THIS project. Off by default —
-- a fully opt-in feature, unlike runtime_monitor which always watches
-- every Supabase-linked project. Plain owner-writable preference, no
-- trigger, same as autonomy_mode/is_starred (00001_init.sql's "projects:
-- owner can update" policy already covers it).
alter table public.projects
  add column if not exists conversion_agent_enabled boolean not null default false;

-- conversion_hypotheses — one row per DETECTED conversion issue (dead
-- clicks, CTA below fold, form abandonment, funnel drop-off, ...). Written
-- only by the orchestrator (service role); a hypothesis may or may not
-- ever become an experiment (see status).
--
-- No `_meero_` prefix: that prefix is reserved for tables living INSIDE
-- generated apps' own Supabase projects (_meero_runtime_errors,
-- _meero_behavior_events) — this table lives in Meero's own schema,
-- exactly like builds/project_collaborators, which never use it.
create table public.conversion_hypotheses (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects (id) on delete cascade,
  issue_type       text not null check (issue_type in (
                     'cta_below_fold', 'low_ctr', 'dead_click', 'rage_click',
                     'form_abandonment', 'pricing_drop_off', 'signup_drop_off'
                   )),
  page_path        text not null,
  element_selector text,
  description      text not null,
  proposed_fix     text not null,
  evidence         jsonb not null default '{}'::jsonb,
  status           text not null default 'open' check (status in (
                     'open', 'dismissed', 'experimenting', 'resolved'
                   )),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index conversion_hypotheses_project_id_idx
  on public.conversion_hypotheses (project_id, created_at desc);

alter table public.conversion_hypotheses enable row level security;

create policy "conversion_hypotheses: owner can select"
  on public.conversion_hypotheses for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

create policy "conversion_hypotheses: collaborator can select"
  on public.conversion_hypotheses for select
  to authenticated
  using (
    exists (
      select 1 from public.project_collaborators c
      where c.project_id = conversion_hypotheses.project_id
        and c.user_id = (select auth.uid())
    )
  );
-- No insert/update/delete policies: service-role orchestrator only.

-- conversion_experiments — one row per LAUNCHED A/B experiment.
-- experiment_key matches the value the launch build writes into
-- _meero_behavior_events.experiment_key on the user's OWN Supabase, so
-- results can be joined logically — never a literal foreign key, since the
-- two databases are different Postgres instances entirely.
create table public.conversion_experiments (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references public.projects (id) on delete cascade,
  hypothesis_id        uuid not null references public.conversion_hypotheses (id) on delete cascade,
  experiment_key       text not null,
  goal_event           text not null,
  launch_build_id      uuid references public.builds (id),
  graduation_build_id  uuid references public.builds (id),
  status               text not null default 'running' check (status in (
                         'running', 'winner_a', 'winner_b', 'inconclusive', 'reverted'
                       )),
  started_at           timestamptz not null default now(),
  decided_at           timestamptz,
  unique (project_id, experiment_key)
);

create index conversion_experiments_project_id_idx
  on public.conversion_experiments (project_id, started_at desc);
create index conversion_experiments_status_idx
  on public.conversion_experiments (project_id, status);

alter table public.conversion_experiments enable row level security;

create policy "conversion_experiments: owner can select"
  on public.conversion_experiments for select
  to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_id and p.owner_id = (select auth.uid())
    )
  );

create policy "conversion_experiments: collaborator can select"
  on public.conversion_experiments for select
  to authenticated
  using (
    exists (
      select 1 from public.project_collaborators c
      where c.project_id = conversion_experiments.project_id
        and c.user_id = (select auth.uid())
    )
  );

-- conversion_results — one row per EVALUATION pass of a running experiment
-- (several rows accumulate before a final decision — see
-- app/conversion_agent.py's evaluate-on-every-poll design). A real audit
-- trail of the significance math, never overwriting a single "current" row.
create table public.conversion_results (
  id             uuid primary key default gen_random_uuid(),
  experiment_id  uuid not null references public.conversion_experiments (id) on delete cascade,
  exposures_a    integer not null,
  exposures_b    integer not null,
  conversions_a  integer not null,
  conversions_b  integer not null,
  p_value        double precision,
  lift_pct       double precision,
  decision       text not null check (decision in (
                   'continue', 'winner_a', 'winner_b', 'inconclusive'
                 )),
  evaluated_at   timestamptz not null default now()
);

create index conversion_results_experiment_id_idx
  on public.conversion_results (experiment_id, evaluated_at desc);

alter table public.conversion_results enable row level security;

create policy "conversion_results: owner can select"
  on public.conversion_results for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversion_experiments e
      join public.projects p on p.id = e.project_id
      where e.id = experiment_id and p.owner_id = (select auth.uid())
    )
  );

create policy "conversion_results: collaborator can select"
  on public.conversion_results for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversion_experiments e
      join public.project_collaborators c on c.project_id = e.project_id
      where e.id = experiment_id and c.user_id = (select auth.uid())
    )
  );

-- builds — new columns linking a build to the conversion experiment it
-- launched/graduated/reverted. No new RLS needed: builds already has no
-- authenticated write policy (00001_init.sql) — only the service-role
-- orchestrator ever writes a build row — same justification as
-- 00041_runtime_monitor.sql's is_autonomous_fix.
alter table public.builds
  add column if not exists is_conversion_experiment boolean not null default false,
  add column if not exists conversion_experiment_id uuid references public.conversion_experiments (id),
  add column if not exists conversion_experiment_action text
    check (conversion_experiment_action is null or conversion_experiment_action in (
      'launch', 'graduate', 'revert'
    ));

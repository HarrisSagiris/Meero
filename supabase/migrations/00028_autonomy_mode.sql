-- Meero — Solo mode vs. Manual mode (owner decision, 2026-07-29).
--
-- Solo mode (default, today's existing behavior): the chat agent starts a
-- real build the moment it decides the spec is ready, no extra step.
-- Manual mode: the agent still decides a build is ready, but instead of
-- queueing it, it parks the target spec on `pending_build_spec_id` and asks
-- in chat — the real build only starts once the user hits "Approve build"
-- (POST /projects/{id}/approve-build in app/main.py). See app/agent/graph.py
-- apply_node for where this branches.
--
-- `autonomy_mode` is a plain user preference — freely owner-writable under
-- the existing "projects: owner can update" policy (00001_init.sql), same
-- as is_starred. `pending_build_spec_id` represents real orchestrator state
-- (what the AI is currently waiting on approval for) and is trigger-
-- protected like every other orchestrator-only column.
alter table public.projects
  add column if not exists autonomy_mode text not null default 'solo'
    check (autonomy_mode in ('solo', 'manual')),
  add column if not exists pending_build_spec_id uuid references public.specs (id) on delete set null;

create or replace function public.protect_pending_build_field()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
     and new.pending_build_spec_id is distinct from old.pending_build_spec_id then
    raise exception 'pending_build_spec_id can only be changed by the orchestrator.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_protect_pending_build on public.projects;
create trigger projects_protect_pending_build
  before update on public.projects
  for each row execute function public.protect_pending_build_field();

-- Meero — auto-provisioned Supabase backend (owner decision, 2026-08-08).
--
-- Previously, connecting a Supabase account (OAuth) was step one of two:
-- the user then had to pick which of their EXISTING Supabase projects to
-- bind to this Meero project (POST /projects/{id}/supabase/link). Now,
-- connecting the account is the only step — the orchestrator calls the
-- real Supabase Management API to provision a brand-new Supabase project
-- on the user's own account and links it automatically once it's live.
--
-- Real provisioning takes on the order of a minute, so it can't happen
-- synchronously inside the OAuth callback. These two columns track that
-- in-flight state; `supabase_project_ref`/`supabase_url`/`supabase_anon_key`
-- (00017) are deliberately left null until the new project is genuinely
-- ACTIVE and its anon key has been read back — every existing build/chat
-- gate treats a non-null supabase_project_ref as "ready to build against",
-- so setting it any earlier would let a build get queued against a
-- database that doesn't exist yet.
--
-- Trigger-protected the same way as the 00017 link fields: only the
-- service-role orchestrator ever writes these, after a real Management API
-- call. `protect_supabase_link_fields()` is extended in place (same
-- function, same trigger) rather than adding a parallel trigger.

alter table public.projects add column if not exists supabase_provisioning_status text
  check (supabase_provisioning_status is null or supabase_provisioning_status in ('provisioning', 'failed'));
alter table public.projects add column if not exists supabase_provisioning_ref text;
alter table public.projects add column if not exists supabase_provisioning_error text;
alter table public.projects add column if not exists supabase_provisioning_started_at timestamptz;

create or replace function public.protect_supabase_link_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    if new.supabase_project_ref is distinct from old.supabase_project_ref
       or new.supabase_url is distinct from old.supabase_url
       or new.supabase_anon_key is distinct from old.supabase_anon_key
       or new.supabase_provisioning_status is distinct from old.supabase_provisioning_status
       or new.supabase_provisioning_ref is distinct from old.supabase_provisioning_ref
       or new.supabase_provisioning_error is distinct from old.supabase_provisioning_error
       or new.supabase_provisioning_started_at is distinct from old.supabase_provisioning_started_at
    then
      raise exception 'Supabase link fields can only be changed by the orchestrator.';
    end if;
  end if;
  return new;
end;
$$;
-- Trigger already exists (projects_protect_supabase, 00017) and picks up
-- this redefinition automatically — no need to drop/recreate it.

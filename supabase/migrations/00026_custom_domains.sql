-- Meero — custom domains for Pro/Ultra production releases (owner decision,
-- 2026-07-29). A Vercel release only ever gave a *.vercel.app URL; this lets
-- an owner point their OWN domain at it via Vercel's real Domains API (see
-- app/workers/deploy_worker.py's add_domain/get_domain_status/remove_domain)
-- — real DNS verification, no faking a "connected" state.
--
-- Trigger-protected the same way as live_url/screenshot_url: only the
-- service-role orchestrator writes these, after a real Vercel API call
-- confirmed them — never optimistically, never from the user's own browser.

alter table public.projects
  add column if not exists custom_domain text,
  add column if not exists custom_domain_verified boolean not null default false;

create or replace function public.protect_custom_domain_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and (
    new.custom_domain is distinct from old.custom_domain
    or new.custom_domain_verified is distinct from old.custom_domain_verified
  ) then
    raise exception 'custom_domain fields can only be changed by the orchestrator.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_protect_custom_domain on public.projects;
create trigger projects_protect_custom_domain
  before update on public.projects
  for each row execute function public.protect_custom_domain_fields();

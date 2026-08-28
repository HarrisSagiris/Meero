-- Meero — public-project screenshots for the logged-out landing page gallery.
--
-- The landing page (src/components/landing/landing.tsx) shows a gallery of
-- public projects to visitors who AREN'T signed in yet. 00015_marketplace.sql
-- only granted `to authenticated` read access to public projects, which is
-- correct for in-app marketplace browsing but means a logged-out visitor's
-- anon-role query returns nothing — so a matching `to anon` policy is added
-- here, deliberately, for the same is_public rows only (no new columns are
-- exposed beyond what authenticated marketplace browsing already shows;
-- this only widens WHO can see them).
--
-- screenshot_url is a real screenshot of the project's live preview, taken
-- by the web worker with a headless browser right after a successful build
-- (see orchestrator/app/workers/web_worker.py) — never a placeholder passed
-- off as real. Trigger-protected the same way as live_url (00016) and the
-- GitHub fields (00008): only the service-role orchestrator can set it, so
-- a project owner's own browser client can't fabricate one.

alter table public.projects add column if not exists screenshot_url text;

create or replace function public.protect_screenshot_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and new.screenshot_url is distinct from old.screenshot_url then
    raise exception 'screenshot_url can only be changed by the orchestrator.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_protect_screenshot_url on public.projects;
create trigger projects_protect_screenshot_url
  before update on public.projects
  for each row execute function public.protect_screenshot_url();

-- ---------------------------------------------------------------------------
-- Anonymous read access to public projects — additive to the existing
-- authenticated-only policy from 00015.
-- ---------------------------------------------------------------------------

create policy "projects: public projects are readable by anyone"
  on public.projects for select
  to anon
  using (is_public);

-- ---------------------------------------------------------------------------
-- PUBLIC bucket for screenshots — same pattern as the `previews` bucket
-- (00011_expo_platform.sql): written only by the orchestrator's service-role
-- client (no storage.objects policies needed for writes), served directly
-- from Storage's own public object URL for reads. Unlike the previews
-- bucket's HTML, Storage serves images (image/jpeg) with the correct
-- content-type and no blocking CSP, so — unlike /preview — this does NOT
-- need the orchestrator's own proxy route in front of it.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', true)
on conflict (id) do nothing;

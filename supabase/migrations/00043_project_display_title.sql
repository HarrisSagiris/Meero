-- Meero — AI-generated display title for the public gallery.
--
-- `projects.name` is derived client-side from the first line of the user's
-- raw build prompt (nameFromPrompt() in src/app/projects/actions.ts) — fine
-- as the working project name in the dashboard/builder, but often reads
-- like a literal prompt ("i want you to build me a site that For a...") when
-- shown to a logged-out visitor in the landing page's public gallery
-- (src/components/landing/public-gallery.tsx). display_title is a real,
-- separate LLM-generated short title for that one display context — it
-- never overwrites the owner-editable `name` used everywhere else.
--
-- Generated once by a new orchestrator endpoint (POST
-- /projects/{id}/generate-title), called best-effort right after project
-- creation. Trigger-protected the same way as screenshot_url (00020) and
-- live_url (00016): only the service-role orchestrator can set it.

alter table public.projects add column if not exists display_title text;

create or replace function public.protect_display_title()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and new.display_title is distinct from old.display_title then
    raise exception 'display_title can only be changed by the orchestrator.';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_protect_display_title on public.projects;
create trigger projects_protect_display_title
  before update on public.projects
  for each row execute function public.protect_display_title();

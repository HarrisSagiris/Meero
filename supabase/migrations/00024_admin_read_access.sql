-- Meero — real admin stats (owner decision, 2026-07-28).
--
-- The admin page's "users signed up so far" count was silently wrong: it
-- queries through the SAME RLS-scoped client as any other user (the web app
-- never holds the service-role key), and profiles/projects/builds only ever
-- had OWNER-scoped select policies — so the count query returned 1 (just
-- the admin's own row), not the real total, for every admin who ever looked
-- at it.
--
-- Fix: additive SELECT policies for the one hardcoded admin account, same
-- pattern as 00019_admin_signup_cap.sql's "app_settings: admin can update"
-- (auth.jwt() ->> 'email' check — this is a single-operator dashboard, not
-- a roles system). This is genuinely additive (Postgres ORs permissive
-- policies together) — every existing owner-scoped policy is untouched, and
-- every other authenticated user's access is completely unaffected.
--
-- Deliberately NOT extended to github_connections / supabase_connections /
-- build_files / build_artifacts — those hold real OAuth tokens or generated
-- source and stay service-role-only regardless of who's asking, by design
-- (see AGENTS.md). Aggregate stats never need them.

create policy "profiles: admin can select all"
  on public.profiles for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create policy "projects: admin can select all"
  on public.projects for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create policy "builds: admin can select all"
  on public.builds for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

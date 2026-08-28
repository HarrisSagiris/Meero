-- Zylo — Expo as a first-class build platform.
--
-- Framework is now plan-gated (see AGENTS.md): free/pro plans generate one
-- cross-platform Expo (React Native) build previewed as an `expo export` web
-- bundle; the ultra plan keeps real native iOS/Android. A single Expo build
-- row uses platform = 'expo' instead of separate 'ios'/'android' rows.
--
-- NOTE: `alter type ... add value` cannot be used in the same transaction as
-- a statement that reads/writes a row using the new value — this migration
-- only extends the enum; nothing below references 'expo' as a value.
alter type public.build_platform add value if not exists 'expo';

-- PUBLIC Storage bucket for exported Expo web bundles. The Expo worker
-- (app/workers/expo_worker.py) uploads each build's `expo export --platform
-- web` output to previews/<build_id>/... and sets builds.preview_url to the
-- public index.html URL, which the builder iframes directly in the browser.
--
-- public = true means Supabase serves objects from this bucket at
-- /storage/v1/object/public/previews/... with NO auth/RLS check on read —
-- required so an anonymous browser tab can load the iframe. Writes still go
-- exclusively through the service-role orchestrator (RLS default-denies
-- authenticated/anon writes on storage.objects; same "zero user-facing
-- policies" pattern as the `artifacts` bucket in 00001_init.sql).
insert into storage.buckets (id, name, public)
values ('previews', 'previews', true)
on conflict (id) do update set public = true;

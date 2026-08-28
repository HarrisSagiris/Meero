-- Meero — real version control for generated apps: roll back to an
-- earlier successful build's exact source.
--
-- Every succeeded build already stores its own complete generated source
-- in build_files (00006_build_files.sql) — rolling back doesn't need a
-- separate "versions" table, it just needs a way to record that a NEW
-- build's source was copied from an OLDER one rather than freshly
-- generated (see POST /builds/{id}/restore). Same pattern as retry_of
-- (00007_build_retry.sql): a genuine second real build (schema re-applied,
-- a real `next build`, a real commit to main), never a mock swap, and it
-- spends a real credit like any other build. The build being restored TO
-- is never touched or deleted — restoring is always a new forward build,
-- so it can always be restored to again later.
--
-- `builds` is already RLS-protected (00001_init.sql); a plain column add
-- inherits the existing owner-read-only SELECT policy — no new policy
-- needed, and still no insert/update/delete policy for end users.

alter table public.builds
  add column restored_from uuid references public.builds (id) on delete set null;

create index builds_restored_from_idx on public.builds (restored_from) where restored_from is not null;

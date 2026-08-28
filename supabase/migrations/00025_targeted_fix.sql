-- Meero — targeted auto-fix explanations + diffs (owner decision, 2026-07-28).
--
-- fix_project (app/agent/codegen.py) no longer always rewrites the whole
-- project to fix a build error: when the error confidently scopes to a
-- small set of files, only THOSE are regenerated — everything else is
-- carried forward byte-for-byte. Either way (targeted or a full-regenerate
-- fallback), the codegen worker now computes a real diff of what actually
-- changed and a plain-English explanation, stored here for the builder's
-- fix-review UI. `builds` already has no authenticated INSERT/UPDATE policy
-- (00001_init.sql) — only the service-role codegen worker ever writes a
-- build row — so these columns need no additional RLS.
alter table public.builds
  add column if not exists fix_explanation text,
  add column if not exists fix_diff jsonb;

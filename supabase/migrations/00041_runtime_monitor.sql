-- Meero — 24/7 autonomous runtime monitoring (owner decision, 2026-08-03).
--
-- Distinguishes an autonomous fix (fired by the background poller, no
-- human click — orchestrator/app/runtime_monitor.py) from a manual one
-- (POST /projects/{id}/runtime-errors/fix): both already set
-- is_runtime_fix=true (00021_runtime_auto_fix.sql), which only tells the
-- web worker HOW to ship the result (PR vs. main) — it doesn't say WHO
-- triggered it or whether the fix was ever actually verified, which is
-- what these columns add.
--
-- runtime_error_ids: which _meero_runtime_errors rows (on the user's OWN
-- Supabase) this build is meant to resolve — resolution is deferred until
-- AFTER the build's readiness checks genuinely pass (see
-- app/runtime_monitor.py's evaluate_and_publish), never optimistic like
-- the manual fix flow.
--
-- runtime_fix_verified: tri-state. null = not an autonomous fix, or not
-- checked yet. true = readiness checks passed, original error(s) marked
-- resolved. false = the fix compiled but failed verification, OR failed
-- to compile at all — the original error is still open, surfaced as a
-- regression, never silently trusted.
--
-- `builds` has no authenticated write policy (00001_init.sql) — only the
-- service-role orchestrator ever writes a build row — so these need no
-- additional RLS or trigger protection, same as readiness_checks
-- (00022_readiness_checks.sql).
alter table public.builds
  add column if not exists is_autonomous_fix boolean not null default false,
  add column if not exists runtime_error_ids jsonb,
  add column if not exists runtime_fix_verified boolean;

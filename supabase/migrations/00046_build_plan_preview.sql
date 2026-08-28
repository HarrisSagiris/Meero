-- Persists the growing partial AppPlan the codegen worker streams live
-- (previously WS-only — see codegen_worker.py's on_plan callback), so a
-- page refresh mid-planning, or after planning finishes but before/during
-- file generation, still shows the real plan instead of losing it and
-- falling back to a generic "Planning the app..." message with no detail.
-- Mirrors 00040_build_files_live_persist.sql's fix for the same class of
-- bug on generated files. `builds` has no authenticated write policy
-- (00001_init.sql) — only the service-role orchestrator ever writes it —
-- so this needs no extra trigger protection beyond what already exists.
alter table public.builds
  add column if not exists plan_preview jsonb;

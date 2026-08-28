-- Meero — autonomous runtime-error auto-fix (owner decision, 2026-07-28).
--
-- Distinguishes a build triggered by a captured PRODUCTION runtime error
-- (via POST /projects/{id}/runtime-errors/fix) from every other build. The
-- web worker uses this single flag to decide how a successful build ships:
-- a normal build/compile-error auto-fix commits straight to `main`
-- (maybe_commit_build_to_github), but a runtime fix is speculative — a
-- reaction to a live error, not verified against a real compile the way a
-- normal build already is twice over — so it opens a reviewable PR instead
-- (maybe_open_runtime_fix_pr). retry_of is reused as the generic "which
-- build this one is meant to fix" link; it already points at a real build
-- regardless of why (compile failure or a runtime bug found later).

alter table public.builds
  add column if not exists is_runtime_fix boolean not null default false;

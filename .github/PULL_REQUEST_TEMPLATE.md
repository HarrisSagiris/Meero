<!-- Keep PRs focused — one concern per PR. -->

## Summary

<!-- What does this change and why? -->

Closes #

## How this was tested

<!-- Commands run, and the end-to-end path you exercised. A feature is "done"
     only when a real signed-up Supabase user can use it. -->

## Checklist

- [ ] `npm run format:check` passes (`npm run format` to fix)
- [ ] `npm run lint -w apps/web` passes with no new warnings
- [ ] `npx -w apps/web tsc --noEmit` passes
- [ ] `npm run build -w apps/web` succeeds (if `apps/web` changed)
- [ ] `ruff check apps/orchestrator --select E9,F` passes (if `apps/orchestrator` changed)
- [ ] New DB tables are in a **new** numbered migration with RLS + at least one policy
- [ ] `python apps/orchestrator/scripts/check_vendored_versions.py` passes (if the generated-app toolchain changed)
- [ ] `CHANGELOG.md` updated under `## [Unreleased]` (if user-facing)

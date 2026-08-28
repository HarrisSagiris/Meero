-- Zylo — AI auto-fix retries.
--
-- When a real compile fails, the orchestrator queues at most ONE automatic
-- AI-driven fix attempt: a new build row for the same spec, linked back to
-- the build it's fixing via retry_of. The one-hop cap (a fix build's own
-- failure is never auto-fixed again) is enforced in application logic —
-- this column just needs to exist so the app can detect and render the
-- link. It's a genuine second codegen + compile attempt, never a mock, and
-- spends a real credit like any other build.
--
-- `builds` is already RLS-protected (00001_init.sql); a plain column add
-- inherits the existing owner-read-only SELECT policy — no new policy
-- needed, and still no insert/update/delete policy for end users.

alter table public.builds
  add column retry_of uuid references public.builds (id) on delete set null;

create index builds_retry_of_idx on public.builds (retry_of) where retry_of is not null;

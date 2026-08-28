-- Meero — deeper conversion-optimization measurement (owner decision, 2026-08-07).
--
-- Three real additions, all computed from data the required behavior
-- tracker (components/meero-behavior-tracker.tsx) already records — no new
-- tracked event types needed, so this benefits every already-built app
-- immediately, not just ones rebuilt after this ships:
--
--   1. Three new detector issue_types (app/conversion_agent.py):
--      'device_gap' (a real, significant conversion-rate gap between mobile
--      and desktop), 'high_bounce' (a specific page with an unusually high
--      single-pageview-and-leave rate vs. the app's other pages), and
--      'exit_page' (the page sessions most commonly END on — a real "where
--      do people leave" signal, distinct from a funnel drop-off between two
--      named steps).
--   2. Confidence-interval columns on conversion_results — the existing
--      p_value/lift_pct told you IF a result was significant; ci_low_pct/
--      ci_high_pct tell you the real range the true lift plausibly falls
--      in, computed the same two-proportion way (Wilson score interval,
--      stdlib math only, same as _two_proportion_z_test).
--   3. Nothing schema-side for the KPI dashboard or per-page/funnel
--      breakdown — those are pure aggregation queries against the existing
--      _meero_behavior_events data (see supabase_connect.py), no new
--      columns required.

alter table public.conversion_hypotheses
  drop constraint conversion_hypotheses_issue_type_check;

alter table public.conversion_hypotheses
  add constraint conversion_hypotheses_issue_type_check
  check (issue_type in (
    'cta_below_fold', 'low_ctr', 'dead_click', 'rage_click',
    'form_abandonment', 'pricing_drop_off', 'signup_drop_off',
    'device_gap', 'high_bounce', 'exit_page'
  ));

alter table public.conversion_results
  add column if not exists ci_low_pct double precision,
  add column if not exists ci_high_pct double precision;

-- Meero — two more real onboarding questions (src/components/onboarding/
-- onboarding-wizard.tsx): how someone found Meero, and what best describes
-- them. Both plain, non-privileged profiles columns — like `onboarded`
-- (00036) and `display_name`, covered by the existing "profiles: owner can
-- update" RLS policy (00001_init.sql); no new policy needed.

alter table public.profiles add column referral_source text;
alter table public.profiles add column role text;

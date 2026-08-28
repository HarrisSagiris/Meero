-- Zylo — EAS Update project linkage, for real-device Expo Go scanning.
--
-- Free/pro (Expo) builds now ALSO publish an EAS Update after the web export
-- succeeds, so users can scan a QR code and run the real app in Expo Go on
-- their own phone — not just the browser preview. This supersedes the "no
-- EAS" rule for the Expo path specifically (owner decision, 2026-07-21):
-- native ultra builds still use GitHub Actions + Appetize, no EAS there.
--
-- One EAS project per Zylo project, created lazily on the project's first
-- Expo build and reused for every build after — so the SAME QR code / scan
-- link keeps working; each new build just publishes a fresh update to the
-- "preview" channel under that project. Written by the orchestrator
-- (service role) only, same as builds/build_artifacts.

alter table public.projects
  add column if not exists eas_project_id text;

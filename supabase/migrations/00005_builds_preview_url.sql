-- Zylo — live preview embed URL for a build.
--
-- iOS builds compile on a GitHub Actions macOS runner and get uploaded to
-- Appetize.io, whose real device cloud streams the actual compiled app
-- into any browser (no Mac required to view it). `preview_url` holds that
-- embed link once the build succeeds. Nothing here is a mock — it points
-- at a real simulator instance running the real compiled binary.

alter table public.builds
  add column if not exists preview_url text;

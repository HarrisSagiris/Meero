-- Meero — optional photo on a news post (00031_news_posts.sql).
--
-- PUBLIC bucket, same pattern as `screenshots` (00020_project_screenshots.sql):
-- served directly from Storage's own public object URL for reads (a public
-- bucket bypasses storage.objects RLS entirely for SELECT, so no read
-- policy is needed). Unlike screenshots (written only by the orchestrator's
-- service-role client), a news image is uploaded by the admin's own
-- browser client, so — same hardcoded single-operator pattern as
-- news_posts itself — only the one admin account may write into this
-- bucket's storage.objects rows.

alter table public.news_posts add column image_url text;

insert into storage.buckets (id, name, public)
values ('news-images', 'news-images', true)
on conflict (id) do nothing;

create policy "news-images: admin can insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'news-images'
    and (select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com'
  );

create policy "news-images: admin can update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'news-images'
    and (select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com'
  );

create policy "news-images: admin can delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'news-images'
    and (select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com'
  );

-- Meero — site news/blog posts: a top announcement bar (above the navbar)
-- surfacing the latest post, plus a public /news listing and per-post page.
--
-- Single-operator content, same pattern as app_settings
-- (00019_admin_signup_cap.sql): world-readable, only the one admin account
-- can write. `published` supports drafting a post before it goes out —
-- the admin dashboard can always see drafts (its own SELECT policy below),
-- everyone else only sees published ones.

create table public.news_posts (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  body        text not null,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.news_posts enable row level security;

create policy "news_posts: anyone can select published"
  on public.news_posts for select
  to anon, authenticated
  using (published);

-- Hardcoded to one owner account by design — same single-operator pattern
-- as app_settings, not a roles system. Lets the admin dashboard see and
-- manage drafts, which the "anyone" policy above deliberately excludes.
create policy "news_posts: admin can select all"
  on public.news_posts for select
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create policy "news_posts: admin can insert"
  on public.news_posts for insert
  to authenticated
  with check ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create policy "news_posts: admin can update"
  on public.news_posts for update
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com')
  with check ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create policy "news_posts: admin can delete"
  on public.news_posts for delete
  to authenticated
  using ((select auth.jwt() ->> 'email') = 'sagirisharris@gmail.com');

create trigger news_posts_set_updated_at
  before update on public.news_posts
  for each row execute function public.set_updated_at();

create index news_posts_published_created_idx
  on public.news_posts (published, created_at desc);

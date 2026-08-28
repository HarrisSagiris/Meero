-- Lets the codegen worker persist each generated file the moment it's
-- finished streaming, instead of only writing the whole bundle once at the
-- very end (see 00006_build_files.sql). Without this, a page refresh while
-- a build is still generating shows nothing — the in-progress code exists
-- only in an ephemeral pubsub event, not in Postgres — even though nothing
-- was actually lost server-side. A real per-file upsert needs a real
-- uniqueness guarantee on (build_id, path) to upsert against.

-- Existing data can already have duplicate (build_id, path) rows (e.g. a
-- retried codegen run that wrote via insert rather than upsert in the past)
-- — dedupe first, keeping the most recently written row per pair, or the
-- unique constraint below can't be created.
delete from public.build_files bf
using (
  select id,
         row_number() over (
           partition by build_id, path order by created_at desc, id desc
         ) as rn
  from public.build_files
) dupes
where bf.id = dupes.id and dupes.rn > 1;

alter table public.build_files
  add constraint build_files_build_id_path_key unique (build_id, path);

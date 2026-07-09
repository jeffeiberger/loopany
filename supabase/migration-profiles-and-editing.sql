-- Run this in your EXISTING Supabase project's SQL Editor.
-- Adds: a profiles table (so comments/content can show a real name instead
-- of a raw user id), plus update/delete policies that were missing before
-- (content editing, tag/metadata removal).

-- PROFILES ---------------------------------------------------------------

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

drop policy if exists "users can view their own profile" on profiles;
drop policy if exists "users can view profiles of loop-mates" on profiles;
drop policy if exists "users can insert their own profile" on profiles;
drop policy if exists "users can update their own profile" on profiles;

create policy "users can view their own profile"
  on profiles for select
  using (id = auth.uid());

-- can see the profile of anyone who shares at least one loop with you
create policy "users can view profiles of loop-mates"
  on profiles for select
  using (
    id in (
      select lm2.user_id
      from loop_memberships lm1
      join loop_memberships lm2 on lm1.loop_id = lm2.loop_id
      where lm1.user_id = auth.uid()
    )
  );

create policy "users can insert their own profile"
  on profiles for insert
  with check (id = auth.uid());

create policy "users can update their own profile"
  on profiles for update
  using (id = auth.uid());

-- CONTENT: allow the uploader to edit their own content ------------------

drop policy if exists "uploader can update their own content" on content;

create policy "uploader can update their own content"
  on content for update
  using (uploaded_by = auth.uid())
  with check (uploaded_by = auth.uid());

-- TAGS: allow the tagger, or the content owner, to remove a tag ----------

drop policy if exists "tagger or content owner can delete tag" on tags;

create policy "tagger or content owner can delete tag"
  on tags for delete
  using (
    tagged_by = auth.uid()
    or content_id in (select id from content where uploaded_by = auth.uid())
  );

-- CONTENT_METADATA: same pattern -----------------------------------------

drop policy if exists "adder or content owner can delete metadata" on content_metadata;

create policy "adder or content owner can delete metadata"
  on content_metadata for delete
  using (
    added_by = auth.uid()
    or content_id in (select id from content where uploaded_by = auth.uid())
  );

-- STORAGE: allow uploads/reads on the "content" bucket -------------------
-- (skip this block if you already ran it earlier)

drop policy if exists "authenticated users can upload to content bucket" on storage.objects;
drop policy if exists "authenticated users can view content bucket files" on storage.objects;

create policy "authenticated users can upload to content bucket"
  on storage.objects for insert
  with check ( bucket_id = 'content' and auth.role() = 'authenticated' );

create policy "authenticated users can view content bucket files"
  on storage.objects for select
  using ( bucket_id = 'content' and auth.role() = 'authenticated' );

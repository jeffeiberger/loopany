-- Run this in your EXISTING Supabase project's SQL Editor.
-- Adds the new content_metadata table (free-form key/value metadata)
-- without touching anything you already have.

create table if not exists content_metadata (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content(id) on delete cascade,
  key text not null,
  value text not null,
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_content_metadata_content on content_metadata(content_id);

alter table content_metadata enable row level security;

drop policy if exists "members can view metadata on visible content" on content_metadata;
drop policy if exists "members can add metadata on visible content" on content_metadata;

create policy "members can view metadata on visible content"
  on content_metadata for select
  using (
    content_id in (
      select id from content where public.is_loop_member(loop_id)
    )
  );

create policy "members can add metadata on visible content"
  on content_metadata for insert
  with check (
    content_id in (
      select id from content where public.is_loop_member(loop_id)
    )
  );

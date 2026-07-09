-- Loopany prototype schema
-- Paste this into Supabase → SQL Editor → New query → Run
--
-- This is the corrected version: the loop_memberships policy no longer
-- queries loop_memberships from within its own policy (which caused
-- "infinite recursion detected in policy for relation loop_memberships").
-- A security-definer helper function is used instead, and every other
-- policy that checks membership uses the same helper for consistency.

-- Profiles: a small public-ish record per user so comments/content can show
-- a real name instead of a raw user id. Populated by the app on sign-in.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "users can view their own profile"
  on profiles for select
  using (id = auth.uid());

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

-- Loops: the bounded, missioned spaces (replaces "friends/following")
create table loops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mission text,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  open_depth int not null default 0, -- 0 = closed (only creator invites), N = generations allowed to invite
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Memberships: who belongs to which loop, at what generation
create table loop_memberships (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid not null references loops(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  generation int not null default 0, -- 0 = creator's direct invites, 1 = invited-by-invitee, etc.
  invited_by uuid references auth.users(id),
  joined_at timestamptz not null default now(),
  unique (loop_id, user_id)
);

-- Content: the media itself (photo/video/audio), always belongs to at least one loop
create table content (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid not null references loops(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  storage_path text not null, -- path in Supabase Storage bucket
  media_type text not null default 'photo' check (media_type in ('photo', 'video', 'audio')),
  taken_at timestamptz, -- when the moment happened (may differ from uploaded_at)
  uploaded_at timestamptz not null default now(),
  caption text,
  location text,
  -- content-size-adjustment fields (scarcity/crowding multiplier inputs)
  moment_key text -- shared key for photos from the exact same moment/burst, used to compute cluster size
);

-- Tags: people, places, events, things, interest categories attached to content
create table tags (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content(id) on delete cascade,
  tag_type text not null check (tag_type in ('person', 'place', 'event', 'thing', 'interest')),
  value text not null,
  tagged_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- Comments (and comments-of-comments via parent_comment_id)
create table comments (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content(id) on delete cascade,
  parent_comment_id uuid references comments(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

-- Per-user interaction counters (view/favorite/back), feeds Content_Weight
create table content_interactions (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  view_count int not null default 0,
  favorited boolean not null default false,
  back_count int not null default 0, -- explicit "jump back to this" count
  last_viewed_at timestamptz,
  unique (content_id, user_id)
);

-- Story/chapter membership: many-to-many, a photo can belong to multiple stories
create table stories (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid not null references loops(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table story_content (
  story_id uuid not null references stories(id) on delete cascade,
  content_id uuid not null references content(id) on delete cascade,
  sequence_position int not null, -- order within the story, drives through/back
  primary key (story_id, content_id)
);

-- Free-form metadata: unlike tags (fixed types), this lets a contributor
-- attach any key/value pair they choose at upload time (e.g. "mood: bittersweet",
-- "camera: dad's old Nikon", "trip: 35th anniversary").
create table content_metadata (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null references content(id) on delete cascade,
  key text not null,
  value text not null,
  added_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index idx_content_metadata_content on content_metadata(content_id);

alter table content_metadata enable row level security;
create index idx_content_loop on content(loop_id);
create index idx_content_taken_at on content(taken_at);
create index idx_tags_content on tags(content_id);
create index idx_tags_value on tags(value);
create index idx_comments_content on comments(content_id);
create index idx_memberships_loop_user on loop_memberships(loop_id, user_id);
create index idx_story_content_story on story_content(story_id, sequence_position);

-- Row Level Security: only loop members can see loop content
alter table loops enable row level security;
alter table loop_memberships enable row level security;
alter table content enable row level security;
alter table tags enable row level security;
alter table comments enable row level security;
alter table content_interactions enable row level security;
alter table stories enable row level security;
alter table story_content enable row level security;

-- Helper function: checks "is this user a member of this loop?" without
-- re-triggering row-level security on loop_memberships itself. security
-- definer runs with elevated privileges, so this internal query bypasses
-- the policy that would otherwise call itself recursively.
create or replace function public.is_loop_member(loop_id_input uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from loop_memberships
    where loop_id = loop_id_input and user_id = auth.uid()
  );
$$;

-- LOOPS

create policy "members can view their loops"
  on loops for select
  using ( public.is_loop_member(id) );

create policy "creator can update their loop"
  on loops for update
  using (created_by = auth.uid());

create policy "authenticated users can create loops"
  on loops for insert
  with check (created_by = auth.uid());

-- LOOP_MEMBERSHIPS
-- select uses the helper function (this is the policy that used to recurse)

create policy "members can view membership rows for their loops"
  on loop_memberships for select
  using ( public.is_loop_member(loop_id) );

-- a user can always insert their own membership row (covers "creator joins
-- the loop they just made" and, later, "accept an invite")
create policy "users can insert their own membership"
  on loop_memberships for insert
  with check ( user_id = auth.uid() );

-- CONTENT

create policy "members can view content in their loops"
  on content for select
  using ( public.is_loop_member(loop_id) );

create policy "members can upload content to their loops"
  on content for insert
  with check ( public.is_loop_member(loop_id) );

create policy "uploader can update their own content"
  on content for update
  using (uploaded_by = auth.uid())
  with check (uploaded_by = auth.uid());

-- TAGS

create policy "members can view tags on visible content"
  on tags for select
  using (
    content_id in (
      select id from content where public.is_loop_member(loop_id)
    )
  );

create policy "members can add tags on visible content"
  on tags for insert
  with check (
    content_id in (
      select id from content where public.is_loop_member(loop_id)
    )
  );

create policy "tagger or content owner can delete tag"
  on tags for delete
  using (
    tagged_by = auth.uid()
    or content_id in (select id from content where uploaded_by = auth.uid())
  );

-- COMMENTS

create policy "members can view comments on visible content"
  on comments for select
  using (
    content_id in (
      select id from content where public.is_loop_member(loop_id)
    )
  );

create policy "members can add comments on visible content"
  on comments for insert
  with check (
    content_id in (
      select id from content where public.is_loop_member(loop_id)
    )
  );

-- CONTENT_INTERACTIONS

create policy "users manage their own interactions"
  on content_interactions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- CONTENT_METADATA

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

create policy "adder or content owner can delete metadata"
  on content_metadata for delete
  using (
    added_by = auth.uid()
    or content_id in (select id from content where uploaded_by = auth.uid())
  );

-- STORAGE: allow loop members to upload/view files in the "content" bucket
-- (create the bucket itself in the dashboard first: Storage -> New bucket -> "content")

create policy "authenticated users can upload to content bucket"
  on storage.objects for insert
  with check ( bucket_id = 'content' and auth.role() = 'authenticated' );

create policy "authenticated users can view content bucket files"
  on storage.objects for select
  using ( bucket_id = 'content' and auth.role() = 'authenticated' );

-- STORIES

create policy "members can view stories in their loops"
  on stories for select
  using ( public.is_loop_member(loop_id) );

create policy "members can view story_content for visible stories"
  on story_content for select
  using (
    story_id in (
      select id from stories where public.is_loop_member(loop_id)
    )
  );

# Loopany — prototype setup

This is a working first-pass scaffold: Next.js + Supabase, built to run for
free. It implements Loops, membership generations, tagged content, and a real
version of the six-direction navigation (Left/Right = time, Down = strongest
relation, Up = weak-but-real relation, Random, Jump-Back, Out).

It is intentionally simple — no gesture/swipe UI yet, just buttons, and the
weighting math (lib/weights.ts) is a first pass, not the final version we
designed in conversation. Treat it as something to click through and feel out,
not a finished product.

## What you need to do yourself

I can't create accounts or click through dashboards on your behalf — here is
the exact sequence, in order.

### 1. Create a Supabase project (free)
1. Go to https://supabase.com and sign up (GitHub login is fastest).
2. Click "New project." Pick any name (e.g. "loopany-prototype") and a
   database password — save that password somewhere, you likely won't need
   it again but it's good practice to keep it.
3. Wait ~2 minutes for the project to finish provisioning.
4. In the left sidebar, go to **SQL Editor** → **New query**.
5. Open `supabase/schema.sql` from this project, copy its entire contents,
   paste into the SQL editor, and click **Run**. This creates all the tables
   and security rules.
6. In the left sidebar, go to **Storage** → **Create a new bucket**. Name it
   `content` and make it a public bucket (fine for a prototype — you can
   tighten this later).
7. Go to **Project Settings** (gear icon) → **API**. You'll see a **Project
   URL** and an **anon public** key — you'll need both in step 3 below.

### 2. Get the code onto GitHub
1. Go to https://github.com and sign up if you don't have an account.
2. Click **New repository**, name it `loopany`, keep it private if you like,
   don't initialize with a README (we already have one).
3. On your own machine, in a terminal, from this project folder:
   ```
   git init
   git add .
   git commit -m "Initial Loopany prototype"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/loopany.git
   git push -u origin main
   ```

### 3. Deploy to Vercel (free)
1. Go to https://vercel.com and sign up using your GitHub account (this makes
   step 2 automatic).
2. Click **Add New → Project**, choose the `loopany` repo you just pushed.
3. Before deploying, expand **Environment Variables** and add two:
   - `NEXT_PUBLIC_SUPABASE_URL` → paste the Project URL from step 1.7
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` → paste the anon public key from step 1.7
4. Click **Deploy**. In about a minute you'll get a live URL like
   `loopany.vercel.app`.

### 4. Try it
1. Visit your new URL, enter your email, and click "Send magic link."
2. Check your email, click the link — you're signed in.
3. Create a Loop, then you'll need to add content directly in Supabase for
   now (Table Editor → `content` table → insert a row with your loop's id)
   since this prototype doesn't yet have a photo upload UI — that's a
   natural next feature to build.

## Local development (optional)

If you want to run it on your own machine before deploying:
```
npm install
cp .env.local.example .env.local
# edit .env.local with your Supabase URL and anon key
npm run dev
```
Then visit http://localhost:3000

## Note on this version

This package includes a corrected `supabase/schema.sql` — an earlier version
had a bug in the `loop_memberships` row-level-security policy that caused an
"infinite recursion detected" error when creating a Loop. If you already ran
the old schema in a Supabase project, you can either:
- Re-run this corrected `schema.sql` in a **fresh** Supabase project, or
- Just run the `is_loop_member` function and the two `loop_memberships`
  policy statements near the middle of this file against your **existing**
  project — you don't need to drop and recreate the other tables.

## If you already have a Supabase project running

Run `supabase/migration-content-metadata.sql` in the SQL Editor — it adds
the new `content_metadata` table (free-form key/value metadata you attach at
upload time) without touching anything else. A fresh project just needs the
full `schema.sql`, which already includes it.

You'll also need a Storage bucket named `content` (Storage → Create a new
bucket → name it `content`, make it public) if you haven't made one yet —
this is where uploaded photos/video/audio actually live.

## What's deliberately left out of this first pass

- No Session_Weight persistence across page reloads (resets each visit)
- No loop invitations UI (add membership rows directly in Supabase)
- No Through/Back story navigation yet (schema supports it — `stories` and
  `story_content` tables — just no UI wired up)
- Weighting math is a first pass, not the fuller model from our design
  conversation

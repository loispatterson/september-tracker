CREATE TABLE IF NOT EXISTS users (
  id         text PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  emoji      text NOT NULL DEFAULT '💪',
  age_band   text NOT NULL,              -- 'under30' | '30-44' | '45-59' | '60plus'
  goal       text NOT NULL,              -- 'strength' | 'cardio' | 'mobility' | 'general'
  created_at timestamptz DEFAULT now()
);

-- personal PIN: proves you're you when claiming your name on a new device
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_fails int NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_locked_until timestamptz;

-- Fitness profile. Private: only its owner ever reads it, via /api/me.
-- goals is a list because "lose weight AND get stronger" is one person.
-- note is free text for the things a tick-box can't hold: a bad knee, no gym.
ALTER TABLE users ADD COLUMN IF NOT EXISTS goals text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fitness text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS note text;

CREATE TABLE IF NOT EXISTS entries (
  user_id    text NOT NULL REFERENCES users(id),
  date       text NOT NULL,              -- 'YYYY-MM-DD', lexically comparable
  kind       text NOT NULL,              -- 'exercise' | 'fun'
  done       boolean NOT NULL,
  activity   text,
  note       text,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, date, kind)
);

-- how long it actually took. 30 is the challenge, but people do more.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS minutes int;
-- optional, and only meaningful for some activities: runs, walks, rides, swims
ALTER TABLE entries ADD COLUMN IF NOT EXISTS distance_km numeric(6,2);
-- how it felt: easy | good | hard. A hard day earns an easier one after it.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS feeling text;

CREATE TABLE IF NOT EXISTS fun_ideas (
  id         serial PRIMARY KEY,
  text       text NOT NULL,
  added_by   text REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- one row per signed-in device, whose token every write must present
CREATE TABLE IF NOT EXISTS sessions (
  token      text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

-- one photo per fun day. Bytes live here and never in the board payload.
-- id is regenerated on every upload, including replacements, so a cached
-- photo URL can never go stale and responses can be cached forever.
CREATE TABLE IF NOT EXISTS entry_photos (
  id         text PRIMARY KEY,
  user_id    text NOT NULL,
  date       text NOT NULL,
  kind       text NOT NULL DEFAULT 'fun' CHECK (kind = 'fun'),
  mime       text NOT NULL DEFAULT 'image/jpeg',
  width      int,
  height     int,
  bytes      int,
  data       bytea NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, date, kind),
  FOREIGN KEY (user_id, date, kind) REFERENCES entries (user_id, date, kind) ON DELETE CASCADE
);

-- Likes on fun-day photos. One row per person per photo, so the primary key
-- is the whole vote and liking twice is impossible without a counter to keep
-- in step.
--
-- The cascade is deliberate. entry_photos.id is regenerated on every upload,
-- replacements included, so swapping your photo for a different one drops its
-- likes: they were for the old picture, and silently carrying them over would
-- credit the new one with applause it never got.
CREATE TABLE IF NOT EXISTS photo_likes (
  photo_id   text NOT NULL REFERENCES entry_photos(id) ON DELETE CASCADE,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (photo_id, user_id)
);

-- The board counts likes per photo on every refresh, which is the only read
-- that isn't by primary key.
CREATE INDEX IF NOT EXISTS photo_likes_photo ON photo_likes (photo_id);

-- Comments on a fun day. Attached to the entry rather than to the photo,
-- unlike likes: a fun day is worth talking about whether or not it has a
-- picture, and a comment on "cooked for six" should survive the photo being
-- swapped. That is the opposite of the photo_likes cascade and it is
-- deliberate — likes are about the image, comments are about the day.
CREATE TABLE IF NOT EXISTS entry_comments (
  id         serial PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- who wrote it
  owner_id   text NOT NULL,                                          -- whose day
  date       text NOT NULL,
  kind       text NOT NULL DEFAULT 'fun',
  body       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  FOREIGN KEY (owner_id, date, kind) REFERENCES entries (user_id, date, kind) ON DELETE CASCADE
);

-- The board asks for counts per day across everyone, and the thread view asks
-- for one day's comments in order.
CREATE INDEX IF NOT EXISTS entry_comments_target
  ON entry_comments (owner_id, date, kind, id);

-- ===========================================================================
-- Cairn: the charity-challenge deployment (CHALLENGE=movember)
--
-- On that deployment, kind 'fun' IS the daily moustache photo. The shape is
-- identical -- one row per person per date, with a photo, likes and comments --
-- so the name was left alone rather than threading a second kind through every
-- query and every CHECK constraint three weeks before a fixed launch date.
-- js/challenge.js holds it as cfg.dayKind, so the rename, if it is ever worth
-- doing, is that one value plus, on the Movember database only, where every
-- fun row is a moustache row:
--     UPDATE entries SET kind = 'mo' WHERE kind = 'fun'
-- ===========================================================================

-- Who this account is for. 'participant' grows a moustache and logs days.
-- 'viewer' is a sponsor or friend who watches, comments and chips in, and
-- never logs anything. Default 'participant' so every account that existed
-- before viewers did keeps working untouched.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'participant';

-- A participant's own fundraising page. The app never touches money: this is
-- a link out, and the only thing stored is the address.
ALTER TABLE users ADD COLUMN IF NOT EXISTS fundraising_url text;

-- Daily reminders. Opt-out rather than opt-in, because agreeing to
-- notifications in the browser is already the explicit opt-in.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify boolean NOT NULL DEFAULT true;

-- Which participant a viewer arrived to cheer on, when they came from a
-- shared link. Null for anyone who just turned up.
ALTER TABLE users ADD COLUMN IF NOT EXISTS cheering text;

-- One row per person per day they opened the app.
--
-- This is the retention measurement. "Days posted" says whether someone kept
-- up the habit. This says whether they kept opening the thing, which is the
-- separate question and the one that says whether the app is doing any work.
-- Written from /api/board, once per person per day, ON CONFLICT DO NOTHING, so
-- the 60-second poll costs one insert a day rather than 1440.
CREATE TABLE IF NOT EXISTS user_days (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date    text NOT NULL,
  PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS user_days_date ON user_days (date);

-- What a participant's public fundraising page said, and when.
--
-- Kept as a series rather than as a column on users, because the question is
-- not "how much did they raise" but "did donations keep arriving through the
-- month, or only in the first 48 hours". A single total cannot answer that.
-- source is 'self' when they typed it in, 'recorded' when it was read off
-- their page by scripts/record-totals.mjs.
CREATE TABLE IF NOT EXISTS fundraising_snapshots (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       text NOT NULL,
  amount     numeric(10,2) NOT NULL,
  currency   text NOT NULL DEFAULT 'GBP',
  source     text NOT NULL DEFAULT 'recorded',
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

-- One row per browser that has agreed to notifications. The endpoint is the
-- primary key because that is what the push service issues and what identifies
-- the subscription, so the same person on a phone and a laptop is two rows.
-- failures counts consecutive rejections so a dead subscription gets pruned
-- rather than retried every evening for a month.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz DEFAULT now(),
  last_ok_at timestamptz,
  failures   int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions (user_id);

-- When this person agreed that the board is public.
--
-- The board has no passcode on the Movember deployment: sponsors have to be
-- able to look without an account, so names, faces and photos are visible to
-- anyone with the link. That is a deliberate design decision and it is exactly
-- why agreement has to be explicit rather than assumed from signing up.
--
-- Stored as a timestamp rather than a boolean so there is a record of when,
-- which is what makes it evidence rather than a tick. Null for the accounts
-- that existed before this column, and for the friends' board, where the
-- question does not arise in the same way.
ALTER TABLE users ADD COLUMN IF NOT EXISTS consented_at timestamptz;

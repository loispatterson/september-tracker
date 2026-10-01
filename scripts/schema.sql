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

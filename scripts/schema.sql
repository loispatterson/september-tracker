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

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

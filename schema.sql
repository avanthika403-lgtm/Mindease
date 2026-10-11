CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mood_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  screen_minutes TEXT NOT NULL DEFAULT '',
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diary_entries (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  situation TEXT NOT NULL,
  thought TEXT NOT NULL,
  feeling TEXT NOT NULL,
  evidence_for TEXT NOT NULL DEFAULT '',
  evidence_against TEXT NOT NULL DEFAULT '',
  balanced_thought TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS mood_entries_user_date_idx ON mood_entries (user_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS diary_entries_user_created_idx ON diary_entries (user_id, created_at DESC);
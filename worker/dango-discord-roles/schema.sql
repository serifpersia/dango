CREATE TABLE IF NOT EXISTS members (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  total_seconds INTEGER DEFAULT 0,
  current_rank TEXT DEFAULT 'F-Rank',
  current_dere TEXT DEFAULT 'Tsundere',
  genres TEXT,
  top_genre TEXT,
  binge_factor INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS genres TEXT;

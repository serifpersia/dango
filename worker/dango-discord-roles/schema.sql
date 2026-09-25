CREATE TABLE IF NOT EXISTS members (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  total_seconds INTEGER DEFAULT 0,
  total_episodes INTEGER DEFAULT 0,
  total_anime INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  completion_rate INTEGER DEFAULT 0,
  current_rank TEXT DEFAULT 'F-Rank',
  current_dere TEXT DEFAULT 'Tsundere',
  genres TEXT,
  top_genre TEXT,
  binge_factor INTEGER DEFAULT 0,
  taste TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Migration for databases created before v2. D1/SQLite does not support
-- ADD COLUMN IF NOT EXISTS, so run each line separately with --command and
-- ignore "duplicate column name" errors (that just means it already exists):
-- ALTER TABLE members ADD COLUMN genres TEXT;
-- ALTER TABLE members ADD COLUMN total_episodes INTEGER DEFAULT 0;
-- ALTER TABLE members ADD COLUMN total_anime INTEGER DEFAULT 0;
-- ALTER TABLE members ADD COLUMN completed_count INTEGER DEFAULT 0;
-- ALTER TABLE members ADD COLUMN completion_rate INTEGER DEFAULT 0;
-- v3 (/recommend): taste profile JSON pushed by Dango on sync
-- ALTER TABLE members ADD COLUMN taste TEXT;
-- Rotation log so /recommend doesn't repeat itself within 30 days
CREATE TABLE IF NOT EXISTS rec_log (
  discord_id TEXT NOT NULL,
  anilist_id INTEGER NOT NULL,
  recommended_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (discord_id, anilist_id)
);

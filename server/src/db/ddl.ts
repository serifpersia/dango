import logger from '../logger.js'
import { DatabaseWrapper } from '../db.js'
import { TempShowIdsRepository } from '../repositories/temp-show-ids.repository.js'
import { malCachePruneExpired } from '../repositories/mal-cache.repository.js'

const log = logger.child({ module: 'DB' })

async function openDatabase(dbPath: string): Promise<DatabaseWrapper> {
  const db = await DatabaseWrapper.create(dbPath)
  db.configure('busyTimeout', 5000)
  db.run('PRAGMA journal_mode = WAL;')
  db.run('PRAGMA synchronous = NORMAL;')
  db.run('PRAGMA cache_size = -20000;')
  db.run('PRAGMA temp_store = MEMORY;')
  db.run('PRAGMA mmap_size = 268435456;')
  db.run('PRAGMA foreign_keys = ON;')
  return db
}

export async function initializeDatabase(dbPath: string): Promise<DatabaseWrapper> {
  try {
    const db = await openDatabase(dbPath)

    db.run(
      `CREATE TABLE IF NOT EXISTS watchlist (id TEXT NOT NULL, name TEXT, thumbnail TEXT, status TEXT, nativeName TEXT, englishName TEXT, type TEXT, PRIMARY KEY (id))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS watched_episodes (showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, watchedAt DATETIME DEFAULT CURRENT_TIMESTAMP, currentTime REAL DEFAULT 0, duration REAL DEFAULT 0, PRIMARY KEY (showId, episodeNumber))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY, showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, queue_order INTEGER NOT NULL)`
    )
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT NOT NULL, value TEXT, PRIMARY KEY (key))`)
    db.run(
      `CREATE TABLE IF NOT EXISTS shows_meta (id TEXT PRIMARY KEY, name TEXT, thumbnail TEXT, nativeName TEXT, englishName TEXT, episodeCount INTEGER, status TEXT, genres TEXT, popularityScore INTEGER, type TEXT)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS dismissed_notifications (showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, dismissedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (showId, episodeNumber))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS dismissed_info_notifications (showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, dismissedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (showId, episodeNumber))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS discovered_notifications (showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, discoveredAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (showId, episodeNumber))`
    )
    db.run(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER)`)
    db.run(`INSERT OR IGNORE INTO sync_metadata (key, value) VALUES ('db_version', 1)`)
    db.run(
      `CREATE TABLE IF NOT EXISTS legacy_id_mapping (legacyId TEXT PRIMARY KEY, numericId TEXT)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS temp_show_ids (id TEXT PRIMARY KEY, provider TEXT NOT NULL, nativeId TEXT NOT NULL, title TEXT NOT NULL, thumbnail TEXT, createdAt INTEGER NOT NULL)`
    )
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_temp_show_ids_provider_native ON temp_show_ids(provider, nativeId)`
    )

    try {
      const purged = await TempShowIdsRepository.purge(db)
      if (purged > 0) log.info({ purged }, 'Purged stale temp show ids on boot')
    } catch (e) {
      log.warn({ err: e }, 'Temp show purge on boot failed')
    }

    try {
      const pruned = malCachePruneExpired()
      if (pruned > 0) log.info({ pruned }, 'Pruned expired mal cache rows on boot')
    } catch (e) {
      log.warn({ err: e }, 'Mal cache prune on boot failed')
    }

    db.run(`CREATE INDEX IF NOT EXISTS idx_watched_episodes_showId ON watched_episodes(showId)`)
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_watched_episodes_showId_episodeNumber ON watched_episodes(showId, episodeNumber)`
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_watched_episodes_watchedAt ON watched_episodes(watchedAt)`
    )
    db.run(`CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(status)`)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_show_episode ON queue(showId, episodeNumber)`
    )
    db.run(`CREATE INDEX IF NOT EXISTS idx_queue_order ON queue(queue_order)`)

    db.run('DELETE FROM dismissed_notifications WHERE showId NOT IN (SELECT id FROM watchlist)')
    db.run(
      'DELETE FROM dismissed_info_notifications WHERE showId NOT IN (SELECT id FROM watchlist)'
    )
    db.run('DELETE FROM discovered_notifications WHERE showId NOT IN (SELECT id FROM watchlist)')
    db.run(
      'DELETE FROM legacy_id_mapping WHERE legacyId NOT IN (SELECT id FROM watchlist) AND numericId NOT IN (SELECT id FROM watchlist)'
    )

    db.run(
      'DELETE FROM dismissed_notifications WHERE EXISTS (SELECT 1 FROM watched_episodes we WHERE we.showId = dismissed_notifications.showId AND we.episodeNumber = dismissed_notifications.episodeNumber)'
    )
    db.run(
      'DELETE FROM discovered_notifications WHERE EXISTS (SELECT 1 FROM watched_episodes we WHERE we.showId = discovered_notifications.showId AND we.episodeNumber = discovered_notifications.episodeNumber)'
    )
    db.run(
      `UPDATE discovered_notifications SET discoveredAt = datetime('now') WHERE discoveredAt IS NULL`
    )

    const addCol = (tbl: string, col: string, type: string) => {
      const columns = db.all<{ name: string }>(`PRAGMA table_info(${tbl})`)
      if (!columns.some((c) => c.name === col))
        db.run(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${type}`)
    }

    addCol('watchlist', 'nativeName', 'TEXT')
    addCol('watchlist', 'englishName', 'TEXT')
    addCol('shows_meta', 'nativeName', 'TEXT')
    addCol('shows_meta', 'englishName', 'TEXT')
    addCol('shows_meta', 'episodeCount', 'INTEGER')
    addCol('shows_meta', 'status', 'TEXT')
    addCol('shows_meta', 'genres', 'TEXT')
    addCol('shows_meta', 'popularityScore', 'INTEGER')
    addCol('watchlist', 'type', 'TEXT')
    addCol('shows_meta', 'type', 'TEXT')
    addCol('shows_meta', 'anilistId', 'INTEGER')
    addCol('shows_meta', 'isAdult', 'INTEGER')
    addCol('shows_meta', 'episodeDuration', 'INTEGER')

    return db
  } catch (err) {
    log.error({ err }, 'Database opening error')
    throw err
  }
}

export async function initializeMangaDatabase(dbPath: string): Promise<DatabaseWrapper> {
  try {
    const db = await openDatabase(dbPath)

    db.run(
      `CREATE TABLE IF NOT EXISTS manga_library (id TEXT PRIMARY KEY, provider TEXT NOT NULL, mangaId TEXT NOT NULL, title TEXT, cover TEXT, status TEXT DEFAULT 'Reading', author TEXT, contentRating TEXT, lastChapterId TEXT, lastChapterNumber TEXT, lastPage INTEGER, updatedAt INTEGER, altTitle TEXT, anilistId INTEGER, anilistIdSource TEXT)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS manga_progress (mangaId TEXT NOT NULL, chapterId TEXT NOT NULL, chapterNumber TEXT, page INTEGER DEFAULT 0, pageCount INTEGER DEFAULT 0, updatedAt INTEGER, PRIMARY KEY (mangaId, chapterId))`
    )
    db.run(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER)`)
    db.run(`INSERT OR IGNORE INTO sync_metadata (key, value) VALUES ('db_version', 1)`)

    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_library_provider_manga ON manga_library(provider, mangaId)`
    )
    db.run(`CREATE INDEX IF NOT EXISTS idx_manga_library_status ON manga_library(status)`)
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_manga_progress_manga ON manga_progress(mangaId, updatedAt)`
    )

    const mangaColumns = db.all<{ name: string }>(`PRAGMA table_info(manga_library)`)
    if (!mangaColumns.some((c) => c.name === 'altTitle')) {
      db.run(`ALTER TABLE manga_library ADD COLUMN altTitle TEXT`)
    }
    if (!mangaColumns.some((c) => c.name === 'anilistId')) {
      db.run(`ALTER TABLE manga_library ADD COLUMN anilistId INTEGER`)
    }
    if (!mangaColumns.some((c) => c.name === 'anilistIdSource')) {
      db.run(`ALTER TABLE manga_library ADD COLUMN anilistIdSource TEXT`)
    }
    db.run(`CREATE INDEX IF NOT EXISTS idx_manga_library_anilist ON manga_library(anilistId)`)

    const mangaProgressColumns = db.all<{ name: string }>(`PRAGMA table_info(manga_progress)`)
    if (!mangaProgressColumns.some((c) => c.name === 'title')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN title TEXT`)
    }
    if (!mangaProgressColumns.some((c) => c.name === 'cover')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN cover TEXT`)
    }
    if (!mangaProgressColumns.some((c) => c.name === 'provider')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN provider TEXT`)
    }
    if (!mangaProgressColumns.some((c) => c.name === 'altTitle')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN altTitle TEXT`)
    }
    if (!mangaProgressColumns.some((c) => c.name === 'contentRating')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN contentRating TEXT`)
    }

    return db
  } catch (err) {
    log.error({ err }, 'Manga database opening error')
    throw err
  }
}

export async function initializeTvDatabase(dbPath: string): Promise<DatabaseWrapper> {
  try {
    const db = await openDatabase(dbPath)

    db.run(
      `CREATE TABLE IF NOT EXISTS tv_library (id TEXT PRIMARY KEY, tmdbId INTEGER NOT NULL, mediaType TEXT NOT NULL, title TEXT, poster TEXT, backdrop TEXT, year TEXT, overview TEXT, status TEXT DEFAULT 'Watching', adult INTEGER DEFAULT 0, lastSeason INTEGER, lastEpisode INTEGER, updatedAt INTEGER)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS tv_progress (mediaId TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL, currentTime REAL DEFAULT 0, duration REAL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER, PRIMARY KEY (mediaId, season, episode))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS dismissed_tv_notifications (mediaId TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL, dismissedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (mediaId, season, episode))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS dismissed_tv_info_notifications (mediaId TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL, dismissedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (mediaId, season, episode))`
    )
    db.run(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER)`)
    db.run(`INSERT OR IGNORE INTO sync_metadata (key, value) VALUES ('db_version', 1)`)

    db.run(`CREATE INDEX IF NOT EXISTS idx_tv_library_status ON tv_library(status)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_tv_library_tmdb ON tv_library(tmdbId, mediaType)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_tv_progress_media ON tv_progress(mediaId, updatedAt)`)

    const tvProgressColumns = db.all<{ name: string }>(`PRAGMA table_info(tv_progress)`)
    if (!tvProgressColumns.some((c) => c.name === 'title')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN title TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'poster')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN poster TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'backdrop')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN backdrop TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'year')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN year TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'overview')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN overview TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'tmdbId')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN tmdbId INTEGER`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'mediaType')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN mediaType TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'adult')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN adult INTEGER`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'completed')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN completed INTEGER NOT NULL DEFAULT 0`)
    }
    db.run(
      `UPDATE tv_progress SET completed = 1 WHERE completed = 0 AND duration > 0 AND currentTime >= duration * 0.8`
    )
    db.run(
      `CREATE TRIGGER IF NOT EXISTS trg_tv_progress_completed_insert
       AFTER INSERT ON tv_progress
       WHEN NEW.duration > 0 AND NEW.currentTime >= NEW.duration * 0.8
       BEGIN
         UPDATE tv_progress SET completed = 1
         WHERE mediaId = NEW.mediaId AND season = NEW.season AND episode = NEW.episode;
       END`
    )
    db.run(`DROP TRIGGER IF EXISTS trg_tv_progress_completed_update`)
    db.run(
      `CREATE TRIGGER IF NOT EXISTS trg_tv_progress_completed_update
       AFTER UPDATE OF currentTime, duration ON tv_progress
       WHEN NEW.duration > 0 AND NEW.currentTime >= NEW.duration * 0.8
       BEGIN
         UPDATE tv_progress SET completed = 1
         WHERE mediaId = NEW.mediaId AND season = NEW.season AND episode = NEW.episode;
       END`
    )
    db.run(
      `UPDATE tv_progress SET completed = 0 WHERE completed = 1 AND NOT (duration > 0 AND currentTime >= duration * 0.8)`
    )

    db.run(
      `UPDATE OR IGNORE tv_progress SET mediaId = REPLACE(mediaId, '-', ':') WHERE mediaId LIKE 'tv-%' OR mediaId LIKE 'movie-%'`
    )
    db.run(`DELETE FROM tv_progress WHERE mediaId LIKE 'tv-%' OR mediaId LIKE 'movie-%'`)

    db.run(
      `DELETE FROM dismissed_tv_notifications WHERE mediaId NOT IN (SELECT id FROM tv_library)`
    )
    db.run(
      `DELETE FROM dismissed_tv_info_notifications WHERE mediaId NOT IN (SELECT id FROM tv_library)`
    )
    db.run(`DELETE FROM dismissed_tv_notifications`)
    db.run(`DELETE FROM dismissed_tv_info_notifications`)

    return db
  } catch (err) {
    log.error({ err }, 'TV database opening error')
    throw err
  }
}

export async function initializeAsmrDatabase(dbPath: string): Promise<DatabaseWrapper> {
  try {
    const db = await openDatabase(dbPath)

    db.run(
      `CREATE TABLE IF NOT EXISTS asmr_library (id TEXT PRIMARY KEY, rjCode TEXT NOT NULL, title TEXT, thumbnail TEXT, status TEXT DEFAULT 'Listening', isAdult INTEGER DEFAULT 0, lastTrackIndex INTEGER, lastTrackLabel TEXT, lastPosition REAL, updatedAt INTEGER)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS asmr_progress (workId TEXT NOT NULL, trackIndex INTEGER NOT NULL, trackLabel TEXT, currentTime REAL DEFAULT 0, duration REAL DEFAULT 0, updatedAt INTEGER, PRIMARY KEY (workId, trackIndex))`
    )
    db.run(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER)`)
    db.run(`INSERT OR IGNORE INTO sync_metadata (key, value) VALUES ('db_version', 1)`)

    db.run(`CREATE INDEX IF NOT EXISTS idx_asmr_library_status ON asmr_library(status)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_asmr_library_rjcode ON asmr_library(rjCode)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_asmr_progress_work ON asmr_progress(workId, updatedAt)`)

    const asmrProgressColumns = db.all<{ name: string }>(`PRAGMA table_info(asmr_progress)`)
    if (!asmrProgressColumns.some((c) => c.name === 'title')) {
      db.run(`ALTER TABLE asmr_progress ADD COLUMN title TEXT`)
    }
    if (!asmrProgressColumns.some((c) => c.name === 'thumbnail')) {
      db.run(`ALTER TABLE asmr_progress ADD COLUMN thumbnail TEXT`)
    }
    if (!asmrProgressColumns.some((c) => c.name === 'rjCode')) {
      db.run(`ALTER TABLE asmr_progress ADD COLUMN rjCode TEXT`)
    }
    if (!asmrProgressColumns.some((c) => c.name === 'isAdult')) {
      db.run(`ALTER TABLE asmr_progress ADD COLUMN isAdult INTEGER`)
    }

    return db
  } catch (err) {
    log.error({ err }, 'ASMR database opening error')
    throw err
  }
}

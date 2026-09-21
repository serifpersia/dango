import { DatabaseWrapper } from '../db.js'
import { dbGet, dbRun } from '../utils/db-utils.js'

const LIBRARY_TABLES = [
  'watchlist',
  'watched_episodes',
  'queue',
  'shows_meta',
  'dismissed_notifications',
  'discovered_notifications',
  'legacy_id_mapping',
  'temp_show_ids',
] as const

export type LibraryCounts = Record<(typeof LIBRARY_TABLES)[number], number>

const MANGA_LIBRARY_TABLES = ['manga_library', 'manga_progress'] as const

export type MangaLibraryCounts = Record<(typeof MANGA_LIBRARY_TABLES)[number], number>

const TV_LIBRARY_TABLES = ['tv_library', 'tv_progress'] as const

export type TvLibraryCounts = Record<(typeof TV_LIBRARY_TABLES)[number], number>

export const LibraryRepository = {
  countAll: (db: DatabaseWrapper): LibraryCounts => {
    const counts = {} as LibraryCounts
    for (const table of LIBRARY_TABLES) {
      try {
        counts[table] =
          dbGet<{ rows: number }>(db, `SELECT COUNT(*) AS rows FROM "${table}"`)?.rows ?? 0
      } catch {
        counts[table] = 0
      }
    }
    return counts
  },

  clearAll: (db: DatabaseWrapper): void => {
    for (const table of LIBRARY_TABLES) {
      try {
        dbRun(db, `DELETE FROM "${table}"`)
      } catch {
        // ignore
      }
    }
  },

  countManga: (db: DatabaseWrapper): MangaLibraryCounts => {
    const counts = {} as MangaLibraryCounts
    for (const table of MANGA_LIBRARY_TABLES) {
      try {
        counts[table] =
          dbGet<{ rows: number }>(db, `SELECT COUNT(*) AS rows FROM "${table}"`)?.rows ?? 0
      } catch {
        counts[table] = 0
      }
    }
    return counts
  },

  clearManga: (db: DatabaseWrapper): void => {
    for (const table of MANGA_LIBRARY_TABLES) {
      try {
        dbRun(db, `DELETE FROM "${table}"`)
      } catch {
        // ignore
      }
    }
  },

  countTv: (db: DatabaseWrapper): TvLibraryCounts => {
    const counts = {} as TvLibraryCounts
    for (const table of TV_LIBRARY_TABLES) {
      try {
        counts[table] =
          dbGet<{ rows: number }>(db, `SELECT COUNT(*) AS rows FROM "${table}"`)?.rows ?? 0
      } catch {
        counts[table] = 0
      }
    }
    return counts
  },

  clearTv: (db: DatabaseWrapper): void => {
    for (const table of TV_LIBRARY_TABLES) {
      try {
        dbRun(db, `DELETE FROM "${table}"`)
      } catch {
        // ignore
      }
    }
  },
}

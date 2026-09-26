import { sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'

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

const ASMR_LIBRARY_TABLES = ['asmr_library', 'asmr_progress'] as const

export type AsmrLibraryCounts = Record<(typeof ASMR_LIBRARY_TABLES)[number], number>

async function countTables<T extends string>(
  db: DatabaseWrapper,
  tables: readonly T[]
): Promise<Record<T, number>> {
  const counts = {} as Record<T, number>
  for (const table of tables) {
    try {
      const rows = await getDrizzle(db).all<{ rows: number }>(
        sql`SELECT COUNT(*) AS rows FROM ${sql.raw(`"${table}"`)}`
      )
      counts[table] = rows[0]?.rows ?? 0
    } catch {
      counts[table] = 0
    }
  }
  return counts
}

async function clearTables(db: DatabaseWrapper, tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    try {
      await getDrizzle(db).run(sql`DELETE FROM ${sql.raw(`"${table}"`)}`)
    } catch {
      // ignore
    }
  }
}

export const LibraryRepository = {
  countAll: (db: DatabaseWrapper): Promise<LibraryCounts> => countTables(db, LIBRARY_TABLES),

  clearAll: (db: DatabaseWrapper): Promise<void> => clearTables(db, LIBRARY_TABLES),

  countManga: (db: DatabaseWrapper): Promise<MangaLibraryCounts> =>
    countTables(db, MANGA_LIBRARY_TABLES),

  clearManga: (db: DatabaseWrapper): Promise<void> => clearTables(db, MANGA_LIBRARY_TABLES),

  countTv: (db: DatabaseWrapper): Promise<TvLibraryCounts> => countTables(db, TV_LIBRARY_TABLES),

  clearTv: (db: DatabaseWrapper): Promise<void> => clearTables(db, TV_LIBRARY_TABLES),

  countAsmr: (db: DatabaseWrapper): Promise<AsmrLibraryCounts> =>
    countTables(db, ASMR_LIBRARY_TABLES),

  clearAsmr: (db: DatabaseWrapper): Promise<void> => clearTables(db, ASMR_LIBRARY_TABLES),
}

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

export function makeLibraryRepo<Row>(table: 'tv_library' | 'manga_library' | 'asmr_library') {
  const t = sql.raw(`"${table}"`)
  return {
    getById: async (db: DatabaseWrapper, id: string) => {
      const rows = await getDrizzle(db).all<Row>(sql`SELECT * FROM ${t} WHERE id = ${id}`)
      return rows[0]
    },

    getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
      const q = sql`SELECT * FROM ${t}`
      if (status && status !== 'All') {
        q.append(sql` WHERE status = ${status}`)
      }
      q.append(sql` ORDER BY updatedAt DESC`)
      if (limit !== undefined && offset !== undefined) {
        q.append(sql` LIMIT ${limit} OFFSET ${offset}`)
      }
      return getDrizzle(db).all<Row>(q)
    },

    getCount: async (db: DatabaseWrapper, status?: string) => {
      if (status && status !== 'All') {
        const rows = await getDrizzle(db).all<{ total: number }>(
          sql`SELECT COUNT(*) as total FROM ${t} WHERE status = ${status}`
        )
        return rows[0]?.total || 0
      }
      const rows = await getDrizzle(db).all<{ total: number }>(
        sql`SELECT COUNT(*) as total FROM ${t}`
      )
      return rows[0]?.total || 0
    },

    getIds: async (db: DatabaseWrapper) => {
      const rows = await getDrizzle(db).all<{ id: string }>(sql`SELECT id FROM ${t}`)
      return rows.map((r) => r.id)
    },

    updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
      getDrizzle(db).run(sql`
      UPDATE ${t} SET status = ${status}, updatedAt = strftime('%s', 'now') WHERE id = ${id}`),

    updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => {
      if (ids.length === 0) return Promise.resolve()
      return getDrizzle(db).run(sql`
      UPDATE ${t} SET status = ${status}, updatedAt = strftime('%s', 'now') WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
    },

    delete: (db: DatabaseWrapper, id: string) =>
      getDrizzle(db).run(sql`DELETE FROM ${t} WHERE id = ${id}`),

    deleteMany: (db: DatabaseWrapper, ids: string[]) => {
      if (ids.length === 0) return Promise.resolve()
      return getDrizzle(db).run(
        sql`DELETE FROM ${t} WHERE id IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `
        )})`
      )
    },
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

import { eq, inArray, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { watchlist } from '../db/schema-anime.js'

export interface WatchlistRow {
  id: string
  name: string
  thumbnail: string
  status: string
  nativeName?: string
  englishName?: string
  type?: string
  [key: string]: unknown
}

export const WatchlistRepository = {
  getById: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<WatchlistRow>(
      sql`SELECT * FROM watchlist WHERE id = ${id}`
    )
    return rows[0]
  },

  exists: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<{ inWatchlist: number }>(
      sql`SELECT EXISTS(SELECT 1 FROM watchlist WHERE id = ${id}) as inWatchlist`
    )
    return !!(rows[0] && rows[0].inWatchlist)
  },

  getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
    const q = sql`SELECT * FROM watchlist`
    if (status && status !== 'All') {
      q.append(sql` WHERE status = ${status}`)
    }
    q.append(sql` ORDER BY rowid DESC`)
    if (limit !== undefined && offset !== undefined) {
      q.append(sql` LIMIT ${limit} OFFSET ${offset}`)
    }
    return getDrizzle(db).all<WatchlistRow>(q)
  },

  getCount: async (db: DatabaseWrapper, status?: string) => {
    const q = sql`SELECT COUNT(*) as total FROM watchlist`
    if (status && status !== 'All') {
      q.append(sql` WHERE status = ${status}`)
    }
    const rows = await getDrizzle(db).all<{ total: number }>(q)
    return rows[0]?.total || 0
  },

  upsert: (
    db: DatabaseWrapper,
    data: {
      id: string
      name: string
      thumbnail: string
      status: string
      nativeName: string
      englishName: string
      type: string
    }
  ) =>
    getDrizzle(db).run(sql`
      INSERT INTO watchlist (id, name, thumbnail, status, nativeName, englishName, type) VALUES (${data.id}, ${data.name}, ${data.thumbnail}, ${data.status}, ${data.nativeName}, ${data.englishName}, ${data.type})
      ON CONFLICT(id) DO UPDATE SET
         name = COALESCE(NULLIF(EXCLUDED.name, ''), watchlist.name),
         thumbnail = COALESCE(NULLIF(EXCLUDED.thumbnail, ''), watchlist.thumbnail),
         status = COALESCE(NULLIF(EXCLUDED.status, ''), watchlist.status),
         nativeName = COALESCE(NULLIF(EXCLUDED.nativeName, ''), watchlist.nativeName),
         englishName = COALESCE(NULLIF(EXCLUDED.englishName, ''), watchlist.englishName),
         type = COALESCE(NULLIF(EXCLUDED.type, ''), watchlist.type)`),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    getDrizzle(db).update(watchlist).set({ status }).where(eq(watchlist.id, id)),

  updateThumbnail: (db: DatabaseWrapper, id: string, thumbnail: string) => {
    if (!thumbnail || thumbnail.trim() === '') return Promise.resolve()
    return getDrizzle(db).update(watchlist).set({ thumbnail }).where(eq(watchlist.id, id))
  },

  delete: (db: DatabaseWrapper, id: string) =>
    getDrizzle(db).delete(watchlist).where(eq(watchlist.id, id)),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).delete(watchlist).where(inArray(watchlist.id, ids))
  },

  updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).update(watchlist).set({ status }).where(inArray(watchlist.id, ids))
  },

  getWatchingShows: (db: DatabaseWrapper) =>
    getDrizzle(db).all<{
      id: string
      name: string
      thumbnail: string
      nativeName?: string
      englishName?: string
    }>(
      sql`SELECT id, name, thumbnail, nativeName, englishName FROM watchlist WHERE status = 'Watching'`
    ),

  getMissingThumbnails: (db: DatabaseWrapper) =>
    getDrizzle(db).all<{ id: string; name: string }>(
      sql`SELECT id, name FROM watchlist WHERE thumbnail IS NULL OR TRIM(thumbnail) = ''`
    ),
}

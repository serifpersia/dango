import { DatabaseWrapper } from '../db'
import { dbAll, dbGet, dbRun } from '../utils/db-utils'

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
  getById: (db: DatabaseWrapper, id: string) =>
    dbGet<WatchlistRow>(db, 'SELECT * FROM watchlist WHERE id = ?', [id]),

  exists: (db: DatabaseWrapper, id: string) => {
    const row = dbGet<{ inWatchlist: number }>(
      db,
      'SELECT EXISTS(SELECT 1 FROM watchlist WHERE id = ?) as inWatchlist',
      [id]
    )
    return !!(row && row.inWatchlist)
  },

  getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
    let query = 'SELECT * FROM watchlist'
    const params: (string | number)[] = []

    if (status && status !== 'All') {
      query += ' WHERE status = ?'
      params.push(status)
    }

    query += ' ORDER BY rowid DESC'

    if (limit !== undefined && offset !== undefined) {
      query += ' LIMIT ? OFFSET ?'
      params.push(limit, offset)
    }

    return dbAll<WatchlistRow>(db, query, params)
  },

  getCount: (db: DatabaseWrapper, status?: string) => {
    let query = 'SELECT COUNT(*) as total FROM watchlist'
    const params: string[] = []

    if (status && status !== 'All') {
      query += ' WHERE status = ?'
      params.push(status)
    }

    const row = dbGet<{ total: number }>(db, query, params)
    return row?.total || 0
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
    dbRun(
      db,
      'INSERT OR REPLACE INTO watchlist (id, name, thumbnail, status, nativeName, englishName, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        data.id,
        data.name,
        data.thumbnail,
        data.status,
        data.nativeName,
        data.englishName,
        data.type,
      ]
    ),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    dbRun(db, 'UPDATE watchlist SET status = ? WHERE id = ?', [status, id]),

  updateType: (db: DatabaseWrapper, id: string, type: string) =>
    dbRun(db, 'UPDATE watchlist SET type = ? WHERE id = ?', [type, id]),

  updateThumbnail: (db: DatabaseWrapper, id: string, thumbnail: string) =>
    dbRun(db, 'UPDATE watchlist SET thumbnail = ? WHERE id = ?', [thumbnail, id]),

  delete: (db: DatabaseWrapper, id: string) =>
    dbRun(db, 'DELETE FROM watchlist WHERE id = ?', [id]),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return Promise.resolve()
    const placeholders = ids.map(() => '?').join(', ')
    return dbRun(db, `DELETE FROM watchlist WHERE id IN (${placeholders})`, ids)
  },

  updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => {
    if (ids.length === 0) return Promise.resolve()
    const placeholders = ids.map(() => '?').join(', ')
    return dbRun(db, `UPDATE watchlist SET status = ? WHERE id IN (${placeholders})`, [
      status,
      ...ids,
    ])
  },

  getWatchingShows: (db: DatabaseWrapper) =>
    dbAll<{
      id: string
      name: string
      thumbnail: string
      nativeName?: string
      englishName?: string
    }>(
      db,
      "SELECT id, name, thumbnail, nativeName, englishName FROM watchlist WHERE status = 'Watching'"
    ),
}

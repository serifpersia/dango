import { DatabaseWrapper } from '../db.js'
import { dbAll, dbGet, dbRun } from '../utils/db-utils.js'

export type TvStatus = 'Watching' | 'Completed' | 'On-Hold' | 'Dropped' | 'Planned'

export const TV_STATUSES: TvStatus[] = ['Watching', 'Completed', 'On-Hold', 'Dropped', 'Planned']

export interface TvLibraryRow {
  id: string
  tmdbId: number
  mediaType: string
  title: string
  poster: string
  backdrop?: string | null
  year?: string | null
  overview?: string | null
  status: string
  adult?: number | null
  lastSeason?: number | null
  lastEpisode?: number | null
  updatedAt?: number | null
  [key: string]: unknown
}

export interface TvProgressRow {
  mediaId: string
  season: number
  episode: number
  currentTime: number
  duration: number
  updatedAt: number
}

export function buildTvId(mediaType: string, tmdbId: number | string): string {
  const t = String(mediaType).toLowerCase() === 'movie' ? 'movie' : 'tv'
  return `${t}:${tmdbId}`
}

export const TvLibraryRepository = {
  getById: (db: DatabaseWrapper, id: string) =>
    dbGet<TvLibraryRow>(db, 'SELECT * FROM tv_library WHERE id = ?', [id]),

  exists: (db: DatabaseWrapper, id: string) => {
    const row = dbGet<{ inLibrary: number }>(
      db,
      'SELECT EXISTS(SELECT 1 FROM tv_library WHERE id = ?) as inLibrary',
      [id]
    )
    return !!(row && row.inLibrary)
  },

  getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
    let query = 'SELECT * FROM tv_library'
    const params: (string | number)[] = []

    if (status && status !== 'All') {
      query += ' WHERE status = ?'
      params.push(status)
    }

    query += ' ORDER BY updatedAt DESC'

    if (limit !== undefined && offset !== undefined) {
      query += ' LIMIT ? OFFSET ?'
      params.push(limit, offset)
    }

    return dbAll<TvLibraryRow>(db, query, params)
  },

  getCount: (db: DatabaseWrapper, status?: string) => {
    let query = 'SELECT COUNT(*) as total FROM tv_library'
    const params: string[] = []

    if (status && status !== 'All') {
      query += ' WHERE status = ?'
      params.push(status)
    }

    const row = dbGet<{ total: number }>(db, query, params)
    return row?.total || 0
  },

  getIds: (db: DatabaseWrapper) =>
    dbAll<{ id: string }>(db, 'SELECT id FROM tv_library').map((r) => r.id),

  upsert: (
    db: DatabaseWrapper,
    data: {
      id: string
      tmdbId: number
      mediaType: string
      title: string
      poster: string
      backdrop?: string
      year?: string
      overview?: string
      status: string
      adult?: boolean
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO tv_library (id, tmdbId, mediaType, title, poster, backdrop, year, overview, status, adult, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(id) DO UPDATE SET
          tmdbId = EXCLUDED.tmdbId,
          mediaType = EXCLUDED.mediaType,
          title = COALESCE(NULLIF(EXCLUDED.title, ''), tv_library.title),
          poster = COALESCE(NULLIF(EXCLUDED.poster, ''), tv_library.poster),
          backdrop = COALESCE(NULLIF(EXCLUDED.backdrop, ''), tv_library.backdrop),
          year = COALESCE(NULLIF(EXCLUDED.year, ''), tv_library.year),
          overview = COALESCE(NULLIF(EXCLUDED.overview, ''), tv_library.overview),
          status = COALESCE(NULLIF(EXCLUDED.status, ''), tv_library.status),
          adult = COALESCE(EXCLUDED.adult, tv_library.adult),
          updatedAt = strftime('%s', 'now')`,
      [
        data.id,
        data.tmdbId,
        data.mediaType,
        data.title,
        data.poster,
        data.backdrop || null,
        data.year || null,
        data.overview || null,
        data.status,
        data.adult ? 1 : 0,
      ]
    ),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    dbRun(db, "UPDATE tv_library SET status = ?, updatedAt = strftime('%s', 'now') WHERE id = ?", [
      status,
      id,
    ]),

  touchProgress: (db: DatabaseWrapper, id: string, progress: { season: number; episode: number }) =>
    dbRun(
      db,
      `UPDATE tv_library SET lastSeason = ?, lastEpisode = ?, updatedAt = strftime('%s', 'now') WHERE id = ?`,
      [progress.season, progress.episode, id]
    ),

  delete: (db: DatabaseWrapper, id: string) =>
    dbRun(db, 'DELETE FROM tv_library WHERE id = ?', [id]),
}

export const TvProgressRepository = {
  getByMedia: (db: DatabaseWrapper, mediaId: string) =>
    dbAll<TvProgressRow>(
      db,
      'SELECT mediaId, season, episode, currentTime, duration, updatedAt FROM tv_progress WHERE mediaId = ? ORDER BY updatedAt DESC',
      [mediaId]
    ),

  getEpisode: (db: DatabaseWrapper, mediaId: string, season: number, episode: number) =>
    dbGet<TvProgressRow>(
      db,
      'SELECT mediaId, season, episode, currentTime, duration, updatedAt FROM tv_progress WHERE mediaId = ? AND season = ? AND episode = ?',
      [mediaId, season, episode]
    ),

  getLatest: (db: DatabaseWrapper, mediaId: string) =>
    dbGet<TvProgressRow>(
      db,
      'SELECT mediaId, season, episode, currentTime, duration, updatedAt FROM tv_progress WHERE mediaId = ? ORDER BY updatedAt DESC LIMIT 1',
      [mediaId]
    ),

  upsert: (
    db: DatabaseWrapper,
    data: {
      mediaId: string
      season: number
      episode: number
      currentTime: number
      duration: number
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO tv_progress (mediaId, season, episode, currentTime, duration, updatedAt)
       VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(mediaId, season, episode) DO UPDATE SET
          currentTime = EXCLUDED.currentTime,
          duration = EXCLUDED.duration,
          updatedAt = strftime('%s', 'now')`,
      [data.mediaId, data.season, data.episode, data.currentTime, data.duration]
    ),

  deleteByMedia: (db: DatabaseWrapper, mediaId: string) =>
    dbRun(db, 'DELETE FROM tv_progress WHERE mediaId = ?', [mediaId]),

  deleteEpisode: (db: DatabaseWrapper, mediaId: string, season: number, episode: number) =>
    dbRun(db, 'DELETE FROM tv_progress WHERE mediaId = ? AND season = ? AND episode = ?', [
      mediaId,
      season,
      episode,
    ]),

  getContinueWatching: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    return dbAll<TvLibraryRow & Partial<TvProgressRow>>(
      db,
      `SELECT l.*, p.season, p.episode, p.currentTime, p.duration, p.updatedAt as progressAt
       FROM tv_library l
       LEFT JOIN (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY mediaId ORDER BY updatedAt DESC) as rn
         FROM tv_progress
       ) p ON p.mediaId = l.id AND p.rn = 1
       WHERE l.status = 'Watching'
       ORDER BY COALESCE(p.updatedAt, l.updatedAt) DESC
       ${limitClause}`
    )
  },
}

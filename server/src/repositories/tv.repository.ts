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
  title?: string | null
  poster?: string | null
  backdrop?: string | null
  year?: string | null
  overview?: string | null
  tmdbId?: number | null
  mediaType?: string | null
  adult?: number | null
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
      title?: string | null
      poster?: string | null
      backdrop?: string | null
      year?: string | null
      overview?: string | null
      tmdbId?: number | null
      mediaType?: string | null
      adult?: number | null
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO tv_progress (mediaId, season, episode, currentTime, duration, title, poster, backdrop, year, overview, tmdbId, mediaType, adult, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(mediaId, season, episode) DO UPDATE SET
          currentTime = EXCLUDED.currentTime,
          duration = EXCLUDED.duration,
          title = COALESCE(EXCLUDED.title, tv_progress.title),
          poster = COALESCE(EXCLUDED.poster, tv_progress.poster),
          backdrop = COALESCE(EXCLUDED.backdrop, tv_progress.backdrop),
          year = COALESCE(EXCLUDED.year, tv_progress.year),
          overview = COALESCE(EXCLUDED.overview, tv_progress.overview),
          tmdbId = COALESCE(EXCLUDED.tmdbId, tv_progress.tmdbId),
          mediaType = COALESCE(EXCLUDED.mediaType, tv_progress.mediaType),
          adult = COALESCE(EXCLUDED.adult, tv_progress.adult),
          updatedAt = strftime('%s', 'now')`,
      [
        data.mediaId,
        data.season,
        data.episode,
        data.currentTime,
        data.duration,
        data.title ?? null,
        data.poster ?? null,
        data.backdrop ?? null,
        data.year ?? null,
        data.overview ?? null,
        data.tmdbId ?? null,
        data.mediaType ?? null,
        data.adult ?? null,
      ]
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
      `SELECT p.mediaId as id,
              COALESCE(l.tmdbId, p.tmdbId, CAST(SUBSTR(p.mediaId, INSTR(p.mediaId, '-') + 1) AS INTEGER)) as tmdbId,
              COALESCE(l.mediaType, p.mediaType, SUBSTR(p.mediaId, 1, INSTR(p.mediaId, '-') - 1)) as mediaType,
              COALESCE(l.title, p.title) as title, COALESCE(l.poster, p.poster) as poster, COALESCE(l.backdrop, p.backdrop) as backdrop,
              COALESCE(l.year, p.year) as year, COALESCE(l.overview, p.overview) as overview,
              l.status as watchlistStatus, COALESCE(l.adult, p.adult) as adult,
              p.season, p.episode, p.currentTime, p.duration, p.updatedAt as progressAt
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY mediaId ORDER BY updatedAt DESC) as rn
         FROM tv_progress
       ) p
       LEFT JOIN tv_library l ON p.mediaId = l.id
       WHERE p.rn = 1
         AND (l.status IS NULL OR l.status = 'Watching')
       ORDER BY p.updatedAt DESC
       ${limitClause}`
    )
  },
}

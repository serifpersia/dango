import { eq, inArray, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { tvLibrary, tvProgress } from '../db/schema-tv.js'

export const TV_STATUSES: string[] = ['Watching', 'Completed', 'On-Hold', 'Dropped', 'Planned']

export type TvStatus = (typeof TV_STATUSES)[number]

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
  completed: number
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

export function normalizeTvMediaId(raw: unknown): string {
  const s = String(raw ?? '').trim()
  const m = /^(movie|tv)[:-](\d+)$/i.exec(s)
  if (m) return `${m[1].toLowerCase()}:${m[2]}`
  return s
}

export const TvLibraryRepository = {
  getById: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<TvLibraryRow>(
      sql`SELECT * FROM tv_library WHERE id = ${id}`
    )
    return rows[0]
  },

  getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
    const q = sql`SELECT * FROM tv_library`
    if (status && status !== 'All') {
      q.append(sql` WHERE status = ${status}`)
    }
    q.append(sql` ORDER BY updatedAt DESC`)
    if (limit !== undefined && offset !== undefined) {
      q.append(sql` LIMIT ${limit} OFFSET ${offset}`)
    }
    return getDrizzle(db).all<TvLibraryRow>(q)
  },

  getCount: async (db: DatabaseWrapper, status?: string) => {
    if (status && status !== 'All') {
      const rows = await getDrizzle(db).all<{ total: number }>(
        sql`SELECT COUNT(*) as total FROM tv_library WHERE status = ${status}`
      )
      return rows[0]?.total || 0
    }
    const rows = await getDrizzle(db).all<{ total: number }>(
      sql`SELECT COUNT(*) as total FROM tv_library`
    )
    return rows[0]?.total || 0
  },

  getIds: async (db: DatabaseWrapper) => {
    const rows = await getDrizzle(db).all<{ id: string }>(sql`SELECT id FROM tv_library`)
    return rows.map((r) => r.id)
  },

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
    getDrizzle(db).run(sql`
      INSERT INTO tv_library (id, tmdbId, mediaType, title, poster, backdrop, year, overview, status, adult, updatedAt)
      VALUES (${data.id}, ${data.tmdbId}, ${data.mediaType}, ${data.title}, ${data.poster}, ${data.backdrop || null}, ${data.year || null}, ${data.overview || null}, ${data.status}, ${data.adult ? 1 : 0}, strftime('%s', 'now'))
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
         updatedAt = strftime('%s', 'now')`),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    getDrizzle(db).run(sql`
      UPDATE tv_library SET status = ${status}, updatedAt = strftime('%s', 'now') WHERE id = ${id}`),

  updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).run(sql`
      UPDATE tv_library SET status = ${status}, updatedAt = strftime('%s', 'now') WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  },

  touchProgress: (db: DatabaseWrapper, id: string, progress: { season: number; episode: number }) =>
    getDrizzle(db).run(sql`
      UPDATE tv_library SET lastSeason = ${progress.season}, lastEpisode = ${progress.episode}, updatedAt = strftime('%s', 'now') WHERE id = ${id}`),

  delete: (db: DatabaseWrapper, id: string) =>
    getDrizzle(db).delete(tvLibrary).where(eq(tvLibrary.id, id)),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).delete(tvLibrary).where(inArray(tvLibrary.id, ids))
  },
}

export const TvProgressRepository = {
  getByMedia: (db: DatabaseWrapper, mediaId: string) =>
    getDrizzle(db).all<TvProgressRow>(sql`
      SELECT mediaId, season, episode, currentTime, duration, completed, updatedAt FROM tv_progress WHERE mediaId = ${mediaId} ORDER BY updatedAt DESC, rowid DESC`),

  getEpisode: async (db: DatabaseWrapper, mediaId: string, season: number, episode: number) => {
    const rows = await getDrizzle(db).all<TvProgressRow>(sql`
      SELECT mediaId, season, episode, currentTime, duration, completed, updatedAt FROM tv_progress WHERE mediaId = ${mediaId} AND season = ${season} AND episode = ${episode}`)
    return rows[0]
  },

  getLatest: async (db: DatabaseWrapper, mediaId: string) => {
    const rows = await getDrizzle(db).all<TvProgressRow>(sql`
      SELECT mediaId, season, episode, currentTime, duration, completed, updatedAt FROM tv_progress WHERE mediaId = ${mediaId} ORDER BY updatedAt DESC, rowid DESC LIMIT 1`)
    return rows[0]
  },

  upsert: (
    db: DatabaseWrapper,
    data: {
      mediaId: string
      season: number
      episode: number
      currentTime: number
      duration: number
      completed: number
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
    getDrizzle(db).run(sql`
      INSERT INTO tv_progress (mediaId, season, episode, currentTime, duration, completed, title, poster, backdrop, year, overview, tmdbId, mediaType, adult, updatedAt)
      VALUES (${data.mediaId}, ${data.season}, ${data.episode}, ${data.currentTime}, ${data.duration}, ${data.completed}, ${data.title ?? null}, ${data.poster ?? null}, ${data.backdrop ?? null}, ${data.year ?? null}, ${data.overview ?? null}, ${data.tmdbId ?? null}, ${data.mediaType ?? null}, ${data.adult ?? null}, strftime('%s', 'now'))
      ON CONFLICT(mediaId, season, episode) DO UPDATE SET
         currentTime = EXCLUDED.currentTime,
         duration = EXCLUDED.duration,
         completed = EXCLUDED.completed,
         title = COALESCE(EXCLUDED.title, tv_progress.title),
         poster = COALESCE(EXCLUDED.poster, tv_progress.poster),
         backdrop = COALESCE(EXCLUDED.backdrop, tv_progress.backdrop),
         year = COALESCE(EXCLUDED.year, tv_progress.year),
         overview = COALESCE(EXCLUDED.overview, tv_progress.overview),
         tmdbId = COALESCE(EXCLUDED.tmdbId, tv_progress.tmdbId),
         mediaType = COALESCE(EXCLUDED.mediaType, tv_progress.mediaType),
         adult = COALESCE(EXCLUDED.adult, tv_progress.adult),
         updatedAt = strftime('%s', 'now')`),

  deleteByMedia: (db: DatabaseWrapper, mediaId: string) =>
    getDrizzle(db).delete(tvProgress).where(eq(tvProgress.mediaId, mediaId)),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).delete(tvProgress).where(inArray(tvProgress.mediaId, ids))
  },

  deleteEpisode: (db: DatabaseWrapper, mediaId: string, season: number, episode: number) =>
    getDrizzle(db).run(sql`
      DELETE FROM tv_progress WHERE mediaId = ${mediaId} AND season = ${season} AND episode = ${episode}`),

  getContinueWatching: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    return getDrizzle(db).all<TvLibraryRow & Partial<TvProgressRow>>(sql`
      SELECT p.mediaId as id,
             COALESCE(l.tmdbId, p.tmdbId, CAST(SUBSTR(REPLACE(p.mediaId, '-', ':'), INSTR(REPLACE(p.mediaId, '-', ':'), ':') + 1) AS INTEGER)) as tmdbId,
             COALESCE(l.mediaType, p.mediaType, SUBSTR(REPLACE(p.mediaId, '-', ':'), 1, INSTR(REPLACE(p.mediaId, '-', ':'), ':') - 1)) as mediaType,
             COALESCE(l.title, p.title) as title, COALESCE(l.poster, p.poster) as poster, COALESCE(l.backdrop, p.backdrop) as backdrop,
             COALESCE(l.year, p.year) as year, COALESCE(l.overview, p.overview) as overview,
             l.status as watchlistStatus, COALESCE(l.adult, p.adult) as adult,
             p.season, p.episode, p.currentTime, p.duration, p.completed, p.updatedAt as progressAt
      FROM (
        SELECT *, rowid AS progressRowid, ROW_NUMBER() OVER (PARTITION BY mediaId ORDER BY updatedAt DESC, rowid DESC) as rn
        FROM tv_progress
      ) p
      LEFT JOIN tv_library l ON p.mediaId = l.id
      WHERE p.rn = 1
        AND (l.status IS NULL OR l.status = 'Watching')
      ORDER BY p.updatedAt DESC, p.progressRowid DESC
      ${sql.raw(limitClause)}`)
  },
}

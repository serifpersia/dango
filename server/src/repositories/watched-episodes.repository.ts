import { eq, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { watchedEpisodes } from '../db/schema-anime.js'

export interface WatchedEpisode {
  showId: string
  episodeNumber: string
  currentTime: number
  duration: number
  watchedAt: string
}

export interface ContinueWatchingResult {
  _id: string
  id: string
  name: string
  thumbnail: string
  nativeName?: string
  englishName?: string
  type?: string
  episodeCount?: number
  smType?: string
  isAdult?: number | null
  watchlistStatus?: string | null
  watchedCount: number
  episodeNumber: string
  currentTime: number
  duration: number
  watchedAt: string
}

export const WatchedEpisodesRepository = {
  getByShowAndEpisode: async (db: DatabaseWrapper, showId: string, episodeNumber: string) => {
    const rows = await getDrizzle(db).all<{ currentTime: number; duration: number }>(sql`
      SELECT currentTime, duration FROM watched_episodes WHERE showId = ${showId} AND episodeNumber = ${episodeNumber}`)
    return rows[0]
  },

  getWatchedEpisodeNumbers: async (db: DatabaseWrapper, showId: string) => {
    const rows = await getDrizzle(db).all<{ episodeNumber: string }>(
      sql`SELECT episodeNumber FROM watched_episodes WHERE showId = ${showId}`
    )
    return rows.map((r) => r.episodeNumber)
  },

  getByShow: (db: DatabaseWrapper, showId: string) =>
    getDrizzle(db).all<WatchedEpisode>(sql`
      SELECT showId, episodeNumber, currentTime, duration, watchedAt FROM watched_episodes WHERE showId = ${showId} ORDER BY CAST(episodeNumber AS REAL) ASC`),

  getLatestResumeProgress: async (db: DatabaseWrapper, showId: string) => {
    const rows = await getDrizzle(db).all<WatchedEpisode>(sql`
      SELECT showId, episodeNumber, currentTime, duration, watchedAt
      FROM watched_episodes
      WHERE showId = ${showId} AND currentTime > 5 AND (duration <= 0 OR currentTime < duration * 0.8)
      ORDER BY watchedAt DESC
      LIMIT 1`)
    return rows[0]
  },

  upsert: (
    db: DatabaseWrapper,
    data: {
      showId: string
      episodeNumber: string
      currentTime: number
      duration: number
    }
  ) =>
    getDrizzle(db)
      .insert(watchedEpisodes)
      .values({
        showId: data.showId,
        episodeNumber: data.episodeNumber,
        watchedAt: sql`CURRENT_TIMESTAMP`,
        currentTime: data.currentTime,
        duration: data.duration,
      })
      .onConflictDoUpdate({
        target: [watchedEpisodes.showId, watchedEpisodes.episodeNumber],
        set: {
          watchedAt: sql`CURRENT_TIMESTAMP`,
          currentTime: data.currentTime,
          duration: data.duration,
        },
      }),

  insertIfMissing: (
    db: DatabaseWrapper,
    data: {
      showId: string
      episodeNumber: string
      watchedAt?: string
    }
  ) =>
    getDrizzle(db)
      .insert(watchedEpisodes)
      .values({
        showId: data.showId,
        episodeNumber: data.episodeNumber,
        watchedAt: data.watchedAt ? sql`${data.watchedAt}` : sql`CURRENT_TIMESTAMP`,
        currentTime: 0,
        duration: 0,
      })
      .onConflictDoNothing(),

  deleteByShow: (db: DatabaseWrapper, showId: string) =>
    getDrizzle(db).delete(watchedEpisodes).where(eq(watchedEpisodes.showId, showId)),

  getContinueWatching: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    return getDrizzle(db).all<ContinueWatchingResult>(sql`
      SELECT
        we.showId as _id,
        we.showId as id,
        COALESCE(NULLIF(w.name, ''), sm.name) as name,
        COALESCE(NULLIF(w.thumbnail, ''), NULLIF(sm.thumbnail, ''), '') as thumbnail,
        COALESCE(NULLIF(w.nativeName, ''), sm.nativeName) as nativeName,
        COALESCE(NULLIF(w.englishName, ''), sm.englishName) as englishName,
        COALESCE(NULLIF(w.type, ''), sm.type) as type,
        sm.episodeCount,
        sm.type as smType,
        sm.isAdult as isAdult,
        w.status as watchlistStatus,
        (SELECT COUNT(DISTINCT episodeNumber) FROM watched_episodes WHERE showId = we.showId) as watchedCount,
        we.episodeNumber, we.currentTime, we.duration, we.watchedAt
      FROM (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY showId ORDER BY (currentTime > 0 OR duration > 0) DESC, watchedAt DESC) as rn
        FROM watched_episodes
      ) we
      LEFT JOIN watchlist w ON we.showId = w.id
      LEFT JOIN shows_meta sm ON we.showId = sm.id
      WHERE we.rn = 1
        AND (w.status IS NULL OR w.status = 'Watching')
        AND (w.id IS NOT NULL OR sm.id IS NOT NULL)
      ORDER BY we.watchedAt DESC
      ${sql.raw(limitClause)}`)
  },

  getEpisodesForShows: (db: DatabaseWrapper, showIds: string[]) =>
    getDrizzle(db).all<WatchedEpisode>(sql`
      SELECT showId, episodeNumber, currentTime, duration, watchedAt FROM watched_episodes WHERE showId IN (${sql.join(
        showIds.map((id) => sql`${id}`),
        sql`, `
      )})`),
}

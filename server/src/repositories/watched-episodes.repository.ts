import { DatabaseWrapper } from '../db'
import { dbAll, dbGet, dbRun } from '../utils/db-utils'

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
  watchedCount: number
  episodeNumber: string
  currentTime: number
  duration: number
  watchedAt: string
}

export const WatchedEpisodesRepository = {
  getByShowAndEpisode: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    dbGet<{ currentTime: number; duration: number }>(
      db,
      'SELECT currentTime, duration FROM watched_episodes WHERE showId = ? AND episodeNumber = ?',
      [showId, episodeNumber]
    ),

  getWatchedEpisodeNumbers: async (db: DatabaseWrapper, showId: string) => {
    const rows = await dbAll<{ episodeNumber: string }>(
      db,
      'SELECT episodeNumber FROM watched_episodes WHERE showId = ?',
      [showId]
    )
    return rows.map((r) => r.episodeNumber)
  },

  getByShow: (db: DatabaseWrapper, showId: string) =>
    dbAll<WatchedEpisode>(
      db,
      'SELECT showId, episodeNumber, currentTime, duration, watchedAt FROM watched_episodes WHERE showId = ? ORDER BY CAST(episodeNumber AS REAL) ASC',
      [showId]
    ),

  getLatestResumeProgress: (db: DatabaseWrapper, showId: string) =>
    dbGet<WatchedEpisode>(
      db,
      `SELECT showId, episodeNumber, currentTime, duration, watchedAt
       FROM watched_episodes
       WHERE showId = ? AND currentTime > 5 AND (duration <= 0 OR currentTime < duration * 0.8)
       ORDER BY watchedAt DESC
       LIMIT 1`,
      [showId]
    ),

  upsert: (
    db: DatabaseWrapper,
    data: {
      showId: string
      episodeNumber: string
      currentTime: number
      duration: number
    }
  ) =>
    dbRun(
      db,
      'INSERT OR REPLACE INTO watched_episodes (showId, episodeNumber, watchedAt, currentTime, duration) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)',
      [data.showId, data.episodeNumber, data.currentTime, data.duration]
    ),

  deleteByShow: (db: DatabaseWrapper, showId: string) =>
    dbRun(db, 'DELETE FROM watched_episodes WHERE showId = ?', [showId]),

  getContinueWatching: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    const query = `
      SELECT 
        we.showId as _id,
        we.showId as id,
        COALESCE(w.name, sm.name) as name,
        COALESCE(w.thumbnail, sm.thumbnail) as thumbnail,
        COALESCE(w.nativeName, sm.nativeName) as nativeName,
        COALESCE(w.englishName, sm.englishName) as englishName,
        COALESCE(w.type, sm.type) as type,
        sm.episodeCount,
        sm.type as smType,
        (SELECT COUNT(DISTINCT episodeNumber) FROM watched_episodes WHERE showId = we.showId) as watchedCount,
        we.episodeNumber, we.currentTime, we.duration, we.watchedAt
      FROM (
        SELECT *, ROW_NUMBER() OVER(PARTITION BY showId ORDER BY watchedAt DESC) as rn
        FROM watched_episodes
      ) we
      LEFT JOIN watchlist w ON we.showId = w.id
      LEFT JOIN shows_meta sm ON we.showId = sm.id
      WHERE we.rn = 1
        AND (w.status IS NULL OR w.status = 'Watching')
        AND (w.id IS NOT NULL OR sm.id IS NOT NULL)
      ORDER BY we.watchedAt DESC
      ${limitClause}
    `
    return dbAll<ContinueWatchingResult>(db, query)
  },

  getEpisodesForShows: (db: DatabaseWrapper, showIds: string[]) => {
    const placeholders = showIds.map(() => '?').join(',')
    return dbAll<WatchedEpisode>(
      db,
      `SELECT showId, episodeNumber, currentTime, duration, watchedAt FROM watched_episodes WHERE showId IN (${placeholders})`,
      showIds
    )
  },
}

import { DatabaseWrapper } from '../db.js'
import { dbAll, dbGet } from '../utils/db-utils.js'

export const InsightsRepository = {
  getCoreStats: (db: DatabaseWrapper) =>
    dbGet<unknown>(
      db,
      `SELECT
        (SELECT SUM(
          CASE WHEN we.currentTime > 0 THEN we.currentTime
               WHEN we.currentTime = 0 AND we.duration = 0 THEN
                 COALESCE(sm.episodeDuration * 60,
                   CASE UPPER(COALESCE(sm.type, ''))
                     WHEN 'MOVIE' THEN 6000
                     WHEN 'TV_SHORT' THEN 720
                     WHEN 'MUSIC' THEN 300
                     ELSE 1440 END)
               ELSE 0 END)
         FROM watched_episodes we
         LEFT JOIN shows_meta sm ON sm.id = we.showId) as totalSeconds,
        (SELECT COUNT(*) FROM watched_episodes) as totalEpisodes,
        (SELECT COUNT(DISTINCT showId) FROM watched_episodes) as totalAnime,
        (SELECT COUNT(*) FROM watchlist WHERE status = 'Completed') as completedCount,
        (SELECT COUNT(*) FROM watchlist) as totalWatchlist`
    ),

  getActivityGrid: (db: DatabaseWrapper) =>
    dbAll<unknown>(
      db,
      `SELECT date(watchedAt) as day, COUNT(*) as count FROM watched_episodes WHERE NOT (currentTime = 0 AND duration = 0) GROUP BY day`
    ),

  getHourlyDist: (db: DatabaseWrapper) =>
    dbAll<unknown>(
      db,
      `SELECT strftime('%H', watchedAt) as hour, COUNT(*) as count FROM watched_episodes WHERE NOT (currentTime = 0 AND duration = 0) GROUP BY hour`
    ),

  getSeasonality: (db: DatabaseWrapper) =>
    dbAll<unknown>(
      db,
      `SELECT strftime('%m', we.watchedAt) as month, SUM(
        CASE WHEN we.currentTime > 0 THEN we.currentTime
             WHEN we.currentTime = 0 AND we.duration = 0 THEN
               COALESCE(sm.episodeDuration * 60,
                 CASE UPPER(COALESCE(sm.type, ''))
                   WHEN 'MOVIE' THEN 6000
                   WHEN 'TV_SHORT' THEN 720
                   WHEN 'MUSIC' THEN 300
                   ELSE 1440 END)
             ELSE 0 END) as seconds
       FROM watched_episodes we
       LEFT JOIN shows_meta sm ON sm.id = we.showId
       GROUP BY month`
    ),

  getAllWatches: (db: DatabaseWrapper) =>
    dbAll<unknown>(
      db,
      `SELECT we.watchedAt, we.currentTime,
        CASE WHEN we.currentTime > 0 THEN we.currentTime
             WHEN we.currentTime = 0 AND we.duration = 0 THEN
               COALESCE(sm.episodeDuration * 60,
                 CASE UPPER(COALESCE(sm.type, ''))
                   WHEN 'MOVIE' THEN 6000
                   WHEN 'TV_SHORT' THEN 720
                   WHEN 'MUSIC' THEN 300
                   ELSE 1440 END)
             ELSE 0 END as effectiveSeconds
       FROM watched_episodes we
       LEFT JOIN shows_meta sm ON sm.id = we.showId
       ORDER BY we.watchedAt ASC`
    ),

  getWatchedShowsMeta: (db: DatabaseWrapper) =>
    dbAll<unknown>(
      db,
      `SELECT DISTINCT sm.id, sm.genres, sm.popularityScore
      FROM shows_meta sm
      JOIN watched_episodes we ON sm.id = we.showId`
    ),

  getDroppedShows: (db: DatabaseWrapper) =>
    dbAll<unknown>(
      db,
      `SELECT w.id, w.name, MAX(we.watchedAt) as lastActivity
        FROM watchlist w
        JOIN watched_episodes we ON w.id = we.showId
        WHERE w.status = 'Watching' AND NOT (we.currentTime = 0 AND we.duration = 0)
        GROUP BY w.id
        HAVING lastActivity < date('now', '-90 days')`
    ),

  getCompletionVelocities: (db: DatabaseWrapper) =>
    dbAll<unknown>(
      db,
      `SELECT
        (julianday(MAX(we.watchedAt)) - julianday(MIN(we.watchedAt))) as daysToFinish
        FROM watchlist w
        JOIN watched_episodes we ON w.id = we.showId
        WHERE w.status = 'Completed'
        GROUP BY w.id
        HAVING SUM(we.currentTime) > 0`
    ),

  getWatchedEpisodesWithMeta: (db: DatabaseWrapper) =>
    dbAll<{
      showId: string
      currentTime: number
      duration: number
      effectiveSeconds: number
      genres: string
      popularityScore: number
      name: string
      nativeName?: string
      englishName?: string
      thumbnail: string
    }>(
      db,
      `SELECT 
        we.showId,
        we.currentTime,
        we.duration,
        CASE WHEN we.currentTime > 0 THEN we.currentTime
             WHEN we.currentTime = 0 AND we.duration = 0 THEN
               COALESCE(sm.episodeDuration * 60,
                 CASE UPPER(COALESCE(sm.type, ''))
                   WHEN 'MOVIE' THEN 6000
                   WHEN 'TV_SHORT' THEN 720
                   WHEN 'MUSIC' THEN 300
                   ELSE 1440 END)
             ELSE 0 END as effectiveSeconds,
        sm.genres,
        sm.popularityScore,
        sm.name,
        sm.nativeName,
        sm.englishName,
        sm.thumbnail
      FROM watched_episodes we
      JOIN shows_meta sm ON we.showId = sm.id`
    ),

  getLibraryShowsWithGenres: (db: DatabaseWrapper) =>
    dbAll<{
      id: string
      status: string
      title: string
      genres: string
      episodesWatched: number
      popularityScore: number
    }>(
      db,
      `SELECT
        w.id,
        w.status,
        COALESCE(NULLIF(sm.englishName, ''), sm.name, w.name) as title,
        sm.genres,
        (SELECT COUNT(*) FROM watched_episodes we WHERE we.showId = w.id) as episodesWatched,
        COALESCE(sm.popularityScore, 0) as popularityScore
      FROM watchlist w
      LEFT JOIN shows_meta sm ON sm.id = w.id`
    ),

  getAllAnilistIds: (db: DatabaseWrapper) =>
    dbAll<{ anilistId: number }>(
      db,
      'SELECT anilistId FROM shows_meta WHERE anilistId IS NOT NULL'
    ),
}

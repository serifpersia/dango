import { sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { dismissedTvInfoNotifications, dismissedTvNotifications } from '../db/schema-tv.js'
import type { SeenEpisode } from '../lib/tv-notifications.js'

export interface DismissedTvEpisode {
  mediaId: string
  season: number
  episode: number
}

export const TvNotificationsRepository = {
  getProgressByMedia: (db: DatabaseWrapper, mediaId: string) =>
    getDrizzle(db).all<SeenEpisode>(
      sql`SELECT season, episode, currentTime, completed FROM tv_progress WHERE mediaId = ${mediaId}`
    ),

  getAllDismissed: (db: DatabaseWrapper) =>
    getDrizzle(db).all<DismissedTvEpisode>(
      sql`SELECT mediaId, season, episode FROM dismissed_tv_notifications`
    ),

  getAllDismissedInfo: (db: DatabaseWrapper) =>
    getDrizzle(db).all<DismissedTvEpisode>(
      sql`SELECT mediaId, season, episode FROM dismissed_tv_info_notifications`
    ),

  addDismissed: (db: DatabaseWrapper, row: DismissedTvEpisode) =>
    getDrizzle(db).insert(dismissedTvNotifications).values(row).onConflictDoNothing(),

  addDismissedInfo: (db: DatabaseWrapper, row: DismissedTvEpisode) =>
    getDrizzle(db).insert(dismissedTvInfoNotifications).values(row).onConflictDoNothing(),

  addDismissedMany: (db: DatabaseWrapper, rows: DismissedTvEpisode[]) => {
    if (rows.length === 0) return Promise.resolve()
    return getDrizzle(db).insert(dismissedTvNotifications).values(rows).onConflictDoNothing()
  },

  addDismissedInfoMany: (db: DatabaseWrapper, rows: DismissedTvEpisode[]) => {
    if (rows.length === 0) return Promise.resolve()
    return getDrizzle(db).insert(dismissedTvInfoNotifications).values(rows).onConflictDoNothing()
  },
}

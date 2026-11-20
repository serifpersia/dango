import { and, eq, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import {
  discoveredNotifications,
  dismissedInfoNotifications,
  dismissedNotifications,
} from '../db/schema-anime.js'

export const NotificationsRepository = {
  getDismissedByShow: (db: DatabaseWrapper, showId: string) =>
    getDrizzle(db).all<{ episodeNumber: string }>(
      sql`SELECT episodeNumber FROM dismissed_notifications WHERE showId = ${showId}`
    ),

  getDiscoveredByShow: (db: DatabaseWrapper, showId: string) =>
    getDrizzle(db).all<{ episodeNumber: string }>(
      sql`SELECT episodeNumber FROM discovered_notifications WHERE showId = ${showId}`
    ),

  addDiscovered: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    getDrizzle(db)
      .insert(discoveredNotifications)
      .values({ showId, episodeNumber })
      .onConflictDoNothing(),

  addDismissed: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    getDrizzle(db)
      .insert(dismissedNotifications)
      .values({ showId, episodeNumber })
      .onConflictDoNothing(),

  dismissFromDiscovered: (db: DatabaseWrapper, showId?: string) => {
    if (showId) {
      return getDrizzle(db).run(sql`
        INSERT OR IGNORE INTO dismissed_notifications (showId, episodeNumber) SELECT showId, episodeNumber FROM discovered_notifications WHERE showId = ${showId}`)
    }
    return getDrizzle(db).run(sql`
      INSERT OR IGNORE INTO dismissed_notifications (showId, episodeNumber) SELECT showId, episodeNumber FROM discovered_notifications`)
  },

  deleteByShow: (db: DatabaseWrapper, showId: string) =>
    Promise.all([
      getDrizzle(db)
        .delete(dismissedNotifications)
        .where(eq(dismissedNotifications.showId, showId)),
      getDrizzle(db)
        .delete(discoveredNotifications)
        .where(eq(discoveredNotifications.showId, showId)),
    ]),

  deleteSpecificDismissed: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    getDrizzle(db)
      .delete(dismissedNotifications)
      .where(
        and(
          eq(dismissedNotifications.showId, showId),
          eq(dismissedNotifications.episodeNumber, episodeNumber)
        )
      ),

  deleteDiscovered: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    getDrizzle(db)
      .delete(discoveredNotifications)
      .where(
        and(
          eq(discoveredNotifications.showId, showId),
          eq(discoveredNotifications.episodeNumber, episodeNumber)
        )
      ),

  deleteDismissedMany: (db: DatabaseWrapper, showId: string, episodeNumbers: string[]) => {
    if (episodeNumbers.length === 0) return Promise.resolve()
    return getDrizzle(db).run(sql`
      DELETE FROM dismissed_notifications WHERE showId = ${showId} AND episodeNumber IN (${sql.join(
        episodeNumbers.map((e) => sql`${e}`),
        sql`, `
      )})`)
  },

  deleteDismissedForAllQueued: (db: DatabaseWrapper) =>
    getDrizzle(db).run(sql`
      DELETE FROM dismissed_notifications WHERE EXISTS (
        SELECT 1 FROM queue q WHERE q.showId = dismissed_notifications.showId AND q.episodeNumber = dismissed_notifications.episodeNumber
      )`),

  clearDismissed: (db: DatabaseWrapper) => getDrizzle(db).delete(dismissedNotifications),

  getDismissedInfoByShow: (db: DatabaseWrapper, showId: string) =>
    getDrizzle(db).all<{ episodeNumber: string }>(
      sql`SELECT episodeNumber FROM dismissed_info_notifications WHERE showId = ${showId}`
    ),

  getAllDismissedInfo: (db: DatabaseWrapper) =>
    getDrizzle(db).all<{ showId: string; episodeNumber: string }>(
      sql`SELECT showId, episodeNumber FROM dismissed_info_notifications`
    ),

  addDismissedInfo: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    getDrizzle(db)
      .insert(dismissedInfoNotifications)
      .values({ showId, episodeNumber })
      .onConflictDoNothing(),

  addDismissedInfoMany: (
    db: DatabaseWrapper,
    rows: { showId: string; episodeNumber: string }[]
  ) => {
    if (rows.length === 0) return Promise.resolve()
    return getDrizzle(db).insert(dismissedInfoNotifications).values(rows).onConflictDoNothing()
  },

  clearDismissedInfo: (db: DatabaseWrapper) => getDrizzle(db).delete(dismissedInfoNotifications),

  cleanupWatchedNotifications: (db: DatabaseWrapper) =>
    Promise.all([
      getDrizzle(db).run(sql`
        DELETE FROM dismissed_notifications WHERE EXISTS (SELECT 1 FROM watched_episodes we WHERE we.showId = dismissed_notifications.showId AND we.episodeNumber = dismissed_notifications.episodeNumber)`),
      getDrizzle(db).run(sql`
        DELETE FROM discovered_notifications WHERE EXISTS (SELECT 1 FROM watched_episodes we WHERE we.showId = discovered_notifications.showId AND we.episodeNumber = discovered_notifications.episodeNumber)`),
    ]),

  hasAnyDiscovered: async (db: DatabaseWrapper) => {
    const rows = await getDrizzle(db).all<{ count: number }>(
      sql`SELECT COUNT(*) as count FROM discovered_notifications`
    )
    return (rows[0]?.count || 0) > 0
  },

  hasActiveNotifications: async (db: DatabaseWrapper) => {
    const rows = await getDrizzle(db).all<{ count: number }>(sql`
    SELECT COUNT(*) as count FROM discovered_notifications dn
    WHERE NOT EXISTS (
      SELECT 1 FROM dismissed_notifications dn2
      WHERE dn2.showId = dn.showId AND dn2.episodeNumber = dn.episodeNumber
    )
    AND NOT EXISTS (
      SELECT 1 FROM watched_episodes we
      WHERE we.showId = dn.showId AND we.episodeNumber = dn.episodeNumber
    )
    AND NOT EXISTS (
      SELECT 1 FROM queue q
      WHERE q.showId = dn.showId AND q.episodeNumber = dn.episodeNumber
    )`)
    return (rows[0]?.count || 0) > 0
  },

  getThisWeekDiscovered: (db: DatabaseWrapper) =>
    getDrizzle(db).all<{
      id: string
      name: string
      thumbnail: string
      nativeName?: string
      englishName?: string
      type?: string
      episodeNumber: string
      discoveredAt: string
    }>(sql`
      SELECT
        w.id, w.name, w.thumbnail, w.nativeName, w.englishName, w.type,
        dn.episodeNumber, dn.discoveredAt
      FROM discovered_notifications dn
      JOIN watchlist w ON dn.showId = w.id
      WHERE w.status = 'Watching'
        AND EXISTS (
          SELECT 1 FROM discovered_notifications dn_recent
          WHERE dn_recent.showId = dn.showId
            AND dn_recent.discoveredAt >= datetime('now', '-7 days')
        )
        AND CAST(dn.episodeNumber AS INTEGER) = (
          SELECT MIN(CAST(dn2.episodeNumber AS INTEGER))
          FROM discovered_notifications dn2
          WHERE dn2.showId = dn.showId
            AND NOT EXISTS (
              SELECT 1 FROM watched_episodes we2
              WHERE we2.showId = dn2.showId AND we2.episodeNumber = dn2.episodeNumber
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM watched_episodes we
          WHERE we.showId = dn.showId AND we.episodeNumber = dn.episodeNumber
        )
      ORDER BY CAST(dn.episodeNumber AS INTEGER) ASC`),
}

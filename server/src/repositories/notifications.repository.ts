import { and, eq, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { discoveredNotifications, dismissedNotifications } from '../db/schema-anime.js'

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
      )`)
    return (rows[0]?.count || 0) > 0
  },
}

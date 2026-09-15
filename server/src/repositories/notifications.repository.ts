import { DatabaseWrapper } from '../db.js'
import { dbAll, dbGet, dbRun } from '../utils/db-utils.js'

export const NotificationsRepository = {
  getDismissedByShow: (db: DatabaseWrapper, showId: string) =>
    dbAll<{ episodeNumber: string }>(
      db,
      'SELECT episodeNumber FROM dismissed_notifications WHERE showId = ?',
      [showId]
    ),

  getDiscoveredByShow: (db: DatabaseWrapper, showId: string) =>
    dbAll<{ episodeNumber: string }>(
      db,
      'SELECT episodeNumber FROM discovered_notifications WHERE showId = ?',
      [showId]
    ),

  addDiscovered: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    dbRun(
      db,
      'INSERT OR IGNORE INTO discovered_notifications (showId, episodeNumber) VALUES (?, ?)',
      [showId, episodeNumber]
    ),

  addDismissed: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    dbRun(
      db,
      'INSERT OR IGNORE INTO dismissed_notifications (showId, episodeNumber) VALUES (?, ?)',
      [showId, episodeNumber]
    ),

  dismissFromDiscovered: (db: DatabaseWrapper, showId?: string) => {
    if (showId) {
      return dbRun(
        db,
        'INSERT OR IGNORE INTO dismissed_notifications (showId, episodeNumber) SELECT showId, episodeNumber FROM discovered_notifications WHERE showId = ?',
        [showId]
      )
    } else {
      return dbRun(
        db,
        'INSERT OR IGNORE INTO dismissed_notifications (showId, episodeNumber) SELECT showId, episodeNumber FROM discovered_notifications'
      )
    }
  },

  deleteByShow: (db: DatabaseWrapper, showId: string) =>
    Promise.all([
      dbRun(db, 'DELETE FROM dismissed_notifications WHERE showId = ?', [showId]),
      dbRun(db, 'DELETE FROM discovered_notifications WHERE showId = ?', [showId]),
    ]),

  deleteSpecificDismissed: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    dbRun(db, 'DELETE FROM dismissed_notifications WHERE showId = ? AND episodeNumber = ?', [
      showId,
      episodeNumber,
    ]),

  cleanupWatchedNotifications: (db: DatabaseWrapper) =>
    Promise.all([
      dbRun(
        db,
        'DELETE FROM dismissed_notifications WHERE EXISTS (SELECT 1 FROM watched_episodes we WHERE we.showId = dismissed_notifications.showId AND we.episodeNumber = dismissed_notifications.episodeNumber)'
      ),
      dbRun(
        db,
        'DELETE FROM discovered_notifications WHERE EXISTS (SELECT 1 FROM watched_episodes we WHERE we.showId = discovered_notifications.showId AND we.episodeNumber = discovered_notifications.episodeNumber)'
      ),
    ]),

  hasAnyDiscovered: (db: DatabaseWrapper) =>
    Promise.resolve(
      dbGet<{ count: number }>(db, 'SELECT COUNT(*) as count FROM discovered_notifications')
    ).then((row) => (row?.count || 0) > 0),

  hasActiveNotifications: (db: DatabaseWrapper) =>
    Promise.resolve(
      dbGet<{ count: number }>(
        db,
        `SELECT COUNT(*) as count FROM discovered_notifications dn
         WHERE NOT EXISTS (
           SELECT 1 FROM dismissed_notifications dn2 
           WHERE dn2.showId = dn.showId AND dn2.episodeNumber = dn.episodeNumber
         )
         AND NOT EXISTS (
           SELECT 1 FROM watched_episodes we 
           WHERE we.showId = dn.showId AND we.episodeNumber = dn.episodeNumber
         )`
      )
    ).then((row) => (row?.count || 0) > 0),
}

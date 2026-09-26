import { protectedProcedure, router } from '../index.js'
import { performWriteTransactionAsync } from '../../sync.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { NotificationsRepository } from '../../repositories/notifications.repository.js'
import { getMigratedId } from '../../lib/migration.js'
import { getAdultNonWatchlistShowIds } from '../../hono/watchlist.js'
import { dbAll } from '../../utils/db-utils.js'
import { idsInput, showIdInput } from '../validation.js'

export const continueWatchingRouter = router({
  remove: protectedProcedure.input(showIdInput()).mutation(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await WatchedEpisodesRepository.deleteByShow(tx, showId)
      await NotificationsRepository.deleteByShow(tx, showId)
    })
    return { success: true }
  }),

  removeMany: protectedProcedure.input(idsInput()).mutation(async ({ ctx, input }) => {
    const ids = await Promise.all(input.ids.map((id: string) => getMigratedId(ctx.db, id)))
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      for (const id of ids) {
        await WatchedEpisodesRepository.deleteByShow(tx, id)
        await NotificationsRepository.deleteByShow(tx, id)
      }
    })

    ctx.db.scheduleSave()
    return { success: true, removed: ids.length }
  }),

  adultCount: protectedProcedure.query(async ({ ctx }) => {
    const ids = await getAdultNonWatchlistShowIds(ctx.db)
    return { count: ids.length }
  }),

  purgeAdult: protectedProcedure.mutation(async ({ ctx }) => {
    const ids = await getAdultNonWatchlistShowIds(ctx.db)
    if (ids.length > 0) {
      await performWriteTransactionAsync(ctx.db, async (tx) => {
        for (const id of ids) {
          await WatchedEpisodesRepository.deleteByShow(tx, id)
          await NotificationsRepository.deleteByShow(tx, id)
        }
      })
      ctx.db.scheduleSave()
    }
    return { success: true, removed: ids.length }
  }),

  thisWeek: protectedProcedure.query(async ({ ctx }) => {
    const rows = await dbAll<{
      id: string
      name: string
      thumbnail: string
      nativeName?: string
      englishName?: string
      type?: string
      episodeNumber: string
      discoveredAt: string
    }>(
      ctx.db,
      `SELECT
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
      ORDER BY CAST(dn.episodeNumber AS INTEGER) ASC`
    )

    return rows.map((row) => ({
      _id: row.id,
      id: row.id,
      name: row.name,
      thumbnail: row.thumbnail || '',
      nativeName: row.nativeName,
      englishName: row.englishName,
      type: row.type,
      episodeNumber: parseInt(row.episodeNumber) || row.episodeNumber,
    }))
  }),
})

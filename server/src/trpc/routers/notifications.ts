import { protectedProcedure, router } from '../index.js'
import logger from '../../logger.js'
import { performWriteTransactionAsync } from '../../sync.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { NotificationsRepository } from '../../repositories/notifications.repository.js'
import { notificationDismissInput, type Schema } from '../validation.js'

interface EpisodeNotification {
  showId: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  episodeNumber: string
  id: string
}

type ClearAllInput = { showId?: string } | undefined

type ClearAllOutput = { showId?: string }

function clearAllInput(): Schema<ClearAllInput, ClearAllOutput> {
  return {
    '~standard': {
      version: 1,
      vendor: 'dango',
      types: undefined as unknown as { input: ClearAllInput; output: ClearAllOutput },
      validate(value: unknown) {
        try {
          if (value === undefined || value === null) return { value: {} }
          if (typeof value !== 'object' || value === null) throw new Error('Expected an object')
          const showId = (value as Record<string, unknown>).showId
          if (showId === undefined || showId === null) return { value: {} }
          if (typeof showId !== 'string' || showId.length === 0)
            throw new Error('showId must be a string')
          return { value: { showId } }
        } catch (err) {
          return { issues: [{ message: err instanceof Error ? err.message : 'Invalid input' }] }
        }
      },
    },
  }
}

export const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const watchingShows = await WatchlistRepository.getWatchingShows(ctx.db)

    const notifications: EpisodeNotification[] = []

    for (const show of watchingShows) {
      try {
        const [watchedEps, dismissedEps, discoveredEps] = await Promise.all([
          WatchedEpisodesRepository.getWatchedEpisodeNumbers(ctx.db, show.id),
          NotificationsRepository.getDismissedByShow(ctx.db, show.id),
          NotificationsRepository.getDiscoveredByShow(ctx.db, show.id),
        ])

        const watchedSet = new Set(watchedEps.map((e) => e.toString()))
        const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

        for (const discovered of discoveredEps) {
          if (
            !watchedSet.has(discovered.episodeNumber) &&
            !dismissedSet.has(discovered.episodeNumber)
          ) {
            notifications.push({
              showId: show.id,
              name: show.name,
              nativeName: show.nativeName,
              englishName: show.englishName,
              thumbnail: show.thumbnail,
              episodeNumber: discovered.episodeNumber,
              id: `${show.id}-${discovered.episodeNumber}`,
            })
          }
        }
      } catch (e) {
        logger.error({ err: e, showId: show.id }, 'Failed to get notifications for show')
      }
    }

    return notifications.sort((a, b) => parseFloat(b.episodeNumber) - parseFloat(a.episodeNumber))
  }),

  dismiss: protectedProcedure.input(notificationDismissInput()).mutation(async ({ ctx, input }) => {
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await NotificationsRepository.addDismissed(tx, input.showId, input.episodeNumber)
    })
    return { success: true }
  }),

  clearAll: protectedProcedure.input(clearAllInput()).mutation(async ({ ctx, input }) => {
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await NotificationsRepository.dismissFromDiscovered(tx, input.showId)
    })
    return { success: true }
  }),
})

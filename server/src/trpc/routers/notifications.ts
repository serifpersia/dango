import { protectedProcedure, router } from '../index.js'
import logger from '../../logger.js'
import type { DatabaseWrapper } from '../../db.js'
import { performWriteTransactionAsync } from '../../db/transaction.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { NotificationsRepository } from '../../repositories/notifications.repository.js'
import { QueueRepository } from '../../repositories/queue.repository.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { getAniScheduleShows } from '../../lib/anischedule.js'
import { notificationDismissInput, defineSchema, reqObj, reqStr } from '../validation.js'

interface EpisodeNotification {
  showId: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  episodeNumber: string
  latestEpisodeNumber: string
  pendingCount: number
  id: string
}

interface InfoNotification {
  showId: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  episodeNumber: string
  airingAt: number
  id: string
}

type ClearAllInput = { showId?: string } | undefined

type ClearAllOutput = { showId?: string }

const clearAllInput = () =>
  defineSchema<ClearAllInput, ClearAllOutput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    if (obj.showId === undefined || obj.showId === null) return {}
    return { showId: reqStr(obj, 'showId') }
  })

async function buildInfoNotifications(db: DatabaseWrapper): Promise<InfoNotification[]> {
  const watchingShows = await WatchlistRepository.getWatchingShows(db)
  if (watchingShows.length === 0) return []

  const anilistIds = await ShowsMetaRepository.getAnilistIdMap(
    db,
    watchingShows.map((s) => s.id)
  )
  const byAnilistId = new Map<number, (typeof watchingShows)[number]>()
  for (const show of watchingShows) {
    const anilistId = anilistIds.get(show.id) ?? (/^\d+$/.test(show.id) ? parseInt(show.id) : null)
    if (anilistId) byAnilistId.set(anilistId, show)
  }
  if (byAnilistId.size === 0) return []

  let scheduleShows
  try {
    scheduleShows = await getAniScheduleShows()
  } catch (e) {
    logger.warn({ err: e }, 'Info notifications: AniSchedule unavailable')
    return []
  }

  const dismissedRows = await NotificationsRepository.getAllDismissedInfo(db)
  const dismissed = new Set(dismissedRows.map((r) => `${r.showId}:${r.episodeNumber}`))
  const now = Math.floor(Date.now() / 1000)
  const notifications: InfoNotification[] = []

  for (const scheduleShow of scheduleShows) {
    const show = byAnilistId.get(scheduleShow.id)
    if (!show) continue

    let next: { episode: number; airingAt: number } | null = null
    for (const node of scheduleShow.airingSchedule?.nodes ?? []) {
      if (node.airingAt <= now) continue
      if (!next || node.airingAt < next.airingAt) next = node
    }
    if (!next) continue

    const episodeNumber = String(next.episode)
    if (dismissed.has(`${show.id}:${episodeNumber}`)) continue

    notifications.push({
      showId: show.id,
      name: show.name || scheduleShow.title?.romaji || 'Unknown',
      nativeName: show.nativeName ?? scheduleShow.title?.native,
      englishName: show.englishName ?? scheduleShow.title?.english,
      thumbnail:
        show.thumbnail ||
        scheduleShow.coverImage?.extraLarge ||
        scheduleShow.coverImage?.medium ||
        '',
      episodeNumber,
      airingAt: next.airingAt,
      id: `${show.id}-info-${episodeNumber}`,
    })
  }

  return notifications.sort((a, b) => a.airingAt - b.airingAt)
}

export const notificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const watchingShows = await WatchlistRepository.getWatchingShows(ctx.db)

    const notifications: EpisodeNotification[] = []

    for (const show of watchingShows) {
      try {
        const [watchedEps, dismissedEps, discoveredEps, queuedEps] = await Promise.all([
          WatchedEpisodesRepository.getWatchedEpisodeNumbers(ctx.db, show.id),
          NotificationsRepository.getDismissedByShow(ctx.db, show.id),
          NotificationsRepository.getDiscoveredByShow(ctx.db, show.id),
          QueueRepository.getByShow(ctx.db, show.id),
        ])

        const watchedSet = new Set(watchedEps.map((e) => e.toString()))
        const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))
        const queuedSet = new Set(queuedEps.map((e) => e.episodeNumber.toString()))

        const pending = discoveredEps
          .map((d) => d.episodeNumber.toString())
          .filter((ep) => !watchedSet.has(ep) && !dismissedSet.has(ep) && !queuedSet.has(ep))
          .sort((a, b) => parseFloat(a) - parseFloat(b))

        if (pending.length > 0) {
          notifications.push({
            showId: show.id,
            name: show.name,
            nativeName: show.nativeName,
            englishName: show.englishName,
            thumbnail: show.thumbnail,
            episodeNumber: pending[0],
            latestEpisodeNumber: pending[pending.length - 1],
            pendingCount: pending.length,
            id: show.id,
          })
        }
      } catch (e) {
        logger.error({ err: e, showId: show.id }, 'Failed to get notifications for show')
      }
    }

    return notifications.sort(
      (a, b) => parseFloat(b.latestEpisodeNumber) - parseFloat(a.latestEpisodeNumber)
    )
  }),

  info: protectedProcedure.query(async ({ ctx }) => buildInfoNotifications(ctx.db)),

  dismiss: protectedProcedure.input(notificationDismissInput()).mutation(async ({ ctx, input }) => {
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await NotificationsRepository.addDismissed(tx, input.showId, input.episodeNumber)
    })
    return { success: true }
  }),

  dismissInfo: protectedProcedure
    .input(notificationDismissInput())
    .mutation(async ({ ctx, input }) => {
      await performWriteTransactionAsync(ctx.db, async (tx) => {
        await NotificationsRepository.addDismissedInfo(tx, input.showId, input.episodeNumber)
      })
      return { success: true }
    }),

  clearAll: protectedProcedure.input(clearAllInput()).mutation(async ({ ctx, input }) => {
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await NotificationsRepository.dismissFromDiscovered(tx, input.showId)
    })
    return { success: true }
  }),

  clearInfo: protectedProcedure.mutation(async ({ ctx }) => {
    const rows = await buildInfoNotifications(ctx.db)
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await NotificationsRepository.addDismissedInfoMany(
        tx,
        rows.map((r) => ({ showId: r.showId, episodeNumber: r.episodeNumber }))
      )
    })
    return { success: true }
  }),
})

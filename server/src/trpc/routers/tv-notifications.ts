import { protectedProcedure, router } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import { performTvWriteTransactionAsync } from '../../db/transaction.js'
import logger from '../../logger.js'
import { getTvMazeByTmdbId } from '../../lib/tvmaze.js'
import { summarizeTvEpisodes } from '../../lib/tv-notifications.js'
import { TvLibraryRepository } from '../../repositories/tv.repository.js'
import { TvNotificationsRepository } from '../../repositories/tv-notifications.repository.js'
import { badRequest } from '../errors.js'
import { defineSchema, readCount, reqObj, reqStr } from '../validation.js'

interface TvReleaseNotification {
  mediaId: string
  tmdbId: number
  mediaType: string
  name: string
  thumbnail: string
  season: number
  episode: number
  latestSeason: number
  latestEpisode: number
  pendingCount: number
  latestAiredAt: number
  id: string
}

interface TvInfoNotification {
  mediaId: string
  tmdbId: number
  mediaType: string
  name: string
  thumbnail: string
  season: number
  episode: number
  airingAt: number
  id: string
}

type TvDismissInput = { mediaId: string; season: number; episode: number }

const tvDismissInput = () =>
  defineSchema<TvDismissInput, TvDismissInput>((value) => {
    const obj = reqObj(value)
    const season = readCount(obj, 'season', 0)
    const episode = readCount(obj, 'episode', 0)
    if (season < 1 || episode < 1) throw badRequest('season and episode are required')
    return { mediaId: reqStr(obj, 'mediaId'), season, episode }
  })

async function buildTvNotifications(db: DatabaseWrapper): Promise<{
  releases: TvReleaseNotification[]
  info: TvInfoNotification[]
}> {
  const shows = (await TvLibraryRepository.getAll(db, 'Watching')).filter(
    (show) => show.mediaType === 'tv'
  )
  const [dismissedRows, dismissedInfoRows] = await Promise.all([
    TvNotificationsRepository.getAllDismissed(db),
    TvNotificationsRepository.getAllDismissedInfo(db),
  ])
  const dismissed = new Set(dismissedRows.map((r) => `${r.mediaId}:${r.season}:${r.episode}`))
  const dismissedInfo = new Set(
    dismissedInfoRows.map((r) => `${r.mediaId}:${r.season}:${r.episode}`)
  )

  const releases: TvReleaseNotification[] = []
  const info: TvInfoNotification[] = []
  const nowMs = Date.now()

  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < shows.length) {
      const show = shows[nextIndex]
      nextIndex += 1
      try {
        const maze = await getTvMazeByTmdbId(show.tmdbId)
        if (!maze) continue
        const progress = await TvNotificationsRepository.getProgressByMedia(db, show.id)
        const { pending, next } = summarizeTvEpisodes(maze, progress, nowMs)
        const name = show.title || 'Unknown'
        const thumbnail = show.poster || ''

        if (pending && !dismissed.has(`${show.id}:${pending.season}:${pending.episode}`)) {
          releases.push({
            mediaId: show.id,
            tmdbId: show.tmdbId,
            mediaType: 'tv',
            name,
            thumbnail,
            season: pending.season,
            episode: pending.episode,
            latestSeason: pending.latestSeason,
            latestEpisode: pending.latestEpisode,
            pendingCount: pending.pendingCount,
            latestAiredAt: Math.floor(pending.latestAiredMs / 1000),
            id: `${show.id}-release-${pending.season}x${pending.episode}`,
          })
        }

        if (next && !dismissedInfo.has(`${show.id}:${next.season}:${next.episode}`)) {
          info.push({
            mediaId: show.id,
            tmdbId: show.tmdbId,
            mediaType: 'tv',
            name,
            thumbnail,
            season: next.season,
            episode: next.episode,
            airingAt: next.airingAt,
            id: `${show.id}-info-${next.season}x${next.episode}`,
          })
        }
      } catch (e) {
        logger.error({ err: e, mediaId: show.id }, 'Failed to build TV notification')
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, shows.length) }, () => worker()))

  releases.sort((a, b) => b.latestAiredAt - a.latestAiredAt)
  info.sort((a, b) => a.airingAt - b.airingAt)
  return { releases, info }
}

export const tvNotificationsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { releases } = await buildTvNotifications(ctx.tvDb)
    return releases
  }),

  info: protectedProcedure.query(async ({ ctx }) => {
    const { info } = await buildTvNotifications(ctx.tvDb)
    return info
  }),

  dismiss: protectedProcedure.input(tvDismissInput()).mutation(async ({ ctx, input }) => {
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvNotificationsRepository.addDismissed(tx, input)
    })
    return { success: true }
  }),

  dismissInfo: protectedProcedure.input(tvDismissInput()).mutation(async ({ ctx, input }) => {
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvNotificationsRepository.addDismissedInfo(tx, input)
    })
    return { success: true }
  }),

  clearAll: protectedProcedure.mutation(async ({ ctx }) => {
    const { releases } = await buildTvNotifications(ctx.tvDb)
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvNotificationsRepository.addDismissedMany(
        tx,
        releases.map((r) => ({
          mediaId: r.mediaId,
          season: r.season,
          episode: r.episode,
        }))
      )
    })
    return { success: true }
  }),

  clearInfo: protectedProcedure.mutation(async ({ ctx }) => {
    const { info } = await buildTvNotifications(ctx.tvDb)
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvNotificationsRepository.addDismissedInfoMany(
        tx,
        info.map((r) => ({
          mediaId: r.mediaId,
          season: r.season,
          episode: r.episode,
        }))
      )
    })
    return { success: true }
  }),
})

import { protectedProcedure, router } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { NotificationsRepository } from '../../repositories/notifications.repository.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { performWriteTransactionAsync } from '../../sync.js'
import { getMigratedId } from '../../lib/migration.js'
import { discordRPCService } from '../../discord-rpc.js'
import { dbGet } from '../../utils/db-utils.js'
import { episodeProgressInput, progressUpdateInput, showIdInput } from '../validation.js'

async function showsMetaChanged(
  db: DatabaseWrapper,
  showId: string,
  candidate: {
    name?: string
    thumbnail?: string
    nativeName?: string
    englishName?: string
    genres?: string
    popularityScore?: number
    status?: string
    episodeCount?: number
    type?: string
    anilistId?: number
    isAdult?: number | null
    episodeDuration?: number
  }
): Promise<boolean> {
  const existing = (await ShowsMetaRepository.getById(db, showId)) as {
    name?: string | null
    thumbnail?: string | null
    nativeName?: string | null
    englishName?: string | null
    genres?: string | null
    popularityScore?: number | null
    status?: string | null
    episodeCount?: number | null
    type?: string | null
    anilistId?: number | null
    isAdult?: number | null
    episodeDuration?: number | null
  } | null

  if (!existing) return true

  const differs = (incoming: unknown, stored: unknown) => {
    if (incoming === undefined || incoming === null || incoming === '') return false
    return String(incoming) !== String(stored ?? '')
  }

  return (
    differs(candidate.name, existing.name) ||
    differs(candidate.thumbnail, existing.thumbnail) ||
    differs(candidate.nativeName, existing.nativeName) ||
    differs(candidate.englishName, existing.englishName) ||
    differs(candidate.genres, existing.genres) ||
    differs(candidate.popularityScore, existing.popularityScore) ||
    differs(candidate.status, existing.status) ||
    differs(candidate.episodeCount, existing.episodeCount) ||
    differs(candidate.type, existing.type) ||
    differs(candidate.anilistId, existing.anilistId) ||
    differs(candidate.isAdult, existing.isAdult) ||
    differs(candidate.episodeDuration, existing.episodeDuration)
  )
}

export const progressRouter = router({
  getEpisode: protectedProcedure.input(episodeProgressInput()).query(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    const progress = await WatchedEpisodesRepository.getByShowAndEpisode(
      ctx.db,
      showId,
      input.episodeNumber
    )
    return progress || { currentTime: 0, duration: 0 }
  }),

  getWatchedEpisodes: protectedProcedure.input(showIdInput()).query(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    return WatchedEpisodesRepository.getWatchedEpisodeNumbers(ctx.db, showId)
  }),

  updateProgress: protectedProcedure
    .input(progressUpdateInput())
    .mutation(async ({ ctx, input }) => {
      const showId = await getMigratedId(ctx.db, input.showId)
      const { episodeNumber } = input
      const currentTime = input.currentTime || 0
      const duration = input.duration || 0

      const titlePreferenceRow = await SettingsRepository.getByKey(ctx.db, 'titlePreference')
      const titlePreference = titlePreferenceRow ? titlePreferenceRow.value : 'englishName'

      let displayName = input.showName
      if (titlePreference === 'englishName' && input.englishName) {
        displayName = input.englishName
      } else if (titlePreference === 'nativeName' && input.nativeName) {
        displayName = input.nativeName
      }

      discordRPCService.updatePresence({
        title: displayName as string,
        episode: String(episodeNumber),
        totalEpisodes: input.episodeCount ? String(input.episodeCount) : undefined,
        currentTime,
        duration,
        thumbnail: input.showThumbnail || '',
        isPlaying: input.isPlaying !== false,
        sessionId: input.sessionId,
        isAdult: input.isAdult,
      })

      const genresStr = Array.isArray(input.genres) ? JSON.stringify(input.genres) : input.genres
      const anilistId = /^\d+$/.test(showId)
        ? (dbGet<{ anilistId: number }>(
            ctx.db,
            'SELECT anilistId FROM shows_meta WHERE id = ? AND anilistId IS NOT NULL',
            [showId]
          )?.anilistId ?? parseInt(showId))
        : undefined

      const metaCandidate = {
        name: input.showName,
        thumbnail: input.showThumbnail,
        nativeName: input.nativeName,
        englishName: input.englishName,
        genres: genresStr,
        popularityScore: input.popularityScore,
        status: input.status,
        episodeCount: input.episodeCount,
        type: input.type,
        anilistId,
        isAdult: typeof input.isAdult === 'boolean' ? (input.isAdult ? 1 : 0) : null,
        episodeDuration: duration > 0 ? Math.round(duration / 60) : undefined,
      }

      const metaChanged = await showsMetaChanged(ctx.db, showId, metaCandidate)

      if (metaChanged) {
        await performWriteTransactionAsync(ctx.db, async (tx) => {
          await ShowsMetaRepository.upsert(tx, {
            id: showId,
            ...metaCandidate,
          })
        })
      }

      await performWriteTransactionAsync(ctx.db, async (tx) => {
        await WatchedEpisodesRepository.upsert(tx, {
          showId,
          episodeNumber,
          currentTime,
          duration,
        })

        await NotificationsRepository.deleteSpecificDismissed(tx, showId, episodeNumber)
        await NotificationsRepository.deleteDiscovered(tx, showId, episodeNumber)
      })

      ctx.db.scheduleSave()

      return { success: true }
    }),
})

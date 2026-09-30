import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import { performTvWriteTransactionAsync } from '../../sync.js'
import { adultNonListIds } from '../../utils/db-utils.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import {
  normalizeTvMediaId,
  TvLibraryRepository,
  TvProgressRepository,
} from '../../repositories/tv.repository.js'
import { defineSchema, reqObj, reqStr, strOrNull } from '../validation.js'

const isTvContinueAdult = (row: { adult?: boolean | number | null }) =>
  row.adult === true || row.adult === 1

const getAdultNonListMediaIds = (db: DatabaseWrapper) =>
  adultNonListIds(db, 'tv_progress', 'tv_library', 'mediaId', 'COALESCE(l.adult, p.adult) = 1')

export type TvProgressMediaInput = { mediaId: string }

const tvProgressMediaInput = () =>
  defineSchema<TvProgressMediaInput, TvProgressMediaInput>((value) => ({
    mediaId: reqStr(reqObj(value), 'mediaId'),
  }))

export type TvProgressLatestInput = { mediaId: string; season?: unknown; episode?: unknown }

const tvProgressLatestInput = () =>
  defineSchema<TvProgressLatestInput, TvProgressLatestInput>((value) => {
    const obj = reqObj(value)
    return { mediaId: reqStr(obj, 'mediaId'), season: obj.season, episode: obj.episode }
  })

export type TvProgressSaveInput = {
  mediaId: string
  season?: unknown
  episode?: unknown
  currentTime?: unknown
  duration?: unknown
  completed?: unknown
  title?: string | null
  poster?: string | null
  backdrop?: string | null
  year?: string | null
  overview?: string | null
  tmdbId?: unknown
  mediaType?: string | null
  adult?: unknown
}

const tvProgressSaveInput = () =>
  defineSchema<TvProgressSaveInput, TvProgressSaveInput>((value) => {
    const obj = reqObj(value)
    return {
      mediaId: reqStr(obj, 'mediaId'),
      season: obj.season,
      episode: obj.episode,
      currentTime: obj.currentTime,
      duration: obj.duration,
      completed: obj.completed,
      title: strOrNull(obj, 'title'),
      poster: strOrNull(obj, 'poster'),
      backdrop: strOrNull(obj, 'backdrop'),
      year: strOrNull(obj, 'year'),
      overview: strOrNull(obj, 'overview'),
      tmdbId: obj.tmdbId ?? null,
      mediaType: strOrNull(obj, 'mediaType'),
      adult: obj.adult ?? null,
    }
  })

export type TvProgressRemoveInput = { mediaId: string; season?: unknown; episode?: unknown }

const tvProgressRemoveInput = () =>
  defineSchema<TvProgressRemoveInput, TvProgressRemoveInput>((value) => {
    const obj = reqObj(value)
    return { mediaId: reqStr(obj, 'mediaId'), season: obj.season, episode: obj.episode }
  })

const tvProgressRemoveManyInput = () =>
  defineSchema<string[], string[]>((value) => {
    if (!Array.isArray(value) || value.length === 0)
      throw new Error('ids must be a non-empty array')
    return value.map((id) => String(id))
  })

export type TvContinueWatchingInput = { limit?: number }

const tvContinueWatchingInput = () =>
  defineSchema<TvContinueWatchingInput, TvContinueWatchingInput>((value) => {
    const obj = reqObj(value)
    const out: TvContinueWatchingInput = {}
    if (obj.limit !== undefined && obj.limit !== null && obj.limit !== '') {
      const limit = Number(obj.limit)
      if (Number.isFinite(limit)) out.limit = limit
    }
    return out
  })

export const tvProgressRouter = router({
  getByMedia: protectedProcedure.input(tvProgressMediaInput()).query(async ({ ctx, input }) => {
    const rows = await TvProgressRepository.getByMedia(ctx.tvDb, normalizeTvMediaId(input.mediaId))
    return { progress: rows }
  }),

  latest: protectedProcedure.input(tvProgressLatestInput()).query(async ({ ctx, input }) => {
    const mediaId = normalizeTvMediaId(input.mediaId)
    const season = parseInt(String(input.season), 10)
    const episode = parseInt(String(input.episode), 10)
    if (Number.isFinite(season) && Number.isFinite(episode)) {
      const row = await TvProgressRepository.getEpisode(ctx.tvDb, mediaId, season, episode)
      return row || { currentTime: 0, duration: 0, completed: 0 }
    }
    const row = await TvProgressRepository.getLatest(ctx.tvDb, mediaId)
    return row || { currentTime: 0, duration: 0, completed: 0 }
  }),

  save: protectedProcedure.input(tvProgressSaveInput()).mutation(async ({ ctx, input }) => {
    const mediaId = normalizeTvMediaId(input.mediaId)
    if (!mediaId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'mediaId is required' })
    }
    const seasonNum = Math.max(Number(input.season) || 1, 1)
    const episodeNum = Math.max(Number(input.episode) || 1, 1)
    const timeNum = Math.max(Number(input.currentTime) || 0, 0)
    const durationNum = Math.max(Number(input.duration) || 0, 0)
    const clampedTime = durationNum > 0 ? Math.min(timeNum, durationNum) : timeNum
    const storedTime =
      durationNum > 0 && clampedTime >= durationNum * 0.8 ? durationNum : clampedTime
    const completedNow =
      Number(input.completed) === 1 || (durationNum > 0 && storedTime >= durationNum * 0.8) ? 1 : 0
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvProgressRepository.upsert(tx, {
        mediaId: String(mediaId),
        season: Math.round(seasonNum),
        episode: Math.round(episodeNum),
        currentTime: storedTime,
        duration: durationNum,
        completed: completedNow,
        title: input.title ?? null,
        poster: input.poster ?? null,
        backdrop: input.backdrop ?? null,
        year: input.year ?? null,
        overview: input.overview ?? null,
        tmdbId: input.tmdbId != null ? Number(input.tmdbId) : null,
        mediaType: input.mediaType ?? null,
        adult: input.adult != null ? Number(input.adult) : null,
      })
      await TvLibraryRepository.touchProgress(tx, String(mediaId), {
        season: Math.round(seasonNum),
        episode: Math.round(episodeNum),
      })
    })
    return { success: true }
  }),

  remove: protectedProcedure.input(tvProgressRemoveInput()).mutation(async ({ ctx, input }) => {
    const mediaId = normalizeTvMediaId(input.mediaId)
    if (!mediaId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'mediaId is required' })
    }
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      if (input.season !== undefined && input.episode !== undefined) {
        await TvProgressRepository.deleteEpisode(
          tx,
          String(mediaId),
          Number(input.season),
          Number(input.episode)
        )
      } else {
        await TvProgressRepository.deleteByMedia(tx, String(mediaId))
      }
    })
    return { success: true }
  }),

  removeMany: protectedProcedure
    .input(tvProgressRemoveManyInput())
    .mutation(async ({ ctx, input }) => {
      const ids = input.map((id) => normalizeTvMediaId(id))
      await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
        await TvProgressRepository.deleteMany(tx, ids)
      })
      return { success: true, removed: ids.length }
    }),

  continueWatching: protectedProcedure
    .input(tvContinueWatchingInput())
    .query(async ({ ctx, input }) => {
      const limit = Math.min(Math.max(parseInt(String(input.limit ?? 24)) || 24, 1), 100)
      const { ignoreAdult, listOnly } = await SettingsRepository.readContinueFlags(
        ctx.db,
        'tvIgnoreAdultContent',
        'tvCwWatchlistOnly'
      )
      const rows = (await TvProgressRepository.getContinueWatching(ctx.tvDb, limit)).filter(
        (row) => {
          if (ignoreAdult && isTvContinueAdult(row)) return false
          if (listOnly && row.watchlistStatus !== 'Watching') return false
          return true
        }
      )
      return { data: rows, total: rows.length }
    }),

  adultCount: protectedProcedure.query(async ({ ctx }) => {
    const ids = await getAdultNonListMediaIds(ctx.tvDb)
    return { count: ids.length }
  }),

  purgeAdult: protectedProcedure.mutation(async ({ ctx }) => {
    const ids = await getAdultNonListMediaIds(ctx.tvDb)
    if (ids.length > 0) {
      await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
        for (const id of ids) await TvProgressRepository.deleteByMedia(tx, id)
      })
    }
    return { success: true, removed: ids.length }
  }),
})

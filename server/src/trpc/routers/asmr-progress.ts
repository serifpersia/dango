import { protectedProcedure, router } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import { performAsmrWriteTransactionAsync } from '../../sync.js'
import { adultNonListIds } from '../../utils/db-utils.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import {
  AsmrLibraryRepository,
  AsmrProgressRepository,
} from '../../repositories/asmr.repository.js'
import { defineSchema, reqObj, reqStr, reqStrArray, strOrNull } from '../validation.js'

const getAdultNonListWorkIds = (db: DatabaseWrapper) =>
  adultNonListIds(
    db,
    'asmr_progress',
    'asmr_library',
    'workId',
    'COALESCE(l.isAdult, p.isAdult) = 1'
  )

export type AsmrProgressIdsInput = { ids: string[] }

const asmrProgressIdsInput = () =>
  defineSchema<AsmrProgressIdsInput, AsmrProgressIdsInput>((value) => ({
    ids: reqStrArray(reqObj(value), 'ids', true),
  }))

export type AsmrProgressWorkInput = { workId: string }

const asmrProgressWorkInput = () =>
  defineSchema<AsmrProgressWorkInput, AsmrProgressWorkInput>((value) => ({
    workId: reqStr(reqObj(value), 'workId'),
  }))

export type AsmrProgressSaveInput = {
  workId: string
  trackIndex?: unknown
  trackLabel?: unknown
  currentTime?: unknown
  duration?: unknown
  title?: string | null
  thumbnail?: string | null
  rjCode?: string | null
  isAdult?: unknown
}

const asmrProgressSaveInput = () =>
  defineSchema<AsmrProgressSaveInput, AsmrProgressSaveInput>((value) => {
    const obj = reqObj(value)
    return {
      workId: reqStr(obj, 'workId'),
      trackIndex: obj.trackIndex,
      trackLabel: obj.trackLabel,
      currentTime: obj.currentTime,
      duration: obj.duration,
      title: strOrNull(obj, 'title'),
      thumbnail: strOrNull(obj, 'thumbnail'),
      rjCode: strOrNull(obj, 'rjCode'),
      isAdult: obj.isAdult ?? null,
    }
  })

export type AsmrProgressRemoveInput = { workId: string; trackIndex?: unknown }

const asmrProgressRemoveInput = () =>
  defineSchema<AsmrProgressRemoveInput, AsmrProgressRemoveInput>((value) => {
    const obj = reqObj(value)
    return { workId: reqStr(obj, 'workId'), trackIndex: obj.trackIndex ?? undefined }
  })

export type AsmrContinueListeningInput = { limit?: number }

const asmrContinueListeningInput = () =>
  defineSchema<AsmrContinueListeningInput, AsmrContinueListeningInput>((value) => {
    const obj = reqObj(value)
    const out: AsmrContinueListeningInput = {}
    if (obj.limit !== undefined && obj.limit !== null && obj.limit !== '') {
      const limit = Number(obj.limit)
      if (Number.isFinite(limit)) out.limit = limit
    }
    return out
  })

export const asmrProgressRouter = router({
  getByWork: protectedProcedure.input(asmrProgressWorkInput()).query(async ({ ctx, input }) => {
    const rows = await AsmrProgressRepository.getByWork(ctx.asmrDb, input.workId)
    return { progress: rows }
  }),

  latest: protectedProcedure.input(asmrProgressWorkInput()).query(async ({ ctx, input }) => {
    const row = await AsmrProgressRepository.getLatest(ctx.asmrDb, input.workId)
    return row || { currentTime: 0, duration: 0 }
  }),

  save: protectedProcedure.input(asmrProgressSaveInput()).mutation(async ({ ctx, input }) => {
    const trackIndexNum = Math.max(Math.round(Number(input.trackIndex)) || 0, 0)
    const timeNum = Math.max(Number(input.currentTime) || 0, 0)
    const durationNum = Math.max(Number(input.duration) || 0, 0)
    await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
      await AsmrProgressRepository.upsert(tx, {
        workId: String(input.workId),
        trackIndex: trackIndexNum,
        trackLabel: String(input.trackLabel || ''),
        currentTime: timeNum,
        duration: durationNum,
        title: input.title ?? null,
        thumbnail: input.thumbnail ?? null,
        rjCode: input.rjCode ?? null,
        isAdult: input.isAdult != null ? Number(input.isAdult) : null,
      })
      await AsmrLibraryRepository.touchProgress(tx, String(input.workId), {
        trackIndex: trackIndexNum,
        trackLabel: String(input.trackLabel || ''),
        position: timeNum,
      })
    })
    return { success: true }
  }),

  remove: protectedProcedure.input(asmrProgressRemoveInput()).mutation(async ({ ctx, input }) => {
    await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
      if (input.trackIndex !== undefined && input.trackIndex !== null) {
        await AsmrProgressRepository.deleteTrack(tx, String(input.workId), Number(input.trackIndex))
      } else {
        await AsmrProgressRepository.deleteByWork(tx, String(input.workId))
      }
    })
    return { success: true }
  }),

  removeMany: protectedProcedure.input(asmrProgressIdsInput()).mutation(async ({ ctx, input }) => {
    const ids = input.ids.map((id) => String(id))
    await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
      await AsmrProgressRepository.deleteMany(tx, ids)
    })
    return { success: true, removed: ids.length }
  }),

  continueListening: protectedProcedure
    .input(asmrContinueListeningInput())
    .query(async ({ ctx, input }) => {
      const limit = Math.min(Math.max(parseInt(String(input.limit ?? 24)) || 24, 1), 100)
      const { ignoreAdult, listOnly } = await SettingsRepository.readContinueFlags(
        ctx.db,
        'asmrIgnoreAdultContent',
        'asmrCwWatchlistOnly'
      )
      const rows = (await AsmrProgressRepository.getContinueListening(ctx.asmrDb, limit)).filter(
        (row) => {
          if (ignoreAdult && row.isAdult === 1) return false
          if (listOnly && row.watchlistStatus !== 'Listening') return false
          return true
        }
      )
      return { data: rows, total: rows.length }
    }),

  adultCount: protectedProcedure.query(async ({ ctx }) => {
    const ids = await getAdultNonListWorkIds(ctx.asmrDb)
    return { count: ids.length }
  }),

  purgeAdult: protectedProcedure.mutation(async ({ ctx }) => {
    const ids = await getAdultNonListWorkIds(ctx.asmrDb)
    if (ids.length > 0) {
      await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
        for (const id of ids) await AsmrProgressRepository.deleteByWork(tx, id)
      })
    }
    return { success: true, removed: ids.length }
  }),
})

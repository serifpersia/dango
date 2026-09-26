import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { performTvWriteTransactionAsync } from '../../sync.js'
import {
  buildTvId,
  TV_STATUSES,
  TvLibraryRepository,
  TvProgressRepository,
} from '../../repositories/tv.repository.js'
import { defineSchema, reqObj, reqStr, optStr, reqStrArray } from '../validation.js'

function normalizeMediaType(raw: unknown): 'movie' | 'tv' {
  return String(raw).toLowerCase() === 'movie' ? 'movie' : 'tv'
}

export type TvLibraryListInput = { status?: string; page?: number; limit?: number }

const tvLibraryListInput = () =>
  defineSchema<TvLibraryListInput, TvLibraryListInput>((value) => {
    const obj = reqObj(value)
    const out: TvLibraryListInput = {}
    const status = optStr(obj, 'status')
    if (status !== undefined) out.status = status
    if (obj.page !== undefined && obj.page !== null && obj.page !== '') {
      const page = Number(obj.page)
      if (Number.isFinite(page)) out.page = page
    }
    if (obj.limit !== undefined && obj.limit !== null && obj.limit !== '') {
      const limit = Number(obj.limit)
      if (Number.isFinite(limit)) out.limit = limit
    }
    return out
  })

export type TvLibraryIdInput = { id: string }

const tvLibraryIdInput = () =>
  defineSchema<TvLibraryIdInput, TvLibraryIdInput>((value) => ({
    id: reqStr(reqObj(value), 'id'),
  }))

export type TvLibraryAddInput = {
  tmdbId?: unknown
  mediaType?: unknown
  id?: unknown
  title?: unknown
  poster?: unknown
  backdrop?: unknown
  year?: unknown
  overview?: unknown
  status?: unknown
  adult?: unknown
}

const tvLibraryAddInput = () =>
  defineSchema<TvLibraryAddInput, TvLibraryAddInput>((value) => {
    const obj = reqObj(value)
    return {
      tmdbId: obj.tmdbId,
      mediaType: obj.mediaType,
      id: obj.id,
      title: obj.title,
      poster: obj.poster,
      backdrop: obj.backdrop,
      year: obj.year,
      overview: obj.overview,
      status: obj.status,
      adult: obj.adult,
    }
  })

const tvLibraryRemoveInput = () =>
  defineSchema<string, string>((value) => {
    if (typeof value !== 'string' || value.length === 0) throw new Error('id must be a string')
    return value
  })

export type TvLibraryStatusInput = { id: string; status: string }

const tvLibraryStatusInput = () =>
  defineSchema<TvLibraryStatusInput, TvLibraryStatusInput>((value) => {
    const obj = reqObj(value)
    return { id: reqStr(obj, 'id'), status: reqStr(obj, 'status') }
  })

export type TvLibraryBatchStatusInput = { ids: string[]; status: string }

const tvLibraryBatchStatusInput = () =>
  defineSchema<TvLibraryBatchStatusInput, TvLibraryBatchStatusInput>((value) => {
    const obj = reqObj(value)
    return { ids: reqStrArray(obj, 'ids', true), status: reqStr(obj, 'status') }
  })

const tvLibraryRemoveManyInput = () =>
  defineSchema<string[], string[]>((value) => {
    if (!Array.isArray(value) || value.length === 0)
      throw new Error('ids must be a non-empty array')
    return value.map((id) => String(id))
  })

export const tvLibraryRouter = router({
  list: protectedProcedure.input(tvLibraryListInput()).query(async ({ ctx, input }) => {
    const page = Math.max(parseInt(String(input.page ?? 1)) || 1, 1)
    const limit = Math.min(Math.max(parseInt(String(input.limit ?? 24)) || 24, 1), 100)
    const offset = (page - 1) * limit
    const rows = await TvLibraryRepository.getAll(ctx.tvDb, input.status, limit, offset)
    const total = await TvLibraryRepository.getCount(ctx.tvDb, input.status)
    return { data: rows, total, page, limit }
  }),

  ids: protectedProcedure.query(async ({ ctx }) => {
    return { ids: await TvLibraryRepository.getIds(ctx.tvDb) }
  }),

  check: protectedProcedure.input(tvLibraryIdInput()).query(async ({ ctx, input }) => {
    const item = await TvLibraryRepository.getById(ctx.tvDb, input.id)
    return { inLibrary: !!item, status: item?.status ?? null }
  }),

  add: protectedProcedure.input(tvLibraryAddInput()).mutation(async ({ ctx, input }) => {
    const tmdbIdNum = Number(input.tmdbId)
    if (!tmdbIdNum || (!input.id && !input.mediaType)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'tmdbId and mediaType are required' })
    }
    const mediaType = normalizeMediaType(
      input.mediaType || (String(input.id).startsWith('movie:') ? 'movie' : 'tv')
    )
    const id =
      input.id && String(input.id).includes(':')
        ? String(input.id)
        : buildTvId(mediaType, tmdbIdNum)
    const cleanStatus =
      typeof input.status === 'string' && (TV_STATUSES as string[]).includes(input.status)
        ? input.status
        : 'Watching'
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvLibraryRepository.upsert(tx, {
        id,
        tmdbId: tmdbIdNum,
        mediaType,
        title: String(input.title || ''),
        poster: String(input.poster || ''),
        backdrop: input.backdrop ? String(input.backdrop) : undefined,
        year: input.year ? String(input.year) : undefined,
        overview: input.overview ? String(input.overview) : undefined,
        status: cleanStatus,
        adult: input.adult === true,
      })
    })
    return { success: true, id }
  }),

  remove: protectedProcedure.input(tvLibraryRemoveInput()).mutation(async ({ ctx, input }) => {
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvLibraryRepository.delete(tx, String(input))
      await TvProgressRepository.deleteByMedia(tx, String(input))
    })
    return { success: true }
  }),

  setStatus: protectedProcedure.input(tvLibraryStatusInput()).mutation(async ({ ctx, input }) => {
    if (!input.id || !(TV_STATUSES as string[]).includes(input.status)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'id and a valid status are required' })
    }
    await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
      await TvLibraryRepository.updateStatus(tx, String(input.id), String(input.status))
    })
    return { success: true }
  }),

  batchStatus: protectedProcedure
    .input(tvLibraryBatchStatusInput())
    .mutation(async ({ ctx, input }) => {
      if (!input.status || !(TV_STATUSES as string[]).includes(input.status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'a valid status is required' })
      }
      const ids = input.ids.map((id) => String(id))
      await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
        await TvLibraryRepository.updateStatusMany(tx, ids, String(input.status))
      })
      return { success: true, updated: ids.length }
    }),

  removeMany: protectedProcedure
    .input(tvLibraryRemoveManyInput())
    .mutation(async ({ ctx, input }) => {
      const ids = input.map((id) => String(id))
      await performTvWriteTransactionAsync(ctx.tvDb, async (tx) => {
        await TvLibraryRepository.deleteMany(tx, ids)
        await TvProgressRepository.deleteMany(tx, ids)
      })
      return { success: true, removed: ids.length }
    }),
})

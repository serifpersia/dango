import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { performAsmrWriteTransactionAsync } from '../../sync.js'
import {
  buildAsmrId,
  ASMR_STATUSES,
  AsmrLibraryRepository,
  AsmrProgressRepository,
} from '../../repositories/asmr.repository.js'
import { defineSchema, reqObj, reqStr, optStr, reqStrArray } from '../validation.js'

export type AsmrLibraryListInput = { status?: string; page?: number; limit?: number }

const asmrLibraryListInput = () =>
  defineSchema<AsmrLibraryListInput, AsmrLibraryListInput>((value) => {
    const obj = reqObj(value)
    const out: AsmrLibraryListInput = {}
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

export type AsmrLibraryIdInput = { id: string }

const asmrLibraryIdInput = () =>
  defineSchema<AsmrLibraryIdInput, AsmrLibraryIdInput>((value) => ({
    id: reqStr(reqObj(value), 'id'),
  }))

export type AsmrLibraryAddInput = {
  rjCode?: string
  id?: string
  title?: string
  thumbnail?: string
  status?: string
  isAdult?: unknown
}

const asmrLibraryAddInput = () =>
  defineSchema<AsmrLibraryAddInput, AsmrLibraryAddInput>((value) => {
    const obj = reqObj(value)
    return {
      rjCode: optStr(obj, 'rjCode'),
      id: optStr(obj, 'id'),
      title: optStr(obj, 'title'),
      thumbnail: optStr(obj, 'thumbnail'),
      status: optStr(obj, 'status'),
      isAdult: obj.isAdult,
    }
  })

export type AsmrLibraryStatusInput = { id: string; status: string }

const asmrLibraryStatusInput = () =>
  defineSchema<AsmrLibraryStatusInput, AsmrLibraryStatusInput>((value) => {
    const obj = reqObj(value)
    return { id: reqStr(obj, 'id'), status: reqStr(obj, 'status') }
  })

export type AsmrLibraryBatchStatusInput = { ids: string[]; status: string }

const asmrLibraryBatchStatusInput = () =>
  defineSchema<AsmrLibraryBatchStatusInput, AsmrLibraryBatchStatusInput>((value) => {
    const obj = reqObj(value)
    return { ids: reqStrArray(obj, 'ids', true), status: reqStr(obj, 'status') }
  })

export type AsmrLibraryIdsInput = { ids: string[] }

const asmrLibraryIdsInput = () =>
  defineSchema<AsmrLibraryIdsInput, AsmrLibraryIdsInput>((value) => ({
    ids: reqStrArray(reqObj(value), 'ids', true),
  }))

export const asmrLibraryRouter = router({
  list: protectedProcedure.input(asmrLibraryListInput()).query(async ({ ctx, input }) => {
    const page = Math.max(parseInt(String(input.page ?? 1)) || 1, 1)
    const limit = Math.min(Math.max(parseInt(String(input.limit ?? 24)) || 24, 1), 100)
    const offset = (page - 1) * limit
    const rows = await AsmrLibraryRepository.getAll(ctx.asmrDb, input.status, limit, offset)
    const total = await AsmrLibraryRepository.getCount(ctx.asmrDb, input.status)
    return { data: rows, total, page, limit }
  }),

  ids: protectedProcedure.query(async ({ ctx }) => {
    return { ids: await AsmrLibraryRepository.getIds(ctx.asmrDb) }
  }),

  check: protectedProcedure.input(asmrLibraryIdInput()).query(async ({ ctx, input }) => {
    const item = await AsmrLibraryRepository.getById(ctx.asmrDb, input.id)
    return { inLibrary: !!item, status: item?.status ?? null }
  }),

  add: protectedProcedure.input(asmrLibraryAddInput()).mutation(async ({ ctx, input }) => {
    const rawCode = String(input.rjCode || input.id || '').trim()
    if (!rawCode) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'rjCode is required' })
    }
    const id = input.id && input.id.trim() ? buildAsmrId(input.id) : buildAsmrId(rawCode)
    const cleanStatus =
      typeof input.status === 'string' && (ASMR_STATUSES as string[]).includes(input.status)
        ? input.status
        : 'Listening'
    await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
      await AsmrLibraryRepository.upsert(tx, {
        id,
        rjCode: buildAsmrId(rawCode),
        title: String(input.title || ''),
        thumbnail: String(input.thumbnail || ''),
        status: cleanStatus,
        isAdult: input.isAdult === true || input.isAdult === 1,
      })
    })
    return { success: true, id }
  }),

  remove: protectedProcedure.input(asmrLibraryIdInput()).mutation(async ({ ctx, input }) => {
    await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
      await AsmrLibraryRepository.delete(tx, String(input.id))
      await AsmrProgressRepository.deleteByWork(tx, String(input.id))
    })
    return { success: true }
  }),

  setStatus: protectedProcedure.input(asmrLibraryStatusInput()).mutation(async ({ ctx, input }) => {
    if (!input.id || !(ASMR_STATUSES as string[]).includes(input.status)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'id and a valid status are required' })
    }
    await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
      await AsmrLibraryRepository.updateStatus(tx, String(input.id), String(input.status))
    })
    return { success: true }
  }),

  batchStatus: protectedProcedure
    .input(asmrLibraryBatchStatusInput())
    .mutation(async ({ ctx, input }) => {
      if (!input.status || !(ASMR_STATUSES as string[]).includes(input.status)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'a valid status is required' })
      }
      const ids = input.ids.map((id) => String(id))
      await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
        await AsmrLibraryRepository.updateStatusMany(tx, ids, String(input.status))
      })
      return { success: true, updated: ids.length }
    }),

  removeMany: protectedProcedure.input(asmrLibraryIdsInput()).mutation(async ({ ctx, input }) => {
    const ids = input.ids.map((id) => String(id))
    await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
      await AsmrLibraryRepository.deleteMany(tx, ids)
      await AsmrProgressRepository.deleteMany(tx, ids)
    })
    return { success: true, removed: ids.length }
  }),
})

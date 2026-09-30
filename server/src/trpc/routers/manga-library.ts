import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import { performMangaWriteTransactionAsync } from '../../sync.js'
import {
  buildMangaId,
  MANGA_STATUSES,
  MangaLibraryRepository,
  MangaProgressRepository,
} from '../../repositories/manga.repository.js'
import {
  badRequest,
  defineSchema,
  failed,
  optStr,
  readCount,
  reqObj,
  reqStr,
} from '../validation.js'

function mangaDb(ctx: { mangaDb: DatabaseWrapper }): DatabaseWrapper {
  const db = ctx.mangaDb
  if (!db || db.isClosedCheck()) throw new Error('Manga database is not ready')
  return db
}

function normalizeId(provider: string, mangaId: string, idRaw?: string): string {
  if (idRaw && idRaw.includes(':')) return idRaw
  return buildMangaId(provider, mangaId || idRaw || '')
}

const mangaLibraryListInput = () =>
  defineSchema<
    { status?: string; page?: number; limit?: number },
    { status?: string; page: number; limit: number }
  >((value) => {
    const obj = reqObj(value)
    const status = optStr(obj, 'status')
    const page = Math.max(readCount(obj, 'page', 1), 1)
    const limit = Math.min(Math.max(readCount(obj, 'limit', 24), 1), 100)
    return { status, page, limit }
  })

const mangaLibraryIdInput = () =>
  defineSchema<{ id: string }, { id: string }>((value) => ({
    id: reqStr(reqObj(value), 'id'),
  }))

export type MangaLibraryAddInput = {
  provider?: string
  mangaId?: string
  id?: string
  title?: string
  cover?: string
  status?: string
  author?: string
  altTitle?: string
  contentRating?: string
  silent?: boolean
}

const mangaLibraryAddInput = () =>
  defineSchema<MangaLibraryAddInput, MangaLibraryAddInput>((value) => {
    const obj = reqObj(value)
    const out: MangaLibraryAddInput = {
      provider: optStr(obj, 'provider'),
      mangaId: optStr(obj, 'mangaId'),
      id: optStr(obj, 'id'),
      title: optStr(obj, 'title'),
      cover: optStr(obj, 'cover'),
      status: optStr(obj, 'status'),
      author: optStr(obj, 'author'),
      altTitle: optStr(obj, 'altTitle'),
      contentRating: optStr(obj, 'contentRating'),
    }
    if (typeof obj.silent === 'boolean') out.silent = obj.silent
    return out
  })

const mangaLibraryRemoveInput = () =>
  defineSchema<string, string>((value) => {
    if (typeof value !== 'string') throw new Error('id must be a string')
    return value
  })

const mangaLibraryStatusInput = () =>
  defineSchema<{ id?: string; status?: string }, { id?: string; status?: string }>((value) => {
    const obj = reqObj(value)
    return { id: optStr(obj, 'id'), status: optStr(obj, 'status') }
  })

const mangaLibraryLinkInput = () =>
  defineSchema<{ id?: string; anilistId?: unknown }, { id?: string; anilistId?: unknown }>(
    (value) => {
      const obj = reqObj(value)
      return { id: optStr(obj, 'id'), anilistId: obj.anilistId }
    }
  )

const mangaLibraryBatchStatusInput = () =>
  defineSchema<{ ids?: unknown; status?: string }, { ids: string[]; status?: string }>((value) => {
    const obj = reqObj(value)
    const idsRaw = obj.ids
    const ids = Array.isArray(idsRaw) ? idsRaw.map((id) => String(id)) : []
    return { ids, status: optStr(obj, 'status') }
  })

const mangaLibraryRemoveManyInput = () =>
  defineSchema<string[], string[]>((value) => {
    if (!Array.isArray(value)) throw new Error('ids must be a non-empty array')
    return value.map((id) => String(id))
  })

export const mangaLibraryRouter = router({
  list: protectedProcedure.input(mangaLibraryListInput()).query(async ({ ctx, input }) => {
    try {
      const offset = (input.page - 1) * input.limit
      const db = mangaDb(ctx)
      const rows = await MangaLibraryRepository.getAll(db, input.status, input.limit, offset)
      const total = await MangaLibraryRepository.getCount(db, input.status)
      return { data: rows, total, page: input.page, limit: input.limit }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed('Failed to load manga library')
    }
  }),

  ids: protectedProcedure.query(async ({ ctx }) => {
    try {
      return { ids: await MangaLibraryRepository.getIds(mangaDb(ctx)) }
    } catch {
      return { ids: [] }
    }
  }),

  check: protectedProcedure.input(mangaLibraryIdInput()).query(async ({ ctx, input }) => {
    try {
      const item = await MangaLibraryRepository.getById(mangaDb(ctx), input.id)
      return { inLibrary: !!item, status: item?.status ?? null }
    } catch {
      return { inLibrary: false, status: null }
    }
  }),

  entry: protectedProcedure.input(mangaLibraryIdInput()).query(async ({ ctx, input }) => {
    try {
      const item = await MangaLibraryRepository.getById(mangaDb(ctx), input.id)
      if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not in library' })
      return { item }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed('Failed to load entry')
    }
  }),

  add: protectedProcedure.input(mangaLibraryAddInput()).mutation(async ({ ctx, input }) => {
    const provider = input.provider || ''
    const mangaId = input.mangaId || ''
    const idRaw = input.id || ''
    if (!provider || (!mangaId && !idRaw)) {
      throw badRequest('provider and mangaId are required')
    }
    const id = normalizeId(
      String(provider),
      String(mangaId || ''),
      idRaw ? String(idRaw) : undefined
    )
    const cleanStatus =
      typeof input.status === 'string' && MANGA_STATUSES.includes(input.status)
        ? input.status
        : 'Reading'
    try {
      await performMangaWriteTransactionAsync(mangaDb(ctx), async (tx) => {
        await MangaLibraryRepository.upsert(tx, {
          id,
          provider: String(provider).toLowerCase(),
          mangaId: String(mangaId || idRaw || ''),
          title: String(input.title || ''),
          cover: String(input.cover || ''),
          status: cleanStatus,
          author: input.author ? String(input.author) : undefined,
          altTitle: input.altTitle ? String(input.altTitle) : undefined,
          contentRating: input.contentRating ? String(input.contentRating) : undefined,
        })
      })
      return { success: true, id }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed('Failed to bookmark manga')
    }
  }),

  remove: protectedProcedure.input(mangaLibraryRemoveInput()).mutation(async ({ ctx, input }) => {
    if (!input) throw badRequest('id is required')
    try {
      await performMangaWriteTransactionAsync(mangaDb(ctx), async (tx) => {
        await MangaLibraryRepository.delete(tx, String(input))
        await MangaProgressRepository.deleteByManga(tx, String(input))
      })
      return { success: true }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed('Failed to remove bookmark')
    }
  }),

  setStatus: protectedProcedure
    .input(mangaLibraryStatusInput())
    .mutation(async ({ ctx, input }) => {
      if (!input.id || !input.status || !MANGA_STATUSES.includes(input.status)) {
        throw badRequest('id and a valid status are required')
      }
      try {
        await performMangaWriteTransactionAsync(mangaDb(ctx), async (tx) => {
          await MangaLibraryRepository.updateStatus(tx, String(input.id), String(input.status))
        })
        return { success: true }
      } catch (err) {
        if (err instanceof TRPCError) throw err
        throw failed('Failed to update status')
      }
    }),

  link: protectedProcedure.input(mangaLibraryLinkInput()).mutation(async ({ ctx, input }) => {
    const targetId = typeof input.id === 'string' ? input.id : ''
    const mediaId = Number(input.anilistId)
    if (!targetId || !Number.isInteger(mediaId) || mediaId <= 0) {
      throw badRequest('id and a numeric anilistId are required')
    }
    try {
      const db = mangaDb(ctx)
      const row = await MangaLibraryRepository.getById(db, targetId)
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Library entry not found' })
      if (String(row.provider).toLowerCase() === 'anilist') {
        throw badRequest('Link a provider bookmark to the AniList entry, not the reverse')
      }
      let progressMigrated = false
      await performMangaWriteTransactionAsync(db, async (tx) => {
        await MangaLibraryRepository.setAnilistId(tx, targetId, mediaId, 'manual')
        const orphanId = `anilist:${mediaId}`
        if (orphanId !== targetId) {
          const orphan = await MangaLibraryRepository.getById(tx, orphanId)
          const target = await MangaLibraryRepository.getById(tx, targetId)
          const targetProgress = await MangaProgressRepository.getByManga(tx, targetId)
          if (
            orphan?.lastChapterNumber &&
            !target?.lastChapterNumber &&
            targetProgress.length === 0
          ) {
            await MangaLibraryRepository.setProgressPointer(tx, targetId, orphan.lastChapterNumber)
            await MangaProgressRepository.moveSyntheticChapters(tx, orphanId, targetId)
            progressMigrated = true
          }
          await MangaLibraryRepository.delete(tx, orphanId)
          await MangaProgressRepository.deleteByManga(tx, orphanId)
        }
      })
      return { success: true, id: targetId, progressMigrated }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      throw failed('Failed to link entry')
    }
  }),

  batchStatus: protectedProcedure
    .input(mangaLibraryBatchStatusInput())
    .mutation(async ({ ctx, input }) => {
      if (!Array.isArray(input.ids) || input.ids.length === 0) {
        throw badRequest('ids must be a non-empty array')
      }
      if (!input.status || !MANGA_STATUSES.includes(input.status)) {
        throw badRequest('a valid status is required')
      }
      const ids = input.ids.map((id) => String(id))
      try {
        await performMangaWriteTransactionAsync(mangaDb(ctx), async (tx) => {
          await MangaLibraryRepository.updateStatusMany(tx, ids, String(input.status))
        })
        return { success: true, updated: ids.length }
      } catch (err) {
        if (err instanceof TRPCError) throw err
        throw failed('Failed to update statuses')
      }
    }),

  removeMany: protectedProcedure
    .input(mangaLibraryRemoveManyInput())
    .mutation(async ({ ctx, input }) => {
      if (!Array.isArray(input) || input.length === 0) {
        throw badRequest('ids must be a non-empty array')
      }
      const ids = input.map((id) => String(id))
      try {
        await performMangaWriteTransactionAsync(mangaDb(ctx), async (tx) => {
          await MangaLibraryRepository.deleteMany(tx, ids)
          await MangaProgressRepository.deleteMany(tx, ids)
        })
        return { success: true, removed: ids.length }
      } catch (err) {
        if (err instanceof TRPCError) throw err
        throw failed('Failed to remove bookmarks')
      }
    }),
})

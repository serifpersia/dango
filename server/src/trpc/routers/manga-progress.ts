import { protectedProcedure, router } from '../index.js'
import { defineSchema, optStr, reqObj, reqStr, reqStrArray } from '../validation.js'
import { performMangaWriteTransactionAsync } from '../../sync.js'
import { adultNonListIds } from '../../utils/db-utils.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import {
  MangaLibraryRepository,
  MangaProgressRepository,
} from '../../repositories/manga.repository.js'
import type { DatabaseWrapper } from '../../db.js'

const MANGA_ADULT_RATINGS = ['erotica', 'pornographic']

const isMangaContinueAdult = (row: { contentRating?: string | null }) =>
  !!row.contentRating && MANGA_ADULT_RATINGS.includes(row.contentRating)

const getAdultNonListMangaIds = (db: DatabaseWrapper) =>
  adultNonListIds(
    db,
    'manga_progress',
    'manga_library',
    'mangaId',
    "COALESCE(l.contentRating, p.contentRating) IN ('erotica', 'pornographic')"
  )

export type MangaIdInput = { mangaId: string }

const mangaIdInput = () =>
  defineSchema<MangaIdInput, MangaIdInput>((value) => ({
    mangaId: reqStr(reqObj(value), 'mangaId'),
  }))

export type MangaProgressSaveInput = {
  mangaId: string
  chapterId: string
  chapterNumber?: string
  page?: number
  pageCount?: number
  title?: string | null
  cover?: string | null
  provider?: string | null
  altTitle?: string | null
  contentRating?: string | null
}

const mangaProgressSaveInput = () =>
  defineSchema<MangaProgressSaveInput, MangaProgressSaveInput>((value) => {
    const obj = reqObj(value)
    const out: MangaProgressSaveInput = {
      mangaId: reqStr(obj, 'mangaId'),
      chapterId: reqStr(obj, 'chapterId'),
    }
    if (obj.chapterNumber !== undefined && obj.chapterNumber !== null)
      out.chapterNumber = String(obj.chapterNumber)
    if (obj.page !== undefined && obj.page !== null) {
      const page = Number(obj.page)
      if (!Number.isNaN(page)) out.page = page
    }
    if (obj.pageCount !== undefined && obj.pageCount !== null) {
      const pageCount = Number(obj.pageCount)
      if (!Number.isNaN(pageCount)) out.pageCount = pageCount
    }
    const title = optStr(obj, 'title')
    if (title !== undefined) out.title = title
    const cover = optStr(obj, 'cover')
    if (cover !== undefined) out.cover = cover
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    const altTitle = optStr(obj, 'altTitle')
    if (altTitle !== undefined) out.altTitle = altTitle
    const contentRating = optStr(obj, 'contentRating')
    if (contentRating !== undefined) out.contentRating = contentRating
    return out
  })

export type MangaProgressRemoveInput = { mangaId: string; chapterId?: string }

const mangaProgressRemoveInput = () =>
  defineSchema<MangaProgressRemoveInput, MangaProgressRemoveInput>((value) => {
    const obj = reqObj(value)
    const out: MangaProgressRemoveInput = { mangaId: reqStr(obj, 'mangaId') }
    const chapterId = optStr(obj, 'chapterId')
    if (chapterId !== undefined) out.chapterId = chapterId
    return out
  })

const mangaProgressRemoveManyInput = () =>
  defineSchema<{ ids: string[] }, { ids: string[] }>((value) => ({
    ids: reqStrArray(reqObj(value), 'ids', true),
  }))

export type MangaContinueReadingInput = { limit?: number }

const mangaContinueReadingInput = () =>
  defineSchema<MangaContinueReadingInput, MangaContinueReadingInput>((value) => {
    const obj = reqObj(value)
    const out: MangaContinueReadingInput = {}
    if (obj.limit !== undefined && obj.limit !== null) {
      const limit = Number(obj.limit)
      if (!Number.isNaN(limit)) out.limit = limit
    }
    return out
  })

export const mangaProgressRouter = router({
  byManga: protectedProcedure.input(mangaIdInput()).query(async ({ ctx, input }) => {
    try {
      const rows = await MangaProgressRepository.getByManga(ctx.mangaDb, input.mangaId)
      return { progress: rows }
    } catch {
      return { progress: [] }
    }
  }),

  latest: protectedProcedure.input(mangaIdInput()).query(async ({ ctx, input }) => {
    try {
      const row = await MangaProgressRepository.getLatest(ctx.mangaDb, input.mangaId)
      return row || { page: 0, pageCount: 0 }
    } catch {
      return { page: 0, pageCount: 0 }
    }
  }),

  save: protectedProcedure.input(mangaProgressSaveInput()).mutation(async ({ ctx, input }) => {
    const pageNum = Math.max(Number(input.page) || 0, 0)
    const pageCountNum = Math.max(Number(input.pageCount) || 0, 0)
    await performMangaWriteTransactionAsync(ctx.mangaDb, async (tx) => {
      await MangaProgressRepository.upsert(tx, {
        mangaId: String(input.mangaId),
        chapterId: String(input.chapterId),
        chapterNumber: String(input.chapterNumber || ''),
        page: pageNum,
        pageCount: pageCountNum,
        title: input.title ?? null,
        cover: input.cover ?? null,
        provider: input.provider ?? null,
        altTitle: input.altTitle ?? null,
        contentRating: input.contentRating ?? null,
      })
      await MangaLibraryRepository.touchProgress(tx, String(input.mangaId), {
        chapterId: String(input.chapterId),
        chapterNumber: String(input.chapterNumber || ''),
        page: pageNum,
      })
    })
    return { success: true }
  }),

  remove: protectedProcedure.input(mangaProgressRemoveInput()).mutation(async ({ ctx, input }) => {
    await performMangaWriteTransactionAsync(ctx.mangaDb, async (tx) => {
      if (input.chapterId) {
        await MangaProgressRepository.deleteChapter(
          tx,
          String(input.mangaId),
          String(input.chapterId)
        )
      } else {
        await MangaProgressRepository.deleteByManga(tx, String(input.mangaId))
      }
    })
    return { success: true }
  }),

  removeMany: protectedProcedure
    .input(mangaProgressRemoveManyInput())
    .mutation(async ({ ctx, input }) => {
      const ids = input.ids.map((id) => String(id))
      await performMangaWriteTransactionAsync(ctx.mangaDb, async (tx) => {
        await MangaProgressRepository.deleteMany(tx, ids)
      })
      return { success: true, removed: ids.length }
    }),

  continueReading: protectedProcedure
    .input(mangaContinueReadingInput())
    .query(async ({ ctx, input }) => {
      try {
        const limit = Math.min(Math.max(parseInt(String(input.limit)) || 24, 1), 100)
        const { ignoreAdult, listOnly } = await SettingsRepository.readContinueFlags(
          ctx.db,
          'mangaIgnoreAdultContent',
          'mangaCwWatchlistOnly'
        )
        const rows = (await MangaProgressRepository.getContinueReading(ctx.mangaDb, limit)).filter(
          (row) => {
            if (ignoreAdult && isMangaContinueAdult(row)) return false
            if (listOnly && row.watchlistStatus !== 'Reading') return false
            return true
          }
        )
        return { data: rows, total: rows.length }
      } catch {
        return { data: [], total: 0 }
      }
    }),

  adultCount: protectedProcedure.query(async ({ ctx }) => {
    try {
      const ids = await getAdultNonListMangaIds(ctx.mangaDb)
      return { count: ids.length }
    } catch {
      return { count: 0 }
    }
  }),

  purgeAdult: protectedProcedure.mutation(async ({ ctx }) => {
    const ids = await getAdultNonListMangaIds(ctx.mangaDb)
    if (ids.length > 0) {
      await performMangaWriteTransactionAsync(ctx.mangaDb, async (tx) => {
        await MangaProgressRepository.deleteMany(tx, ids)
      })
    }
    return { success: true, removed: ids.length }
  }),
})

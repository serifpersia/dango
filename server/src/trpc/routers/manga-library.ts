import { pushMangaEntry } from '../../lib/tracker/manga-push.js'
import { router, protectedProcedure } from '../index.js'
import { performMangaWriteTransactionAsync } from '../../db/transaction.js'
import {
  buildMangaId,
  MANGA_STATUSES,
  MangaLibraryRepository,
  MangaProgressRepository,
} from '../../repositories/manga.repository.js'
import { createLibraryRouter } from './library-factory.js'
import { defineSchema, idFieldInput, optStr, reqObj } from '../validation.js'
import { badRequest, notFound } from '../errors.js'

function normalizeId(provider: string, mangaId: string, idRaw?: string): string {
  if (idRaw && idRaw.includes(':')) return idRaw
  return buildMangaId(provider, mangaId || idRaw || '')
}

const mangaLibraryIdInput = () => idFieldInput('id')

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

const mangaLibraryLinkInput = () =>
  defineSchema<{ id?: string; anilistId?: unknown }, { id?: string; anilistId?: unknown }>(
    (value) => {
      const obj = reqObj(value)
      return { id: optStr(obj, 'id'), anilistId: obj.anilistId }
    }
  )

const shared = createLibraryRouter({
  db: (ctx) => ctx.mangaDb,
  write: performMangaWriteTransactionAsync,
  repo: MangaLibraryRepository,
  progress: {
    deleteByKey: (db, id) => MangaProgressRepository.deleteByKey(db, id),
    deleteMany: (db, ids) => MangaProgressRepository.deleteMany(db, ids),
  },
  statuses: MANGA_STATUSES,
  afterSave: (ctx, id) => {
    void pushMangaEntry(ctx.db, ctx.mangaDb, id)
  },
  defaultStatus: 'Reading',
  add: {
    input: mangaLibraryAddInput(),
    build: (input, status) => {
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
      return {
        id,
        row: {
          id,
          provider: String(provider).toLowerCase(),
          mangaId: String(mangaId || idRaw || ''),
          title: String(input.title || ''),
          cover: String(input.cover || ''),
          status,
          author: input.author ? String(input.author) : undefined,
          altTitle: input.altTitle ? String(input.altTitle) : undefined,
          contentRating: input.contentRating ? String(input.contentRating) : undefined,
        },
      }
    },
  },
})

export const mangaLibraryRouter = router({
  ...shared,
  entry: protectedProcedure.input(mangaLibraryIdInput()).query(async ({ ctx, input }) => {
    const item = await MangaLibraryRepository.getById(ctx.mangaDb, input.id)
    if (!item) throw notFound('Not in library')
    return { item }
  }),

  link: protectedProcedure.input(mangaLibraryLinkInput()).mutation(async ({ ctx, input }) => {
    const targetId = typeof input.id === 'string' ? input.id : ''
    const mediaId = Number(input.anilistId)
    if (!targetId || !Number.isInteger(mediaId) || mediaId <= 0) {
      throw badRequest('id and a numeric anilistId are required')
    }
    const db = ctx.mangaDb
    const row = await MangaLibraryRepository.getById(db, targetId)
    if (!row) throw notFound('Library entry not found')
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
        const targetProgress = await MangaProgressRepository.getByKey(tx, targetId)
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
        await MangaProgressRepository.deleteByKey(tx, orphanId)
      }
    })
    return { success: true, id: targetId, progressMigrated }
  }),
})

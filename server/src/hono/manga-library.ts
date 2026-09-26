import type { Hono } from 'hono'
import logger from '../logger.js'
import type { DatabaseWrapper } from '../db.js'
import type { HonoDbs } from '../app-hono.js'
import { performMangaWriteTransactionAsync } from '../sync.js'
import { dbAll } from '../utils/db-utils.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import {
  buildMangaId,
  MANGA_STATUSES,
  MangaLibraryRepository,
  MangaProgressRepository,
} from '../repositories/manga.repository.js'

const MANGA_ADULT_RATINGS = ['erotica', 'pornographic']

const isMangaContinueAdult = (row: { contentRating?: string | null }) =>
  !!row.contentRating && MANGA_ADULT_RATINGS.includes(row.contentRating)

function mangaDb(dbs: HonoDbs): DatabaseWrapper {
  const db = dbs.mangaDb
  if (!db || db.isClosedCheck()) throw new Error('Manga database is not ready')
  return db
}

function normalizeId(provider: string, mangaId: string, idRaw?: string): string {
  if (idRaw && idRaw.includes(':')) return idRaw
  return buildMangaId(provider, mangaId || idRaw || '')
}

async function getAdultNonListMangaIds(db: DatabaseWrapper): Promise<string[]> {
  const rows = await dbAll<{ mangaId: string }>(
    db,
    `SELECT DISTINCT p.mangaId as mangaId
       FROM manga_progress p
       LEFT JOIN manga_library l ON l.id = p.mangaId
       WHERE COALESCE(l.contentRating, p.contentRating) IN ('erotica', 'pornographic')
         AND l.id IS NULL`
  )
  return rows.map((r) => r.mangaId)
}

export function registerMangaLibrary(app: Hono, getDbs: () => HonoDbs) {
  app.get('/api/manga/library', async (c) => {
    try {
      const page = Math.max(parseInt(c.req.query('page') as string) || 1, 1)
      const limit = Math.min(Math.max(parseInt(c.req.query('limit') as string) || 24, 1), 100)
      const offset = (page - 1) * limit
      const db = mangaDb(getDbs())
      const status = c.req.query('status') as string

      const rows = MangaLibraryRepository.getAll(db, status, limit, offset)
      const total = MangaLibraryRepository.getCount(db, status)

      return c.json({ data: rows, total, page, limit })
    } catch (err) {
      logger.error({ err }, 'Failed to get manga library')
      return c.json({ error: 'Failed to load manga library' }, 500)
    }
  })

  app.get('/api/manga/library/ids', async (c) => {
    try {
      return c.json({ ids: await MangaLibraryRepository.getIds(mangaDb(getDbs())) })
    } catch {
      return c.json({ ids: [] })
    }
  })

  app.get('/api/manga/library/check/:id', async (c) => {
    try {
      const item = await MangaLibraryRepository.getById(mangaDb(getDbs()), c.req.param('id'))
      return c.json({ inLibrary: !!item, status: item?.status ?? null })
    } catch {
      return c.json({ inLibrary: false, status: null })
    }
  })

  app.get('/api/manga/library/entry/:id', async (c) => {
    try {
      const item = await MangaLibraryRepository.getById(mangaDb(getDbs()), c.req.param('id'))
      if (!item) return c.json({ error: 'Not in library' }, 404)
      return c.json({ item })
    } catch {
      return c.json({ error: 'Failed to load entry' }, 500)
    }
  })

  app.post('/api/manga/library/add', async (c) => {
    const {
      provider,
      mangaId,
      id: idRaw,
      title,
      cover,
      status,
      author,
      altTitle,
      contentRating,
    } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!provider || (!mangaId && !idRaw)) {
      return c.json({ error: 'provider and mangaId are required' }, 400)
    }
    const id = normalizeId(
      String(provider),
      String(mangaId || ''),
      idRaw ? String(idRaw) : undefined
    )
    const cleanStatus =
      typeof status === 'string' && (MANGA_STATUSES as string[]).includes(status)
        ? status
        : 'Reading'
    try {
      await performMangaWriteTransactionAsync(mangaDb(getDbs()), async (tx) => {
        await MangaLibraryRepository.upsert(tx, {
          id,
          provider: String(provider).toLowerCase(),
          mangaId: String(mangaId || idRaw || ''),
          title: String(title || ''),
          cover: String(cover || ''),
          status: cleanStatus,
          author: author ? String(author) : undefined,
          altTitle: altTitle ? String(altTitle) : undefined,
          contentRating: contentRating ? String(contentRating) : undefined,
        })
      })
      return c.json({ success: true, id })
    } catch (err) {
      logger.error({ err }, 'Failed to add manga to library')
      return c.json({ error: 'Failed to bookmark manga' }, 500)
    }
  })

  app.post('/api/manga/library/remove', async (c) => {
    const { id } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!id) return c.json({ error: 'id is required' }, 400)
    try {
      await performMangaWriteTransactionAsync(mangaDb(getDbs()), async (tx) => {
        await MangaLibraryRepository.delete(tx, String(id))
        await MangaProgressRepository.deleteByManga(tx, String(id))
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove manga from library')
      return c.json({ error: 'Failed to remove bookmark' }, 500)
    }
  })

  app.post('/api/manga/library/status', async (c) => {
    const { id, status } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!id || !(MANGA_STATUSES as string[]).includes(status as string)) {
      return c.json({ error: 'id and a valid status are required' }, 400)
    }
    try {
      await performMangaWriteTransactionAsync(mangaDb(getDbs()), async (tx) => {
        await MangaLibraryRepository.updateStatus(tx, String(id), String(status))
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to update manga status')
      return c.json({ error: 'Failed to update status' }, 500)
    }
  })

  app.post('/api/manga/library/link', async (c) => {
    const { id, anilistId } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    const targetId = typeof id === 'string' ? id : ''
    const mediaId = Number(anilistId)
    if (!targetId || !Number.isInteger(mediaId) || mediaId <= 0) {
      return c.json({ error: 'id and a numeric anilistId are required' }, 400)
    }
    try {
      const db = mangaDb(getDbs())
      const row = await MangaLibraryRepository.getById(db, targetId)
      if (!row) return c.json({ error: 'Library entry not found' }, 404)
      if (String(row.provider).toLowerCase() === 'anilist') {
        return c.json(
          { error: 'Link a provider bookmark to the AniList entry, not the reverse' },
          400
        )
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
      return c.json({ success: true, id: targetId, progressMigrated })
    } catch (err) {
      logger.error({ err }, 'Failed to link manga to AniList')
      return c.json({ error: 'Failed to link entry' }, 500)
    }
  })

  app.post('/api/manga/library/batch-status', async (c) => {
    const { ids: idsRaw, status } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    if (!status || !(MANGA_STATUSES as string[]).includes(status as string)) {
      return c.json({ error: 'a valid status is required' }, 400)
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performMangaWriteTransactionAsync(mangaDb(getDbs()), async (tx) => {
        await MangaLibraryRepository.updateStatusMany(tx, ids, String(status))
      })
      return c.json({ success: true, updated: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch update manga status')
      return c.json({ error: 'Failed to update statuses' }, 500)
    }
  })

  app.post('/api/manga/library/remove-many', async (c) => {
    const { ids: idsRaw } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performMangaWriteTransactionAsync(mangaDb(getDbs()), async (tx) => {
        await MangaLibraryRepository.deleteMany(tx, ids)
        await MangaProgressRepository.deleteMany(tx, ids)
      })
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove manga')
      return c.json({ error: 'Failed to remove bookmarks' }, 500)
    }
  })

  app.post('/api/manga/progress/remove-many', async (c) => {
    const { ids: idsRaw } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performMangaWriteTransactionAsync(mangaDb(getDbs()), async (tx) => {
        await MangaProgressRepository.deleteMany(tx, ids)
      })
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove manga progress')
      return c.json({ error: 'Failed to reset progress' }, 500)
    }
  })

  app.get('/api/manga/progress/:mangaId', async (c) => {
    try {
      const rows = MangaProgressRepository.getByManga(mangaDb(getDbs()), c.req.param('mangaId'))
      return c.json({ progress: rows })
    } catch {
      return c.json({ progress: [] })
    }
  })

  app.get('/api/manga/progress/:mangaId/latest', async (c) => {
    try {
      const row = MangaProgressRepository.getLatest(mangaDb(getDbs()), c.req.param('mangaId'))
      return c.json(row || { page: 0, pageCount: 0 })
    } catch {
      return c.json({ page: 0, pageCount: 0 })
    }
  })

  app.post('/api/manga/progress', async (c) => {
    const {
      mangaId,
      chapterId,
      chapterNumber,
      page,
      pageCount,
      title,
      cover,
      provider,
      altTitle,
      contentRating,
    } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!mangaId || !chapterId) {
      return c.json({ error: 'mangaId and chapterId are required' }, 400)
    }
    const pageNum = Math.max(Number(page) || 0, 0)
    const pageCountNum = Math.max(Number(pageCount) || 0, 0)
    try {
      await performMangaWriteTransactionAsync(mangaDb(getDbs()), async (tx) => {
        await MangaProgressRepository.upsert(tx, {
          mangaId: String(mangaId),
          chapterId: String(chapterId),
          chapterNumber: String(chapterNumber || ''),
          page: pageNum,
          pageCount: pageCountNum,
          title: (title ?? null) as string | null,
          cover: (cover ?? null) as string | null,
          provider: (provider ?? null) as string | null,
          altTitle: (altTitle ?? null) as string | null,
          contentRating: (contentRating ?? null) as string | null,
        })
        await MangaLibraryRepository.touchProgress(tx, String(mangaId), {
          chapterId: String(chapterId),
          chapterNumber: String(chapterNumber || ''),
          page: pageNum,
        })
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to save manga progress')
      return c.json({ error: 'Failed to save progress' }, 500)
    }
  })

  app.post('/api/manga/progress/remove', async (c) => {
    const { mangaId, chapterId } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!mangaId) return c.json({ error: 'mangaId is required' }, 400)
    try {
      await performMangaWriteTransactionAsync(mangaDb(getDbs()), async (tx) => {
        if (chapterId) {
          await MangaProgressRepository.deleteChapter(tx, String(mangaId), String(chapterId))
        } else {
          await MangaProgressRepository.deleteByManga(tx, String(mangaId))
        }
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove manga progress')
      return c.json({ error: 'Failed to reset progress' }, 500)
    }
  })

  app.get('/api/manga/continue-reading', async (c) => {
    try {
      const dbs = getDbs()
      const limit = Math.min(Math.max(parseInt(c.req.query('limit') as string) || 24, 1), 100)
      const ignoreAdultRow = await SettingsRepository.getByKey(dbs.db, 'mangaIgnoreAdultContent')
      const ignoreAdult = ignoreAdultRow ? ignoreAdultRow.value !== 'false' : true
      const listOnlyRow = await SettingsRepository.getByKey(dbs.db, 'mangaCwWatchlistOnly')
      const listOnly = listOnlyRow
        ? listOnlyRow.value === 'true' || listOnlyRow.value === '1'
        : false
      const rows = (await MangaProgressRepository.getContinueReading(mangaDb(dbs), limit)).filter(
        (row) => {
          if (ignoreAdult && isMangaContinueAdult(row)) return false
          if (listOnly && row.watchlistStatus !== 'Reading') return false
          return true
        }
      )
      return c.json({ data: rows, total: rows.length })
    } catch {
      return c.json({ data: [], total: 0 })
    }
  })

  app.get('/api/manga/continue-reading/adult-count', async (c) => {
    try {
      const ids = await getAdultNonListMangaIds(mangaDb(getDbs()))
      return c.json({ count: ids.length })
    } catch {
      return c.json({ count: 0 })
    }
  })

  app.post('/api/manga/continue-reading/purge-adult', async (c) => {
    try {
      const db = mangaDb(getDbs())
      const ids = await getAdultNonListMangaIds(db)
      if (ids.length > 0) {
        await performMangaWriteTransactionAsync(db, async (tx) => {
          await MangaProgressRepository.deleteMany(tx, ids)
        })
      }
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to purge adult manga progress')
      return c.json({ error: 'Failed to purge adult entries' }, 500)
    }
  })
}

import { Request, Response } from 'express'
import logger from '../logger.js'
import { performMangaWriteTransaction } from '../sync.js'
import {
  buildMangaId,
  MANGA_STATUSES,
  MangaLibraryRepository,
  MangaProgressRepository,
} from '../repositories/manga.repository.js'

function mangaDb(req: Request) {
  const db = req.mangaDb
  if (!db || db.isClosedCheck()) throw new Error('Manga database is not ready')
  return db
}

function normalizeId(provider: string, mangaId: string, idRaw?: string): string {
  if (idRaw && idRaw.includes(':')) return idRaw
  return buildMangaId(provider, mangaId || idRaw || '')
}

export class MangaLibraryController {
  getLibrary = async (req: Request, res: Response) => {
    try {
      const { status, page: pageStr, limit: limitStr } = req.query
      const page = Math.max(parseInt(pageStr as string) || 1, 1)
      const limit = Math.min(Math.max(parseInt(limitStr as string) || 24, 1), 100)
      const offset = (page - 1) * limit
      const db = mangaDb(req)

      const rows = MangaLibraryRepository.getAll(db, status as string, limit, offset)
      const total = MangaLibraryRepository.getCount(db, status as string)

      res.json({ data: rows, total, page, limit })
    } catch (err) {
      logger.error({ err }, 'Failed to get manga library')
      res.status(500).json({ error: 'Failed to load manga library' })
    }
  }

  checkLibrary = async (req: Request, res: Response) => {
    try {
      const item = MangaLibraryRepository.getById(mangaDb(req), req.params.id as string)
      res.json({ inLibrary: !!item, status: item?.status ?? null })
    } catch {
      res.json({ inLibrary: false, status: null })
    }
  }

  getLibraryIds = async (req: Request, res: Response) => {
    try {
      res.json({ ids: MangaLibraryRepository.getIds(mangaDb(req)) })
    } catch {
      res.json({ ids: [] })
    }
  }

  addToLibrary = async (req: Request, res: Response) => {
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
    } = req.body ?? {}
    if (!provider || (!mangaId && !idRaw)) {
      return res.status(400).json({ error: 'provider and mangaId are required' })
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
      await performMangaWriteTransaction(mangaDb(req), (tx) => {
        MangaLibraryRepository.upsert(tx, {
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
      res.json({ success: true, id })
    } catch (err) {
      logger.error({ err }, 'Failed to add manga to library')
      res.status(500).json({ error: 'Failed to bookmark manga' })
    }
  }

  removeFromLibrary = async (req: Request, res: Response) => {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    try {
      await performMangaWriteTransaction(mangaDb(req), (tx) => {
        MangaLibraryRepository.delete(tx, String(id))
        MangaProgressRepository.deleteByManga(tx, String(id))
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove manga from library')
      res.status(500).json({ error: 'Failed to remove bookmark' })
    }
  }

  updateStatus = async (req: Request, res: Response) => {
    const { id, status } = req.body ?? {}
    if (!id || !(MANGA_STATUSES as string[]).includes(status)) {
      return res.status(400).json({ error: 'id and a valid status are required' })
    }
    try {
      await performMangaWriteTransaction(mangaDb(req), (tx) => {
        MangaLibraryRepository.updateStatus(tx, String(id), String(status))
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to update manga status')
      res.status(500).json({ error: 'Failed to update status' })
    }
  }

  getProgress = async (req: Request, res: Response) => {
    try {
      const rows = MangaProgressRepository.getByManga(mangaDb(req), req.params.mangaId as string)
      res.json({ progress: rows })
    } catch {
      res.json({ progress: [] })
    }
  }

  getLatestProgress = async (req: Request, res: Response) => {
    try {
      const row = MangaProgressRepository.getLatest(mangaDb(req), req.params.mangaId as string)
      res.json(row || { page: 0, pageCount: 0 })
    } catch {
      res.json({ page: 0, pageCount: 0 })
    }
  }

  saveProgress = async (req: Request, res: Response) => {
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
    } = req.body ?? {}
    if (!mangaId || !chapterId) {
      return res.status(400).json({ error: 'mangaId and chapterId are required' })
    }
    const pageNum = Math.max(Number(page) || 0, 0)
    const pageCountNum = Math.max(Number(pageCount) || 0, 0)
    try {
      await performMangaWriteTransaction(mangaDb(req), (tx) => {
        MangaProgressRepository.upsert(tx, {
          mangaId: String(mangaId),
          chapterId: String(chapterId),
          chapterNumber: String(chapterNumber || ''),
          page: pageNum,
          pageCount: pageCountNum,
          title: title ?? null,
          cover: cover ?? null,
          provider: provider ?? null,
          altTitle: altTitle ?? null,
          contentRating: contentRating ?? null,
        })
        MangaLibraryRepository.touchProgress(tx, String(mangaId), {
          chapterId: String(chapterId),
          chapterNumber: String(chapterNumber || ''),
          page: pageNum,
        })
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to save manga progress')
      res.status(500).json({ error: 'Failed to save progress' })
    }
  }

  getContinueReading = async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 24, 1), 100)
      const rows = MangaProgressRepository.getContinueReading(mangaDb(req), limit)
      res.json({ data: rows, total: rows.length })
    } catch {
      res.json({ data: [], total: 0 })
    }
  }

  removeProgress = async (req: Request, res: Response) => {
    const { mangaId, chapterId } = req.body ?? {}
    if (!mangaId) return res.status(400).json({ error: 'mangaId is required' })
    try {
      await performMangaWriteTransaction(mangaDb(req), (tx) => {
        if (chapterId) {
          MangaProgressRepository.deleteChapter(tx, String(mangaId), String(chapterId))
        } else {
          MangaProgressRepository.deleteByManga(tx, String(mangaId))
        }
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove manga progress')
      res.status(500).json({ error: 'Failed to reset progress' })
    }
  }
}

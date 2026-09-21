import { Request, Response } from 'express'
import logger from '../logger.js'
import { performTvWriteTransaction } from '../sync.js'
import {
  buildTvId,
  TV_STATUSES,
  TvLibraryRepository,
  TvProgressRepository,
} from '../repositories/tv.repository.js'

function tvDb(req: Request) {
  const db = req.tvDb
  if (!db || db.isClosedCheck()) throw new Error('TV database is not ready')
  return db
}

function normalizeMediaType(raw: unknown): 'movie' | 'tv' {
  return String(raw).toLowerCase() === 'movie' ? 'movie' : 'tv'
}

export class TvLibraryController {
  getLibrary = async (req: Request, res: Response) => {
    try {
      const { status, page: pageStr, limit: limitStr } = req.query
      const page = Math.max(parseInt(pageStr as string) || 1, 1)
      const limit = Math.min(Math.max(parseInt(limitStr as string) || 24, 1), 100)
      const offset = (page - 1) * limit
      const db = tvDb(req)

      const rows = TvLibraryRepository.getAll(db, status as string, limit, offset)
      const total = TvLibraryRepository.getCount(db, status as string)

      res.json({ data: rows, total, page, limit })
    } catch (err) {
      logger.error({ err }, 'Failed to get TV library')
      res.status(500).json({ error: 'Failed to load TV library' })
    }
  }

  checkLibrary = async (req: Request, res: Response) => {
    try {
      const item = TvLibraryRepository.getById(tvDb(req), req.params.id as string)
      res.json({ inLibrary: !!item, status: item?.status ?? null })
    } catch {
      res.json({ inLibrary: false, status: null })
    }
  }

  getLibraryIds = async (req: Request, res: Response) => {
    try {
      res.json({ ids: TvLibraryRepository.getIds(tvDb(req)) })
    } catch {
      res.json({ ids: [] })
    }
  }

  addToLibrary = async (req: Request, res: Response) => {
    const {
      tmdbId,
      mediaType: mediaTypeRaw,
      id: idRaw,
      title,
      poster,
      backdrop,
      year,
      overview,
      status,
      adult,
    } = req.body ?? {}
    const tmdbIdNum = Number(tmdbId)
    if (!tmdbIdNum || (!idRaw && !mediaTypeRaw)) {
      return res.status(400).json({ error: 'tmdbId and mediaType are required' })
    }
    const mediaType = normalizeMediaType(
      mediaTypeRaw || (String(idRaw).startsWith('movie:') ? 'movie' : 'tv')
    )
    const id =
      idRaw && String(idRaw).includes(':') ? String(idRaw) : buildTvId(mediaType, tmdbIdNum)
    const cleanStatus =
      typeof status === 'string' && (TV_STATUSES as string[]).includes(status) ? status : 'Watching'
    try {
      await performTvWriteTransaction(tvDb(req), (tx) => {
        TvLibraryRepository.upsert(tx, {
          id,
          tmdbId: tmdbIdNum,
          mediaType,
          title: String(title || ''),
          poster: String(poster || ''),
          backdrop: backdrop ? String(backdrop) : undefined,
          year: year ? String(year) : undefined,
          overview: overview ? String(overview) : undefined,
          status: cleanStatus,
          adult: adult === true,
        })
      })
      res.json({ success: true, id })
    } catch (err) {
      logger.error({ err }, 'Failed to add TV title to library')
      res.status(500).json({ error: 'Failed to add to TV watchlist' })
    }
  }

  removeFromLibrary = async (req: Request, res: Response) => {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    try {
      await performTvWriteTransaction(tvDb(req), (tx) => {
        TvLibraryRepository.delete(tx, String(id))
        TvProgressRepository.deleteByMedia(tx, String(id))
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove TV title from library')
      res.status(500).json({ error: 'Failed to remove from TV watchlist' })
    }
  }

  updateStatus = async (req: Request, res: Response) => {
    const { id, status } = req.body ?? {}
    if (!id || !(TV_STATUSES as string[]).includes(status)) {
      return res.status(400).json({ error: 'id and a valid status are required' })
    }
    try {
      await performTvWriteTransaction(tvDb(req), (tx) => {
        TvLibraryRepository.updateStatus(tx, String(id), String(status))
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to update TV status')
      res.status(500).json({ error: 'Failed to update status' })
    }
  }

  getProgress = async (req: Request, res: Response) => {
    try {
      const rows = TvProgressRepository.getByMedia(tvDb(req), req.params.mediaId as string)
      res.json({ progress: rows })
    } catch {
      res.json({ progress: [] })
    }
  }

  getLatestProgress = async (req: Request, res: Response) => {
    try {
      const row = TvProgressRepository.getLatest(tvDb(req), req.params.mediaId as string)
      res.json(row || { currentTime: 0, duration: 0 })
    } catch {
      res.json({ currentTime: 0, duration: 0 })
    }
  }

  saveProgress = async (req: Request, res: Response) => {
    const {
      mediaId,
      season,
      episode,
      currentTime,
      duration,
      title,
      poster,
      backdrop,
      year,
      overview,
      tmdbId,
      mediaType,
      adult,
    } = req.body ?? {}
    if (!mediaId) {
      return res.status(400).json({ error: 'mediaId is required' })
    }
    const seasonNum = Math.max(Number(season) || 1, 1)
    const episodeNum = Math.max(Number(episode) || 1, 1)
    const timeNum = Math.max(Number(currentTime) || 0, 0)
    const durationNum = Math.max(Number(duration) || 0, 0)
    try {
      await performTvWriteTransaction(tvDb(req), (tx) => {
        TvProgressRepository.upsert(tx, {
          mediaId: String(mediaId),
          season: Math.round(seasonNum),
          episode: Math.round(episodeNum),
          currentTime: timeNum,
          duration: durationNum,
          title: title ?? null,
          poster: poster ?? null,
          backdrop: backdrop ?? null,
          year: year ?? null,
          overview: overview ?? null,
          tmdbId: tmdbId != null ? Number(tmdbId) : null,
          mediaType: mediaType ?? null,
          adult: adult != null ? Number(adult) : null,
        })
        TvLibraryRepository.touchProgress(tx, String(mediaId), {
          season: Math.round(seasonNum),
          episode: Math.round(episodeNum),
        })
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to save TV progress')
      res.status(500).json({ error: 'Failed to save progress' })
    }
  }

  getContinueWatching = async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 24, 1), 100)
      const rows = TvProgressRepository.getContinueWatching(tvDb(req), limit)
      res.json({ data: rows, total: rows.length })
    } catch {
      res.json({ data: [], total: 0 })
    }
  }

  removeProgress = async (req: Request, res: Response) => {
    const { mediaId, season, episode } = req.body ?? {}
    if (!mediaId) return res.status(400).json({ error: 'mediaId is required' })
    try {
      await performTvWriteTransaction(tvDb(req), (tx) => {
        if (season !== undefined && episode !== undefined) {
          TvProgressRepository.deleteEpisode(tx, String(mediaId), Number(season), Number(episode))
        } else {
          TvProgressRepository.deleteByMedia(tx, String(mediaId))
        }
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove TV progress')
      res.status(500).json({ error: 'Failed to reset progress' })
    }
  }

  batchUpdateStatus = async (req: Request, res: Response) => {
    const { ids: idsRaw, status } = req.body ?? {}
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }
    if (!status || !(TV_STATUSES as string[]).includes(status)) {
      return res.status(400).json({ error: 'a valid status is required' })
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performTvWriteTransaction(tvDb(req), (tx) => {
        TvLibraryRepository.updateStatusMany(tx, ids, String(status))
      })
      res.json({ success: true, updated: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch update TV status')
      res.status(500).json({ error: 'Failed to update statuses' })
    }
  }

  batchRemove = async (req: Request, res: Response) => {
    const { ids: idsRaw } = req.body ?? {}
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performTvWriteTransaction(tvDb(req), (tx) => {
        TvLibraryRepository.deleteMany(tx, ids)
        TvProgressRepository.deleteMany(tx, ids)
      })
      res.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove TV titles')
      res.status(500).json({ error: 'Failed to remove from TV watchlist' })
    }
  }

  batchRemoveProgress = async (req: Request, res: Response) => {
    const { ids: idsRaw } = req.body ?? {}
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performTvWriteTransaction(tvDb(req), (tx) => {
        TvProgressRepository.deleteMany(tx, ids)
      })
      res.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove TV progress')
      res.status(500).json({ error: 'Failed to reset progress' })
    }
  }
}

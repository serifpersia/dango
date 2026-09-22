import { Request, Response } from 'express'
import logger from '../logger.js'
import type { DatabaseWrapper } from '../db.js'
import { performAsmrWriteTransaction } from '../sync.js'
import { dbAll } from '../utils/db-utils.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import {
  buildAsmrId,
  ASMR_STATUSES,
  AsmrLibraryRepository,
  AsmrProgressRepository,
} from '../repositories/asmr.repository.js'

function asmrDb(req: Request) {
  const db = req.asmrDb
  if (!db || db.isClosedCheck()) throw new Error('ASMR database is not ready')
  return db
}

export class AsmrLibraryController {
  getLibrary = async (req: Request, res: Response) => {
    try {
      const { status, page: pageStr, limit: limitStr } = req.query
      const page = Math.max(parseInt(pageStr as string) || 1, 1)
      const limit = Math.min(Math.max(parseInt(limitStr as string) || 24, 1), 100)
      const offset = (page - 1) * limit
      const db = asmrDb(req)

      const rows = AsmrLibraryRepository.getAll(db, status as string, limit, offset)
      const total = AsmrLibraryRepository.getCount(db, status as string)

      res.json({ data: rows, total, page, limit })
    } catch (err) {
      logger.error({ err }, 'Failed to get ASMR library')
      res.status(500).json({ error: 'Failed to load listening list' })
    }
  }

  checkLibrary = async (req: Request, res: Response) => {
    try {
      const item = AsmrLibraryRepository.getById(asmrDb(req), req.params.id as string)
      res.json({ inLibrary: !!item, status: item?.status ?? null })
    } catch {
      res.json({ inLibrary: false, status: null })
    }
  }

  getLibraryIds = async (req: Request, res: Response) => {
    try {
      res.json({ ids: AsmrLibraryRepository.getIds(asmrDb(req)) })
    } catch {
      res.json({ ids: [] })
    }
  }

  addToLibrary = async (req: Request, res: Response) => {
    const { rjCode, id: idRaw, title, thumbnail, status, isAdult } = req.body ?? {}
    const rawCode = String(rjCode || idRaw || '').trim()
    if (!rawCode) {
      return res.status(400).json({ error: 'rjCode is required' })
    }
    const id = idRaw && String(idRaw).trim() ? buildAsmrId(String(idRaw)) : buildAsmrId(rawCode)
    const cleanStatus =
      typeof status === 'string' && (ASMR_STATUSES as string[]).includes(status)
        ? status
        : 'Listening'
    try {
      await performAsmrWriteTransaction(asmrDb(req), (tx) => {
        AsmrLibraryRepository.upsert(tx, {
          id,
          rjCode: buildAsmrId(rawCode),
          title: String(title || ''),
          thumbnail: String(thumbnail || ''),
          status: cleanStatus,
          isAdult: isAdult === true || isAdult === 1,
        })
      })
      res.json({ success: true, id })
    } catch (err) {
      logger.error({ err }, 'Failed to add ASMR work to library')
      res.status(500).json({ error: 'Failed to add to listening list' })
    }
  }

  removeFromLibrary = async (req: Request, res: Response) => {
    const { id } = req.body ?? {}
    if (!id) return res.status(400).json({ error: 'id is required' })
    try {
      await performAsmrWriteTransaction(asmrDb(req), (tx) => {
        AsmrLibraryRepository.delete(tx, String(id))
        AsmrProgressRepository.deleteByWork(tx, String(id))
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove ASMR work from library')
      res.status(500).json({ error: 'Failed to remove from listening list' })
    }
  }

  updateStatus = async (req: Request, res: Response) => {
    const { id, status } = req.body ?? {}
    if (!id || !(ASMR_STATUSES as string[]).includes(status)) {
      return res.status(400).json({ error: 'id and a valid status are required' })
    }
    try {
      await performAsmrWriteTransaction(asmrDb(req), (tx) => {
        AsmrLibraryRepository.updateStatus(tx, String(id), String(status))
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to update ASMR status')
      res.status(500).json({ error: 'Failed to update status' })
    }
  }

  getProgress = async (req: Request, res: Response) => {
    try {
      const rows = AsmrProgressRepository.getByWork(asmrDb(req), req.params.workId as string)
      res.json({ progress: rows })
    } catch {
      res.json({ progress: [] })
    }
  }

  getLatestProgress = async (req: Request, res: Response) => {
    try {
      const row = AsmrProgressRepository.getLatest(asmrDb(req), req.params.workId as string)
      res.json(row || { currentTime: 0, duration: 0 })
    } catch {
      res.json({ currentTime: 0, duration: 0 })
    }
  }

  saveProgress = async (req: Request, res: Response) => {
    const {
      workId,
      trackIndex,
      trackLabel,
      currentTime,
      duration,
      title,
      thumbnail,
      rjCode,
      isAdult,
    } = req.body ?? {}
    if (!workId) {
      return res.status(400).json({ error: 'workId is required' })
    }
    const trackIndexNum = Math.max(Math.round(Number(trackIndex)) || 0, 0)
    const timeNum = Math.max(Number(currentTime) || 0, 0)
    const durationNum = Math.max(Number(duration) || 0, 0)
    try {
      await performAsmrWriteTransaction(asmrDb(req), (tx) => {
        AsmrProgressRepository.upsert(tx, {
          workId: String(workId),
          trackIndex: trackIndexNum,
          trackLabel: String(trackLabel || ''),
          currentTime: timeNum,
          duration: durationNum,
          title: title ?? null,
          thumbnail: thumbnail ?? null,
          rjCode: rjCode ?? null,
          isAdult: isAdult != null ? Number(isAdult) : null,
        })
        AsmrLibraryRepository.touchProgress(tx, String(workId), {
          trackIndex: trackIndexNum,
          trackLabel: String(trackLabel || ''),
          position: timeNum,
        })
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to save ASMR progress')
      res.status(500).json({ error: 'Failed to save progress' })
    }
  }

  getContinueListening = async (req: Request, res: Response) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 24, 1), 100)
      const ignoreAdultRow = await SettingsRepository.getByKey(req.db, 'asmrIgnoreAdultContent')
      const ignoreAdult = ignoreAdultRow ? ignoreAdultRow.value !== 'false' : true
      const listOnlyRow = await SettingsRepository.getByKey(req.db, 'asmrCwWatchlistOnly')
      const listOnly = listOnlyRow
        ? listOnlyRow.value === 'true' || listOnlyRow.value === '1'
        : false
      const rows = AsmrProgressRepository.getContinueListening(asmrDb(req), limit).filter((row) => {
        if (ignoreAdult && row.isAdult === 1) return false
        if (listOnly && row.watchlistStatus !== 'Listening') return false
        return true
      })
      res.json({ data: rows, total: rows.length })
    } catch {
      res.json({ data: [], total: 0 })
    }
  }

  private async getAdultNonListWorkIds(db: DatabaseWrapper): Promise<string[]> {
    const rows = await dbAll<{ workId: string }>(
      db,
      `SELECT DISTINCT p.workId as workId
       FROM asmr_progress p
       LEFT JOIN asmr_library l ON l.id = p.workId
       WHERE COALESCE(l.isAdult, p.isAdult) = 1
         AND l.id IS NULL`
    )
    return rows.map((r) => r.workId)
  }

  getAdultContinueListeningCount = async (req: Request, res: Response) => {
    try {
      const ids = await this.getAdultNonListWorkIds(asmrDb(req))
      res.json({ count: ids.length })
    } catch {
      res.json({ count: 0 })
    }
  }

  purgeAdultContinueListening = async (req: Request, res: Response) => {
    try {
      const ids = await this.getAdultNonListWorkIds(asmrDb(req))
      if (ids.length > 0) {
        await performAsmrWriteTransaction(asmrDb(req), (tx) => {
          for (const id of ids) AsmrProgressRepository.deleteByWork(tx, id)
        })
      }
      res.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to purge adult ASMR progress')
      res.status(500).json({ error: 'Failed to purge adult entries' })
    }
  }

  removeProgress = async (req: Request, res: Response) => {
    const { workId, trackIndex } = req.body ?? {}
    if (!workId) return res.status(400).json({ error: 'workId is required' })
    try {
      await performAsmrWriteTransaction(asmrDb(req), (tx) => {
        if (trackIndex !== undefined && trackIndex !== null) {
          AsmrProgressRepository.deleteTrack(tx, String(workId), Number(trackIndex))
        } else {
          AsmrProgressRepository.deleteByWork(tx, String(workId))
        }
      })
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove ASMR progress')
      res.status(500).json({ error: 'Failed to reset progress' })
    }
  }

  batchUpdateStatus = async (req: Request, res: Response) => {
    const { ids: idsRaw, status } = req.body ?? {}
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }
    if (!status || !(ASMR_STATUSES as string[]).includes(status)) {
      return res.status(400).json({ error: 'a valid status is required' })
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performAsmrWriteTransaction(asmrDb(req), (tx) => {
        AsmrLibraryRepository.updateStatusMany(tx, ids, String(status))
      })
      res.json({ success: true, updated: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch update ASMR status')
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
      await performAsmrWriteTransaction(asmrDb(req), (tx) => {
        AsmrLibraryRepository.deleteMany(tx, ids)
        AsmrProgressRepository.deleteMany(tx, ids)
      })
      res.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove ASMR works')
      res.status(500).json({ error: 'Failed to remove from listening list' })
    }
  }

  batchRemoveProgress = async (req: Request, res: Response) => {
    const { ids: idsRaw } = req.body ?? {}
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performAsmrWriteTransaction(asmrDb(req), (tx) => {
        AsmrProgressRepository.deleteMany(tx, ids)
      })
      res.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove ASMR progress')
      res.status(500).json({ error: 'Failed to reset progress' })
    }
  }
}

import type { Hono } from 'hono'
import logger from '../logger.js'
import type { DatabaseWrapper } from '../db.js'
import type { HonoDbs } from '../app-hono.js'
import { performAsmrWriteTransactionAsync } from '../sync.js'
import { dbAll } from '../utils/db-utils.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import {
  buildAsmrId,
  ASMR_STATUSES,
  AsmrLibraryRepository,
  AsmrProgressRepository,
} from '../repositories/asmr.repository.js'

function asmrDb(dbs: HonoDbs): DatabaseWrapper {
  const db = dbs.asmrDb
  if (!db || db.isClosedCheck()) throw new Error('ASMR database is not ready')
  return db
}

async function getAdultNonListWorkIds(db: DatabaseWrapper): Promise<string[]> {
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

export function registerAsmrLibrary(app: Hono, getDbs: () => HonoDbs) {
  app.get('/api/asmr/library', async (c) => {
    try {
      const page = Math.max(parseInt(c.req.query('page') as string) || 1, 1)
      const limit = Math.min(Math.max(parseInt(c.req.query('limit') as string) || 24, 1), 100)
      const offset = (page - 1) * limit
      const db = asmrDb(getDbs())
      const status = c.req.query('status') as string

      const rows = AsmrLibraryRepository.getAll(db, status, limit, offset)
      const total = AsmrLibraryRepository.getCount(db, status)

      return c.json({ data: rows, total, page, limit })
    } catch (err) {
      logger.error({ err }, 'Failed to get ASMR library')
      return c.json({ error: 'Failed to load listening list' }, 500)
    }
  })

  app.get('/api/asmr/library/ids', async (c) => {
    try {
      return c.json({ ids: await AsmrLibraryRepository.getIds(asmrDb(getDbs())) })
    } catch {
      return c.json({ ids: [] })
    }
  })

  app.get('/api/asmr/library/check/:id', async (c) => {
    try {
      const item = await AsmrLibraryRepository.getById(asmrDb(getDbs()), c.req.param('id'))
      return c.json({ inLibrary: !!item, status: item?.status ?? null })
    } catch {
      return c.json({ inLibrary: false, status: null })
    }
  })

  app.post('/api/asmr/library/add', async (c) => {
    const {
      rjCode,
      id: idRaw,
      title,
      thumbnail,
      status,
      isAdult,
    } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    const rawCode = String(rjCode || idRaw || '').trim()
    if (!rawCode) {
      return c.json({ error: 'rjCode is required' }, 400)
    }
    const id = idRaw && String(idRaw).trim() ? buildAsmrId(String(idRaw)) : buildAsmrId(rawCode)
    const cleanStatus =
      typeof status === 'string' && (ASMR_STATUSES as string[]).includes(status)
        ? status
        : 'Listening'
    try {
      await performAsmrWriteTransactionAsync(asmrDb(getDbs()), async (tx) => {
        await AsmrLibraryRepository.upsert(tx, {
          id,
          rjCode: buildAsmrId(rawCode),
          title: String(title || ''),
          thumbnail: String(thumbnail || ''),
          status: cleanStatus,
          isAdult: isAdult === true || isAdult === 1,
        })
      })
      return c.json({ success: true, id })
    } catch (err) {
      logger.error({ err }, 'Failed to add ASMR work to library')
      return c.json({ error: 'Failed to add to listening list' }, 500)
    }
  })

  app.post('/api/asmr/library/remove', async (c) => {
    const { id } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!id) return c.json({ error: 'id is required' }, 400)
    try {
      await performAsmrWriteTransactionAsync(asmrDb(getDbs()), async (tx) => {
        await AsmrLibraryRepository.delete(tx, String(id))
        await AsmrProgressRepository.deleteByWork(tx, String(id))
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove ASMR work from library')
      return c.json({ error: 'Failed to remove from listening list' }, 500)
    }
  })

  app.post('/api/asmr/library/status', async (c) => {
    const { id, status } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!id || !(ASMR_STATUSES as string[]).includes(status as string)) {
      return c.json({ error: 'id and a valid status are required' }, 400)
    }
    try {
      await performAsmrWriteTransactionAsync(asmrDb(getDbs()), async (tx) => {
        await AsmrLibraryRepository.updateStatus(tx, String(id), String(status))
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to update ASMR status')
      return c.json({ error: 'Failed to update status' }, 500)
    }
  })

  app.post('/api/asmr/library/batch-status', async (c) => {
    const { ids: idsRaw, status } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    if (!status || !(ASMR_STATUSES as string[]).includes(status as string)) {
      return c.json({ error: 'a valid status is required' }, 400)
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performAsmrWriteTransactionAsync(asmrDb(getDbs()), async (tx) => {
        await AsmrLibraryRepository.updateStatusMany(tx, ids, String(status))
      })
      return c.json({ success: true, updated: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch update ASMR status')
      return c.json({ error: 'Failed to update statuses' }, 500)
    }
  })

  app.post('/api/asmr/library/remove-many', async (c) => {
    const { ids: idsRaw } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performAsmrWriteTransactionAsync(asmrDb(getDbs()), async (tx) => {
        await AsmrLibraryRepository.deleteMany(tx, ids)
        await AsmrProgressRepository.deleteMany(tx, ids)
      })
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove ASMR works')
      return c.json({ error: 'Failed to remove from listening list' }, 500)
    }
  })

  app.post('/api/asmr/progress/remove-many', async (c) => {
    const { ids: idsRaw } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performAsmrWriteTransactionAsync(asmrDb(getDbs()), async (tx) => {
        await AsmrProgressRepository.deleteMany(tx, ids)
      })
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove ASMR progress')
      return c.json({ error: 'Failed to reset progress' }, 500)
    }
  })

  app.get('/api/asmr/progress/:workId', async (c) => {
    try {
      const rows = AsmrProgressRepository.getByWork(asmrDb(getDbs()), c.req.param('workId'))
      return c.json({ progress: rows })
    } catch {
      return c.json({ progress: [] })
    }
  })

  app.get('/api/asmr/progress/:workId/latest', async (c) => {
    try {
      const row = AsmrProgressRepository.getLatest(asmrDb(getDbs()), c.req.param('workId'))
      return c.json(row || { currentTime: 0, duration: 0 })
    } catch {
      return c.json({ currentTime: 0, duration: 0 })
    }
  })

  app.post('/api/asmr/progress', async (c) => {
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
    } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!workId) {
      return c.json({ error: 'workId is required' }, 400)
    }
    const trackIndexNum = Math.max(Math.round(Number(trackIndex)) || 0, 0)
    const timeNum = Math.max(Number(currentTime) || 0, 0)
    const durationNum = Math.max(Number(duration) || 0, 0)
    try {
      await performAsmrWriteTransactionAsync(asmrDb(getDbs()), async (tx) => {
        await AsmrProgressRepository.upsert(tx, {
          workId: String(workId),
          trackIndex: trackIndexNum,
          trackLabel: String(trackLabel || ''),
          currentTime: timeNum,
          duration: durationNum,
          title: (title ?? null) as string | null,
          thumbnail: (thumbnail ?? null) as string | null,
          rjCode: (rjCode ?? null) as string | null,
          isAdult: isAdult != null ? Number(isAdult) : null,
        })
        await AsmrLibraryRepository.touchProgress(tx, String(workId), {
          trackIndex: trackIndexNum,
          trackLabel: String(trackLabel || ''),
          position: timeNum,
        })
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to save ASMR progress')
      return c.json({ error: 'Failed to save progress' }, 500)
    }
  })

  app.post('/api/asmr/progress/remove', async (c) => {
    const { workId, trackIndex } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!workId) return c.json({ error: 'workId is required' }, 400)
    try {
      await performAsmrWriteTransactionAsync(asmrDb(getDbs()), async (tx) => {
        if (trackIndex !== undefined && trackIndex !== null) {
          await AsmrProgressRepository.deleteTrack(tx, String(workId), Number(trackIndex))
        } else {
          await AsmrProgressRepository.deleteByWork(tx, String(workId))
        }
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove ASMR progress')
      return c.json({ error: 'Failed to reset progress' }, 500)
    }
  })

  app.get('/api/asmr/continue-listening', async (c) => {
    try {
      const dbs = getDbs()
      const limit = Math.min(Math.max(parseInt(c.req.query('limit') as string) || 24, 1), 100)
      const ignoreAdultRow = await SettingsRepository.getByKey(dbs.db, 'asmrIgnoreAdultContent')
      const ignoreAdult = ignoreAdultRow ? ignoreAdultRow.value !== 'false' : true
      const listOnlyRow = await SettingsRepository.getByKey(dbs.db, 'asmrCwWatchlistOnly')
      const listOnly = listOnlyRow
        ? listOnlyRow.value === 'true' || listOnlyRow.value === '1'
        : false
      const rows = (await AsmrProgressRepository.getContinueListening(asmrDb(dbs), limit)).filter(
        (row) => {
          if (ignoreAdult && row.isAdult === 1) return false
          if (listOnly && row.watchlistStatus !== 'Listening') return false
          return true
        }
      )
      return c.json({ data: rows, total: rows.length })
    } catch {
      return c.json({ data: [], total: 0 })
    }
  })

  app.get('/api/asmr/continue-listening/adult-count', async (c) => {
    try {
      const ids = await getAdultNonListWorkIds(asmrDb(getDbs()))
      return c.json({ count: ids.length })
    } catch {
      return c.json({ count: 0 })
    }
  })

  app.post('/api/asmr/continue-listening/purge-adult', async (c) => {
    try {
      const db = asmrDb(getDbs())
      const ids = await getAdultNonListWorkIds(db)
      if (ids.length > 0) {
        await performAsmrWriteTransactionAsync(db, async (tx) => {
          for (const id of ids) await AsmrProgressRepository.deleteByWork(tx, id)
        })
      }
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to purge adult ASMR progress')
      return c.json({ error: 'Failed to purge adult entries' }, 500)
    }
  })
}

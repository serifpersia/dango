import type { Hono } from 'hono'
import logger from '../logger.js'
import type { DatabaseWrapper } from '../db.js'
import type { HonoDbs } from '../app-hono.js'
import { performTvWriteTransaction } from '../sync.js'
import { dbAll } from '../utils/db-utils.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import {
  buildTvId,
  normalizeTvMediaId,
  TV_STATUSES,
  TvLibraryRepository,
  TvProgressRepository,
} from '../repositories/tv.repository.js'

const isTvContinueAdult = (row: { adult?: boolean | number | null }) =>
  row.adult === true || row.adult === 1

function tvDb(dbs: HonoDbs): DatabaseWrapper {
  const db = dbs.tvDb
  if (!db || db.isClosedCheck()) throw new Error('TV database is not ready')
  return db
}

function normalizeMediaType(raw: unknown): 'movie' | 'tv' {
  return String(raw).toLowerCase() === 'movie' ? 'movie' : 'tv'
}

async function getAdultNonListMediaIds(db: DatabaseWrapper): Promise<string[]> {
  const rows = await dbAll<{ mediaId: string }>(
    db,
    `SELECT DISTINCT p.mediaId as mediaId
       FROM tv_progress p
       LEFT JOIN tv_library l ON l.id = p.mediaId
       WHERE COALESCE(l.adult, p.adult) = 1
         AND l.id IS NULL`
  )
  return rows.map((r) => r.mediaId)
}

export function registerTvLibrary(app: Hono, getDbs: () => HonoDbs) {
  app.get('/api/tv/library', async (c) => {
    try {
      const page = Math.max(parseInt(c.req.query('page') as string) || 1, 1)
      const limit = Math.min(Math.max(parseInt(c.req.query('limit') as string) || 24, 1), 100)
      const offset = (page - 1) * limit
      const db = tvDb(getDbs())
      const status = c.req.query('status') as string

      const rows = TvLibraryRepository.getAll(db, status, limit, offset)
      const total = TvLibraryRepository.getCount(db, status)

      return c.json({ data: rows, total, page, limit })
    } catch (err) {
      logger.error({ err }, 'Failed to get TV library')
      return c.json({ error: 'Failed to load TV library' }, 500)
    }
  })

  app.get('/api/tv/library/ids', async (c) => {
    try {
      return c.json({ ids: TvLibraryRepository.getIds(tvDb(getDbs())) })
    } catch {
      return c.json({ ids: [] })
    }
  })

  app.get('/api/tv/library/check/:id', async (c) => {
    try {
      const item = TvLibraryRepository.getById(tvDb(getDbs()), c.req.param('id'))
      return c.json({ inLibrary: !!item, status: item?.status ?? null })
    } catch {
      return c.json({ inLibrary: false, status: null })
    }
  })

  app.post('/api/tv/library/add', async (c) => {
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
    } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    const tmdbIdNum = Number(tmdbId)
    if (!tmdbIdNum || (!idRaw && !mediaTypeRaw)) {
      return c.json({ error: 'tmdbId and mediaType are required' }, 400)
    }
    const mediaType = normalizeMediaType(
      mediaTypeRaw || (String(idRaw).startsWith('movie:') ? 'movie' : 'tv')
    )
    const id =
      idRaw && String(idRaw).includes(':') ? String(idRaw) : buildTvId(mediaType, tmdbIdNum)
    const cleanStatus =
      typeof status === 'string' && (TV_STATUSES as string[]).includes(status) ? status : 'Watching'
    try {
      await performTvWriteTransaction(tvDb(getDbs()), (tx) => {
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
      return c.json({ success: true, id })
    } catch (err) {
      logger.error({ err }, 'Failed to add TV title to library')
      return c.json({ error: 'Failed to add to TV watchlist' }, 500)
    }
  })

  app.post('/api/tv/library/remove', async (c) => {
    const { id } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!id) return c.json({ error: 'id is required' }, 400)
    try {
      await performTvWriteTransaction(tvDb(getDbs()), (tx) => {
        TvLibraryRepository.delete(tx, String(id))
        TvProgressRepository.deleteByMedia(tx, String(id))
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove TV title from library')
      return c.json({ error: 'Failed to remove from TV watchlist' }, 500)
    }
  })

  app.post('/api/tv/library/status', async (c) => {
    const { id, status } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!id || !(TV_STATUSES as string[]).includes(status as string)) {
      return c.json({ error: 'id and a valid status are required' }, 400)
    }
    try {
      await performTvWriteTransaction(tvDb(getDbs()), (tx) => {
        TvLibraryRepository.updateStatus(tx, String(id), String(status))
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to update TV status')
      return c.json({ error: 'Failed to update status' }, 500)
    }
  })

  app.post('/api/tv/library/batch-status', async (c) => {
    const { ids: idsRaw, status } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    if (!status || !(TV_STATUSES as string[]).includes(status as string)) {
      return c.json({ error: 'a valid status is required' }, 400)
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performTvWriteTransaction(tvDb(getDbs()), (tx) => {
        TvLibraryRepository.updateStatusMany(tx, ids, String(status))
      })
      return c.json({ success: true, updated: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch update TV status')
      return c.json({ error: 'Failed to update statuses' }, 500)
    }
  })

  app.post('/api/tv/library/remove-many', async (c) => {
    const { ids: idsRaw } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    const ids = idsRaw.map((id) => String(id))
    try {
      await performTvWriteTransaction(tvDb(getDbs()), (tx) => {
        TvLibraryRepository.deleteMany(tx, ids)
        TvProgressRepository.deleteMany(tx, ids)
      })
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove TV titles')
      return c.json({ error: 'Failed to remove from TV watchlist' }, 500)
    }
  })

  app.post('/api/tv/progress/remove-many', async (c) => {
    const { ids: idsRaw } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<
      string,
      unknown
    >
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    const ids = idsRaw.map((id) => normalizeTvMediaId(id as string))
    try {
      await performTvWriteTransaction(tvDb(getDbs()), (tx) => {
        TvProgressRepository.deleteMany(tx, ids)
      })
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to batch remove TV progress')
      return c.json({ error: 'Failed to reset progress' }, 500)
    }
  })

  app.get('/api/tv/progress/:mediaId', async (c) => {
    try {
      const rows = TvProgressRepository.getByMedia(
        tvDb(getDbs()),
        normalizeTvMediaId(c.req.param('mediaId'))
      )
      return c.json({ progress: rows })
    } catch {
      return c.json({ progress: [] })
    }
  })

  app.get('/api/tv/progress/:mediaId/latest', async (c) => {
    try {
      const db = tvDb(getDbs())
      const mediaId = normalizeTvMediaId(c.req.param('mediaId'))
      const season = parseInt(c.req.query('season') as string, 10)
      const episode = parseInt(c.req.query('episode') as string, 10)
      if (Number.isFinite(season) && Number.isFinite(episode)) {
        const row = TvProgressRepository.getEpisode(db, mediaId, season, episode)
        return c.json(row || { currentTime: 0, duration: 0, completed: 0 })
      }
      const row = TvProgressRepository.getLatest(db, mediaId)
      return c.json(row || { currentTime: 0, duration: 0, completed: 0 })
    } catch {
      return c.json({ currentTime: 0, duration: 0, completed: 0 })
    }
  })

  app.post('/api/tv/progress', async (c) => {
    const {
      mediaId: mediaIdRaw,
      season,
      episode,
      currentTime,
      duration,
      completed,
      title,
      poster,
      backdrop,
      year,
      overview,
      tmdbId,
      mediaType,
      adult,
    } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    const mediaId = normalizeTvMediaId(mediaIdRaw as string)
    if (!mediaId) {
      return c.json({ error: 'mediaId is required' }, 400)
    }
    const seasonNum = Math.max(Number(season) || 1, 1)
    const episodeNum = Math.max(Number(episode) || 1, 1)
    const timeNum = Math.max(Number(currentTime) || 0, 0)
    const durationNum = Math.max(Number(duration) || 0, 0)
    const clampedTime = durationNum > 0 ? Math.min(timeNum, durationNum) : timeNum
    const storedTime =
      durationNum > 0 && clampedTime >= durationNum * 0.8 ? durationNum : clampedTime
    const completedNow =
      Number(completed) === 1 || (durationNum > 0 && storedTime >= durationNum * 0.8) ? 1 : 0
    try {
      await performTvWriteTransaction(tvDb(getDbs()), (tx) => {
        TvProgressRepository.upsert(tx, {
          mediaId: String(mediaId),
          season: Math.round(seasonNum),
          episode: Math.round(episodeNum),
          currentTime: storedTime,
          duration: durationNum,
          completed: completedNow,
          title: (title ?? null) as string | null,
          poster: (poster ?? null) as string | null,
          backdrop: (backdrop ?? null) as string | null,
          year: (year ?? null) as string | null,
          overview: (overview ?? null) as string | null,
          tmdbId: tmdbId != null ? Number(tmdbId) : null,
          mediaType: (mediaType ?? null) as string | null,
          adult: adult != null ? Number(adult) : null,
        })
        TvLibraryRepository.touchProgress(tx, String(mediaId), {
          season: Math.round(seasonNum),
          episode: Math.round(episodeNum),
        })
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to save TV progress')
      return c.json({ error: 'Failed to save progress' }, 500)
    }
  })

  app.post('/api/tv/progress/remove', async (c) => {
    const {
      mediaId: mediaIdRaw,
      season,
      episode,
    } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    const mediaId = normalizeTvMediaId(mediaIdRaw as string)
    if (!mediaId) return c.json({ error: 'mediaId is required' }, 400)
    try {
      await performTvWriteTransaction(tvDb(getDbs()), (tx) => {
        if (season !== undefined && episode !== undefined) {
          TvProgressRepository.deleteEpisode(tx, String(mediaId), Number(season), Number(episode))
        } else {
          TvProgressRepository.deleteByMedia(tx, String(mediaId))
        }
      })
      return c.json({ success: true })
    } catch (err) {
      logger.error({ err }, 'Failed to remove TV progress')
      return c.json({ error: 'Failed to reset progress' }, 500)
    }
  })

  app.get('/api/tv/continue-watching', async (c) => {
    try {
      const dbs = getDbs()
      const limit = Math.min(Math.max(parseInt(c.req.query('limit') as string) || 24, 1), 100)
      const ignoreAdultRow = await SettingsRepository.getByKey(dbs.db, 'tvIgnoreAdultContent')
      const ignoreAdult = ignoreAdultRow ? ignoreAdultRow.value !== 'false' : true
      const listOnlyRow = await SettingsRepository.getByKey(dbs.db, 'tvCwWatchlistOnly')
      const listOnly = listOnlyRow
        ? listOnlyRow.value === 'true' || listOnlyRow.value === '1'
        : false
      const rows = TvProgressRepository.getContinueWatching(tvDb(dbs), limit).filter((row) => {
        if (ignoreAdult && isTvContinueAdult(row)) return false
        if (listOnly && row.watchlistStatus !== 'Watching') return false
        return true
      })
      return c.json({ data: rows, total: rows.length })
    } catch {
      return c.json({ data: [], total: 0 })
    }
  })

  app.get('/api/tv/continue-watching/adult-count', async (c) => {
    try {
      const ids = await getAdultNonListMediaIds(tvDb(getDbs()))
      return c.json({ count: ids.length })
    } catch {
      return c.json({ count: 0 })
    }
  })

  app.post('/api/tv/continue-watching/purge-adult', async (c) => {
    try {
      const db = tvDb(getDbs())
      const ids = await getAdultNonListMediaIds(db)
      if (ids.length > 0) {
        await performTvWriteTransaction(db, (tx) => {
          for (const id of ids) TvProgressRepository.deleteByMedia(tx, id)
        })
      }
      return c.json({ success: true, removed: ids.length })
    } catch (err) {
      logger.error({ err }, 'Failed to purge adult TV progress')
      return c.json({ error: 'Failed to purge adult entries' }, 500)
    }
  })
}

import logger from '../logger.js'
import type { DatabaseWrapper } from '../db.js'
import { WatchlistRepository } from '../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../repositories/watched-episodes.repository.js'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository.js'
import { NotificationsRepository } from '../repositories/notifications.repository.js'
import { dbAll } from '../utils/db-utils.js'
import { AppCache } from '../utils/cache.utils.js'
import {
  getAiredEpisodesForShows,
  isAnilistRateLimited,
  batchGetShowStatuses,
} from '../lib/anilist.js'
import { parseJsonBody } from '../utils/http.utils.js'
import { pickBestMatch } from '../providers/title-matching.js'

const BACKGROUND_DISCOVERY_INTERVAL_MS = 5 * 60 * 1000
const NUDGE_THROTTLE_MS = 120 * 1000
const SLOW_MAX_RUN_MS = 5 * 60 * 1000

let discoveryIntervalId: ReturnType<typeof setInterval> | null = null
let lastExternalDiscoveryAt = 0
let discoveryBusy = false
let lastDiscoveryRunAt = 0
let discoveryState: 'idle' | 'running' | 'complete' | 'empty' | 'error' = 'idle'
let discoveryTotal = 0
let discoveryDone = 0
let discoveryStopped = false
let triggerImpl: (() => boolean) | null = null

export function triggerWatchlistDiscovery(): boolean {
  return triggerImpl?.() ?? false
}

export function stopWatchlistDiscovery(): void {
  discoveryStopped = true
  if (discoveryIntervalId !== null) {
    clearInterval(discoveryIntervalId)
    discoveryIntervalId = null
  }
}

export function getWatchlistDiscoveryStatus(): {
  running: boolean
  state: 'idle' | 'running' | 'complete' | 'empty' | 'error'
  total: number
  done: number
  lastRunAt: number
} {
  return {
    running: discoveryBusy,
    state: discoveryState,
    total: discoveryTotal,
    done: Math.min(discoveryDone, discoveryTotal),
    lastRunAt: lastDiscoveryRunAt,
  }
}

export function startWatchlistDiscovery(getDb: () => DatabaseWrapper): void {
  const anilistIdCache = new Map<string, number | null>()

  const getAnilistId = async (showId: string): Promise<number | null> => {
    if (anilistIdCache.has(showId)) {
      return anilistIdCache.get(showId) || null
    }

    const db = getDb()
    const meta = (await ShowsMetaRepository.getById(db, showId)) as { anilistId?: number } | null
    if (meta?.anilistId) {
      anilistIdCache.set(showId, meta.anilistId)
      return meta.anilistId
    }

    if (/^\d+$/.test(showId)) {
      const numericId = parseInt(showId)
      anilistIdCache.set(showId, numericId)
      return numericId
    }

    anilistIdCache.set(showId, null)
    return null
  }

  const runDiscovery = async (fast = false): Promise<void> => {
    if (discoveryBusy || discoveryStopped) return
    discoveryBusy = true
    discoveryState = 'running'
    discoveryTotal = 0
    discoveryDone = 0

    const db = getDb()
    if (!db || db.isClosedCheck()) {
      discoveryBusy = false
      return
    }

    const startedAt = Date.now()
    const MAX_RUN_MS = fast ? 90000 : SLOW_MAX_RUN_MS

    try {
      const watchingShows = await WatchlistRepository.getWatchingShows(db)
      discoveryTotal = watchingShows.length
      if (watchingShows.length === 0) {
        discoveryBusy = false
        return
      }

      const showIdMap = new Map<string, number>()
      const MAP_CONCURRENCY = fast ? 4 : 2
      const anilistResults: { show: (typeof watchingShows)[number]; id: number | null }[] = []
      let nextIndex = 0
      const worker = async (): Promise<void> => {
        while (nextIndex < watchingShows.length) {
          if (Date.now() - startedAt > MAX_RUN_MS) return
          const show = watchingShows[nextIndex]
          nextIndex += 1
          const id = await getAnilistId(show.id)
          discoveryDone += 1
          anilistResults.push({ show, id })
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(MAP_CONCURRENCY, watchingShows.length) }, () => worker())
      )
      for (const { show, id } of anilistResults) {
        if (id) {
          showIdMap.set(show.id, id)
        }
      }

      if (Date.now() - startedAt > MAX_RUN_MS || showIdMap.size === 0) {
        discoveryBusy = false
        return
      }

      const now = new Date()
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - 7)
      weekStart.setHours(0, 0, 0, 0)
      const weekEnd = new Date(now)
      weekEnd.setHours(23, 59, 59, 999)

      const schedules = await getAiredEpisodesForShows(
        Array.from(showIdMap.values()),
        weekStart,
        weekEnd
      )

      const nowUnix = Math.floor(Date.now() / 1000)
      const reverseMap = new Map<number, string>()
      for (const [watchlistId, anilistId] of showIdMap.entries()) {
        reverseMap.set(anilistId, watchlistId)
      }

      const finishedShowIds = new Set<number>()
      const unresolvedStatus: { watchlistId: string; anilistId: number }[] = []
      for (const [watchlistId, anilistId] of showIdMap.entries()) {
        const localMeta = (await ShowsMetaRepository.getById(db, watchlistId)) as {
          status?: string
        } | null
        if (localMeta?.status === 'FINISHED') {
          finishedShowIds.add(anilistId)
        } else if (!localMeta?.status) {
          unresolvedStatus.push({ watchlistId, anilistId })
        }
      }

      if (unresolvedStatus.length > 0 && !isAnilistRateLimited()) {
        const statuses = await batchGetShowStatuses(unresolvedStatus.map((s) => s.anilistId))
        let persisted = 0
        for (const { watchlistId, anilistId } of unresolvedStatus) {
          const status = statuses.get(anilistId)
          if (status === 'FINISHED') {
            finishedShowIds.add(anilistId)
            await ShowsMetaRepository.upsert(db, { id: watchlistId, status: 'FINISHED' })
            persisted++
          } else if (status) {
            await ShowsMetaRepository.upsert(db, { id: watchlistId, status })
            persisted++
          }
        }
      }

      if (finishedShowIds.size > 0) {
        const monthStart = new Date(now)
        monthStart.setDate(now.getDate() - 30)
        monthStart.setHours(0, 0, 0, 0)
        const monthEnd = new Date(now)
        monthEnd.setHours(23, 59, 59, 999)

        const finishedSchedules = await getAiredEpisodesForShows(
          Array.from(finishedShowIds),
          monthStart,
          monthEnd
        )

        const finishedEpisodesByShow = new Map<string, { episodeKey: string; airingAt: number }[]>()
        const seenFinishedKeys = new Set<string>()
        for (const entry of finishedSchedules) {
          if (entry.airingAt > nowUnix) continue
          const watchlistId = reverseMap.get(entry.mediaId)
          if (!watchlistId) continue
          const episodeKey = String(Math.round(entry.episode))
          const dedupeKey = `${watchlistId}:${episodeKey}`
          if (seenFinishedKeys.has(dedupeKey)) continue
          seenFinishedKeys.add(dedupeKey)
          const list = finishedEpisodesByShow.get(watchlistId)
          if (list) list.push({ episodeKey, airingAt: entry.airingAt })
          else finishedEpisodesByShow.set(watchlistId, [{ episodeKey, airingAt: entry.airingAt }])
        }

        for (const [watchlistId, episodes] of finishedEpisodesByShow) {
          const [watchedEps, dismissedEps] = await Promise.all([
            WatchedEpisodesRepository.getWatchedEpisodeNumbers(db, watchlistId),
            NotificationsRepository.getDismissedByShow(db, watchlistId),
          ])

          const watchedSet = new Set(watchedEps.map((e) => e.toString()))
          const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

          for (const { episodeKey, airingAt } of episodes) {
            if (nowUnix - airingAt > 30 * 24 * 60 * 60) continue
            if (!watchedSet.has(episodeKey) && !dismissedSet.has(episodeKey)) {
              await NotificationsRepository.addDiscovered(db, watchlistId, episodeKey)
            }
          }
        }
      }

      const episodesByShow = new Map<string, { episodeKey: string; airingAt: number }[]>()
      const seenEpisodeKeys = new Set<string>()
      for (const entry of schedules) {
        if (entry.airingAt > nowUnix) continue

        const watchlistId = reverseMap.get(entry.mediaId)
        if (!watchlistId) continue

        const episodeKey = String(Math.round(entry.episode))
        const dedupeKey = `${watchlistId}:${episodeKey}`
        if (seenEpisodeKeys.has(dedupeKey)) continue
        seenEpisodeKeys.add(dedupeKey)
        const list = episodesByShow.get(watchlistId)
        if (list) list.push({ episodeKey, airingAt: entry.airingAt })
        else episodesByShow.set(watchlistId, [{ episodeKey, airingAt: entry.airingAt }])
      }

      for (const [watchlistId, episodes] of episodesByShow) {
        const [watchedEps, dismissedEps] = await Promise.all([
          WatchedEpisodesRepository.getWatchedEpisodeNumbers(db, watchlistId),
          NotificationsRepository.getDismissedByShow(db, watchlistId),
        ])

        const watchedSet = new Set(watchedEps.map((e) => e.toString()))
        const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

        for (const { episodeKey } of episodes) {
          if (!watchedSet.has(episodeKey) && !dismissedSet.has(episodeKey)) {
            await NotificationsRepository.addDiscovered(db, watchlistId, episodeKey)
          }
        }
      }

      await NotificationsRepository.cleanupWatchedNotifications(db)
    } catch (e) {
      discoveryState = 'error'
      if ((e as Error)?.message === 'Database is closed') {
        logger.info('Notification discovery stopped: database is closed')
      } else {
        logger.error({ err: e }, 'AniList notification discovery failed')
      }
    } finally {
      discoveryBusy = false
      lastDiscoveryRunAt = Date.now()
      if (discoveryState === 'running') {
        discoveryState = discoveryTotal === 0 ? 'empty' : 'complete'
      }
    }
  }

  triggerImpl = () => {
    if (discoveryStopped || discoveryBusy) return false
    if (Date.now() - lastExternalDiscoveryAt < NUDGE_THROTTLE_MS) return false
    lastExternalDiscoveryAt = Date.now()
    runDiscovery(true)
    return true
  }

  discoveryIntervalId = setInterval(() => {
    if (!discoveryStopped) runDiscovery(false)
  }, BACKGROUND_DISCOVERY_INTERVAL_MS)
}

export async function getAdultNonWatchlistShowIds(db: DatabaseWrapper): Promise<string[]> {
  const rows = await dbAll<{ showId: string }>(
    db,
    `SELECT DISTINCT we.showId as showId
     FROM watched_episodes we
     JOIN shows_meta sm ON sm.id = we.showId AND sm.isAdult = 1
     LEFT JOIN watchlist w ON w.id = we.showId
     WHERE w.id IS NULL`
  )
  return rows.map((r) => r.showId)
}

const dlsitePosterCache = new AppCache({ ttlSeconds: 3600, maxKeys: 2000 })
const mangadexCoverCache = new AppCache({ ttlSeconds: 3600, maxKeys: 2000 })

export async function getMangadexCover(title: string): Promise<string | null> {
  const key = title.trim().toLowerCase()
  if (!key) return null
  const cached = mangadexCoverCache.get<string | null>(key)
  if (cached !== undefined) return cached
  try {
    const params = new URLSearchParams({
      title: title.trim(),
      limit: '5',
      'includes[]': 'cover_art',
      'order[relevance]': 'desc',
    })
    for (const r of ['safe', 'suggestive', 'erotica', 'pornographic']) {
      params.append('contentRating[]', r)
    }
    const res = await fetch(`https://api.mangadex.org/manga?${params.toString()}`, {
      headers: { 'User-Agent': 'Dango/3.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = (await parseJsonBody(res)) as {
      data?: Array<{
        id: string
        attributes?: { title?: Record<string, string>; altTitles?: Record<string, string>[] }
        relationships?: Array<{ type: string; attributes?: { fileName?: string } }>
      }>
    }
    const candidates: Array<{ title: string; cover: string }> = []
    for (const m of data.data || []) {
      const fileName = m.relationships?.find((r) => r.type === 'cover_art')?.attributes?.fileName
      if (!fileName) continue
      const cover = `https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`
      const main = m.attributes?.title
      const mainTitle = main?.en || main?.['ja-ro'] || Object.values(main || {})[0]
      if (mainTitle) candidates.push({ title: mainTitle, cover })
      for (const alt of m.attributes?.altTitles || []) {
        const t = Object.values(alt)[0]
        if (t) candidates.push({ title: t, cover })
      }
    }
    const match = pickBestMatch(candidates, [title])
    const url = match ? match.item.cover : null
    mangadexCoverCache.set(key, url)
    return url
  } catch {
    return null
  }
}

export async function getDlsitePoster(rjCode: string): Promise<string | null> {
  const key = String(rjCode).trim().toUpperCase()
  if (!/^RJ\d{5,}$/.test(key)) return null
  const cached = dlsitePosterCache.get<string>(key)
  if (cached !== undefined) return cached
  try {
    const res = await fetch(`https://www.dlsite.com/maniax/product/info/ajax?product_id=${key}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const raw = (await parseJsonBody(res)) as unknown
    const data = raw as Record<string, unknown>
    const entryRaw = (data[key] ?? data) as unknown
    const entry = entryRaw as { work_image?: unknown }
    const img: string | undefined =
      typeof entry?.work_image === 'string' ? entry.work_image : undefined
    if (!img) return null
    const url = img.startsWith('//') ? `https:${img}` : img
    dlsitePosterCache.set(key, url)
    return url
  } catch {
    return null
  }
}

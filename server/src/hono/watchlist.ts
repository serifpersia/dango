import type { Hono } from 'hono'
import logger from '../logger.js'
import type { DatabaseWrapper } from '../db.js'
import type { HonoDbs } from '../app-hono.js'
import { performWriteTransaction } from '../sync.js'
import { WatchlistRepository } from '../repositories/watchlist.repository.js'
import {
  WatchedEpisodesRepository,
  type ContinueWatchingResult,
  type WatchedEpisode,
} from '../repositories/watched-episodes.repository.js'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository.js'
import { NotificationsRepository } from '../repositories/notifications.repository.js'
import { QueueRepository } from '../repositories/queue.repository.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import { discordRPCService } from '../discord-rpc.js'
import { dbAll, dbGet } from '../utils/db-utils.js'
import {
  searchAnilist,
  searchAnilistByTitle,
  getAiredEpisodesForShows,
  getAnilistEpisodes,
  getShowMetaById,
  isAnilistRateLimited,
  batchGetShowStatuses,
} from '../lib/anilist.js'
import { kitsuSearchAnime } from '../lib/kitsu.js'
import { getMigratedId } from '../lib/migration.js'
import { offlineDb } from '../lib/offline-db.js'
import { parseJsonBody } from '../utils/http.utils.js'
import { pickBestMatch } from '../providers/title-matching.js'

interface CombinedContinueWatchingShow {
  _id: string
  id: string
  name: string
  thumbnail?: string
  nativeName?: string
  englishName?: string
  episodeNumber?: string | number
  currentTime?: number
  duration?: number
  episodeCount?: number
  watchedCount?: number
  type?: string
  smType?: string
  isAdult?: number | null
  watchlistStatus?: string | null
}

interface EpisodeNotification {
  showId: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  episodeNumber: string
  id: string
}

interface WatchlistFilterOptions {
  query?: string
  type?: string
  season?: string
  year?: string
  genres?: string
  excludeGenres?: string
  sortBy?: string
  titlePreference?: 'name' | 'nativeName' | 'englishName'
}

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
let triggerImpl: ((force?: boolean) => boolean) | null = null

export function triggerWatchlistDiscovery(force = false): boolean {
  return triggerImpl?.(force) ?? false
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

  const getAnilistId = async (showId: string, showName: string): Promise<number | null> => {
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
          const id = await getAnilistId(show.id, show.name)
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
        if (persisted > 0) db.scheduleSave()
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

          let inserted = false
          for (const { episodeKey, airingAt } of episodes) {
            if (nowUnix - airingAt > 30 * 24 * 60 * 60) continue
            if (!watchedSet.has(episodeKey) && !dismissedSet.has(episodeKey)) {
              await NotificationsRepository.addDiscovered(db, watchlistId, episodeKey)
              inserted = true
            }
          }
          if (inserted) db.scheduleSave()
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

        let inserted = false
        for (const { episodeKey } of episodes) {
          if (!watchedSet.has(episodeKey) && !dismissedSet.has(episodeKey)) {
            await NotificationsRepository.addDiscovered(db, watchlistId, episodeKey)
            inserted = true
          }
        }
        if (inserted) db.scheduleSave()
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

  triggerImpl = (force = false) => {
    if (discoveryStopped || discoveryBusy) return false
    const now = Date.now()
    if (!force && now - lastExternalDiscoveryAt < NUDGE_THROTTLE_MS) return false
    lastExternalDiscoveryAt = now
    runDiscovery(force)
    return true
  }

  discoveryIntervalId = setInterval(() => {
    if (!discoveryStopped) runDiscovery(false)
  }, BACKGROUND_DISCOVERY_INTERVAL_MS)
}

function showsMetaChanged(
  db: DatabaseWrapper,
  showId: string,
  candidate: {
    name?: string
    thumbnail?: string
    nativeName?: string
    englishName?: string
    genres?: string
    popularityScore?: number
    status?: string
    episodeCount?: number
    type?: string
    anilistId?: number
    isAdult?: number | null
    episodeDuration?: number
  }
): boolean {
  const existing = ShowsMetaRepository.getById(db, showId) as {
    name?: string | null
    thumbnail?: string | null
    nativeName?: string | null
    englishName?: string | null
    genres?: string | null
    popularityScore?: number | null
    status?: string | null
    episodeCount?: number | null
    type?: string | null
    anilistId?: number | null
    isAdult?: number | null
    episodeDuration?: number | null
  } | null

  if (!existing) return true

  const differs = (incoming: unknown, stored: unknown) => {
    if (incoming === undefined || incoming === null || incoming === '') return false
    return String(incoming) !== String(stored ?? '')
  }

  return (
    differs(candidate.name, existing.name) ||
    differs(candidate.thumbnail, existing.thumbnail) ||
    differs(candidate.nativeName, existing.nativeName) ||
    differs(candidate.englishName, existing.englishName) ||
    differs(candidate.genres, existing.genres) ||
    differs(candidate.popularityScore, existing.popularityScore) ||
    differs(candidate.status, existing.status) ||
    differs(candidate.episodeCount, existing.episodeCount) ||
    differs(candidate.type, existing.type) ||
    differs(candidate.anilistId, existing.anilistId) ||
    differs(candidate.isAdult, existing.isAdult) ||
    differs(candidate.episodeDuration, existing.episodeDuration)
  )
}

function normalizeFilterValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed && trimmed !== 'ALL' ? trimmed : undefined
}

function getWatchlistFilters(query: Record<string, string | undefined>): WatchlistFilterOptions {
  return {
    query: normalizeFilterValue(query['query']),
    type: normalizeFilterValue(query['type']),
    season: normalizeFilterValue(query['season']),
    year: normalizeFilterValue(query['year']),
    genres: normalizeFilterValue(query['genres']),
    excludeGenres: normalizeFilterValue(query['excludeGenres']),
    sortBy: normalizeFilterValue(query['sortBy']),
    titlePreference: ['name', 'nativeName', 'englishName'].includes(
      String(query['titlePreference'])
    )
      ? (query['titlePreference'] as 'name' | 'nativeName' | 'englishName')
      : 'name',
  }
}

function matchesLocalFilters<
  T extends { name?: string; nativeName?: string; englishName?: string; type?: string },
>(row: T, filters: WatchlistFilterOptions): boolean {
  if (filters.query) {
    const queryWords = new Set(
      filters.query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    )
    const rowTitle = (row.englishName || row.name || row.nativeName || '').toLowerCase()
    const titleWords = rowTitle.split(/\s+/)
    const overlap = titleWords.filter((w) => queryWords.has(w)).length
    if (overlap < queryWords.size) return false
  }

  return true
}

function sortFilteredRows<T extends { name?: string; nativeName?: string; englishName?: string }>(
  rows: T[],
  filters: WatchlistFilterOptions
): T[] {
  const getSortTitle = (row: T) => {
    const preferredTitle = filters.titlePreference ? row[filters.titlePreference] : undefined
    return preferredTitle || row.name || ''
  }

  if (filters.sortBy === 'name_asc') {
    return [...rows].sort((a, b) => getSortTitle(a).localeCompare(getSortTitle(b)))
  }
  if (filters.sortBy === 'name_desc') {
    return [...rows].sort((a, b) => getSortTitle(b).localeCompare(getSortTitle(a)))
  }
  return rows
}

async function getAnilistSeasonYearMatches(
  season?: string,
  year?: string
): Promise<Map<number, { title: { romaji?: string; english?: string; native?: string } }>> {
  const matched = new Map<
    number,
    { title: { romaji?: string; english?: string; native?: string } }
  >()

  if (!year || year === 'ALL') {
    return matched
  }

  const seasonYear = parseInt(year)
  if (Number.isNaN(seasonYear)) return matched

  const perPage = 50
  let page = 1

  while (true) {
    const searchVars: Record<string, unknown> = {
      seasonYear,
      page,
      perPage,
    }
    if (season && season !== 'ALL') {
      searchVars.season = season.toUpperCase()
    }

    const results = await searchAnilist(searchVars)

    for (const show of results) {
      if (show.anilistId) {
        matched.set(show.anilistId, { title: show.names || {} })
      }
    }

    if (results.length < perPage) break
    page++
    if (page > 10) break
  }

  return matched
}

function rowMatchesAnilistSeasonYear<
  T extends { id: string; name?: string; nativeName?: string; englishName?: string },
>(
  row: T,
  anilistMatches: Map<number, { title: { romaji?: string; english?: string; native?: string } }>
): boolean {
  if (anilistMatches.size === 0) return true

  if (/^\d+$/.test(row.id) && anilistMatches.has(parseInt(row.id))) {
    return true
  }

  const rowTitle = (row.englishName || row.name || row.nativeName || '').toLowerCase()
  if (!rowTitle) return false

  const rowWords = new Set(rowTitle.split(/\s+/).filter((w) => w.length >= 2))
  if (rowWords.size === 0) return false

  for (const [, media] of anilistMatches) {
    const titles = [media.title?.romaji, media.title?.english, media.title?.native].filter(
      Boolean
    ) as string[]
    for (const title of titles) {
      const titleWords = new Set(
        title
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length >= 2)
      )
      const overlap = [...rowWords].filter((w) => titleWords.has(w)).length
      const minLen = Math.min(rowWords.size, titleWords.size)
      if (minLen >= 2 && overlap / minLen >= 0.7) return true
    }
  }

  return false
}

async function filterWatchlistRows<
  T extends {
    id: string
    name?: string
    nativeName?: string
    englishName?: string
    type?: string
  },
>(rows: T[], filters: WatchlistFilterOptions, db?: DatabaseWrapper): Promise<T[]> {
  let filtered = rows.filter((row) => matchesLocalFilters(row, filters))

  if (filters.type === 'ADULT' && db && filtered.length > 0) {
    const ids = filtered.map((r) => r.id)
    const placeholders = ids.map(() => '?').join(',')
    const adultRows = await dbAll<{ id: string }>(
      db,
      `SELECT id FROM shows_meta WHERE id IN (${placeholders}) AND isAdult = 1`,
      ids
    )
    const adultSet = new Set(adultRows.map((r) => r.id))
    filtered = filtered.filter((row) => adultSet.has(row.id))
  } else if (filters.type && filters.type !== 'ALL' && filters.type !== 'ADULT') {
    filtered = filtered.filter((row) => row.type === filters.type)
  }

  if ((filters.genres || filters.excludeGenres) && db) {
    const ids = filtered.map((r) => r.id)
    const placeholders = ids.map(() => '?').join(',')
    const genreRows = await dbAll<{ id: string; genres: string | null }>(
      db,
      `SELECT id, genres FROM shows_meta WHERE id IN (${placeholders})`,
      ids
    )
    const idToGenres = new Map(
      genreRows.map((r) => [r.id, r.genres ? (JSON.parse(r.genres) as string[]) : []])
    )
    const includeList =
      filters.genres
        ?.split(',')
        .map((g) => g.trim())
        .filter(Boolean) || []
    const excludeList =
      filters.excludeGenres
        ?.split(',')
        .map((g) => g.trim())
        .filter(Boolean) || []

    filtered = filtered.filter((row) => {
      const rowGenres: string[] = idToGenres.get(row.id) || []
      if (includeList.length && !includeList.every((g) => rowGenres.includes(g))) return false
      if (excludeList.length && excludeList.some((g) => rowGenres.includes(g))) return false
      return true
    })
  }

  if (
    ((filters.season && filters.season !== 'ALL') || (filters.year && filters.year !== 'ALL')) &&
    filtered.length > 0
  ) {
    const anilistMatches = await getAnilistSeasonYearMatches(filters.season, filters.year)
    if (anilistMatches.size > 0) {
      filtered = filtered.filter((row) => rowMatchesAnilistSeasonYear(row, anilistMatches))
    }
  }

  return sortFilteredRows(filtered, filters)
}

async function backfillMissingPosters(
  db: DatabaseWrapper,
  rows: { id: string; _id?: string; name?: string; thumbnail?: string }[]
): Promise<void> {
  const missing = rows.filter((r) => !r.thumbnail || r.thumbnail.trim() === '')
  if (missing.length === 0) return
  const slice = missing.slice(0, 10)
  await Promise.allSettled(
    slice.map(async (row) => {
      try {
        const meta = await getShowMetaById(row.id)
        const poster = meta?.thumbnail?.trim()
        if (!poster) return
        row.thumbnail = poster
        const dual = row as { _id: string } & Record<string, unknown>
        if (dual._id !== undefined) dual._id = row.id
        try {
          ShowsMetaRepository.upsert(db, {
            id: row.id,
            thumbnail: poster,
            popularityScore:
              meta?.score ?? (meta?.averageScore != null ? meta.averageScore / 10 : undefined),
          })
        } catch {
          // ignore
        }
        try {
          await WatchlistRepository.updateThumbnail(db, row.id, poster)
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
    })
  )
  db.scheduleSave()
  await sweepOfflinePosters(db)
}

async function sweepOfflinePosters(db: DatabaseWrapper): Promise<void> {
  try {
    db.run(
      `UPDATE shows_meta SET name = (SELECT w.name FROM watchlist w WHERE w.id = shows_meta.id)
       WHERE (name IS NULL OR TRIM(name) = '')
       AND EXISTS (SELECT 1 FROM watchlist w WHERE w.id = shows_meta.id AND w.name IS NOT NULL AND TRIM(w.name) != '')`
    )
  } catch {
    // ignore
  }
  const [wlMissing, metaMissing] = await Promise.all([
    WatchlistRepository.getMissingThumbnails(db),
    ShowsMetaRepository.getShowIdsMissingMeta(db),
  ])
  const ids = [...new Set([...wlMissing.map((r) => r.id), ...metaMissing.map((r) => r.id)])].slice(
    0,
    500
  )
  if (ids.length === 0) return
  for (const id of ids) {
    const poster = resolveOfflinePoster(id)
    if (poster) await applyPoster(db, id, poster)
  }
  db.scheduleSave()
}

function resolveOfflinePoster(id: string): string | null {
  if (/^\d+$/.test(id)) {
    return offlineDb.getByAnilistId(Number(id))?.thumbnail?.trim() || null
  }
  const mal = /^mal-(\d+)$/i.exec(id)?.[1]
  if (mal) return offlineDb.getByMalId(Number(mal))?.thumbnail?.trim() || null
  return null
}

async function applyPoster(db: DatabaseWrapper, id: string, poster: string): Promise<void> {
  try {
    ShowsMetaRepository.upsert(db, { id, thumbnail: poster })
  } catch {
    // ignore
  }
  try {
    await WatchlistRepository.updateThumbnail(db, id, poster)
  } catch {
    // ignore
  }
}

async function getContinueWatchingData(
  db: DatabaseWrapper,
  limit?: number
): Promise<CombinedContinueWatchingShow[]> {
  const rows: ContinueWatchingResult[] = await WatchedEpisodesRepository.getContinueWatching(
    db,
    limit
  )

  const ignoreAdultRow = await SettingsRepository.getByKey(db, 'ignoreAdultContent')
  const ignoreAdult = ignoreAdultRow ? ignoreAdultRow.value !== 'false' : true
  const watchlistOnlyRow = await SettingsRepository.getByKey(db, 'cwWatchlistOnly')
  const watchlistOnly = watchlistOnlyRow
    ? watchlistOnlyRow.value === 'true' || watchlistOnlyRow.value === '1'
    : false

  const enrichedRows = rows
    .filter((show) => {
      if (ignoreAdult && show.isAdult) return false
      if (watchlistOnly && show.watchlistStatus !== 'Watching') return false
      return true
    })
    .map((show) => ({
      ...show,
      episodeCount: show.episodeCount,
      type: show.type || show.smType,
      thumbnail: show.thumbnail ?? '',
    }))

  await backfillMissingPosters(db, enrichedRows)

  return enrichedRows
}

async function getAdultNonWatchlistShowIds(db: DatabaseWrapper): Promise<string[]> {
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

async function resolveAvailableEpisodes(db: DatabaseWrapper, showId: string): Promise<string[]> {
  const episodeData = await getAnilistEpisodes(showId)
  const episodes =
    Array.isArray(episodeData) && episodeData.length
      ? [...episodeData].sort((a, b) => parseFloat(a) - parseFloat(b))
      : []
  return episodes
}

const dlsitePosterCache = new Map<string, { url: string; ts: number }>()
const mangadexCoverCache = new Map<string, { url: string | null; ts: number }>()

async function getMangadexCover(title: string): Promise<string | null> {
  const key = title.trim().toLowerCase()
  if (!key) return null
  const cached = mangadexCoverCache.get(key)
  if (cached && Date.now() - cached.ts < 3600_000) return cached.url
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
    mangadexCoverCache.set(key, { url, ts: Date.now() })
    return url
  } catch {
    return null
  }
}

async function getDlsitePoster(rjCode: string): Promise<string | null> {
  const key = String(rjCode).trim().toUpperCase()
  if (!/^RJ\d{5,}$/.test(key)) return null
  const cached = dlsitePosterCache.get(key)
  if (cached && Date.now() - cached.ts < 3600_000) return cached.url
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
    dlsitePosterCache.set(key, { url, ts: Date.now() })
    return url
  } catch {
    return null
  }
}

interface ProgressBody {
  showId?: unknown
  episodeNumber?: unknown
  currentTime?: unknown
  duration?: unknown
  showName?: unknown
  showThumbnail?: unknown
  nativeName?: unknown
  englishName?: unknown
  genres?: unknown
  popularityScore?: unknown
  type?: unknown
  status?: unknown
  episodeCount?: unknown
  isPlaying?: unknown
  sessionId?: unknown
  isAdult?: unknown
}

export function registerWatchlist(app: Hono, getDbs: () => HonoDbs) {
  const db = () => getDbs().db

  app.get('/api/continue-watching/all', async (c) => {
    const page = parseInt(c.req.query('page') as string) || 1
    const limit = parseInt(c.req.query('limit') as string) || 10
    const offset = (page - 1) * limit
    const query: Record<string, string | undefined> = {
      query: c.req.query('query') ?? undefined,
      type: c.req.query('type') ?? undefined,
      season: c.req.query('season') ?? undefined,
      year: c.req.query('year') ?? undefined,
      genres: c.req.query('genres') ?? undefined,
      excludeGenres: c.req.query('excludeGenres') ?? undefined,
      sortBy: c.req.query('sortBy') ?? undefined,
      titlePreference: c.req.query('titlePreference') ?? undefined,
    }
    const filters = getWatchlistFilters(query)
    const data = await filterWatchlistRows(await getContinueWatchingData(db()), filters, db())

    return c.json({
      data: data.slice(offset, offset + limit),
      total: data.length,
      page,
      limit,
    })
  })

  app.get('/api/continue-watching/this-week', async (c) => {
    const rows = await dbAll<{
      id: string
      name: string
      thumbnail: string
      nativeName?: string
      englishName?: string
      type?: string
      episodeNumber: string
      discoveredAt: string
    }>(
      db(),
      `SELECT
        w.id, w.name, w.thumbnail, w.nativeName, w.englishName, w.type,
        dn.episodeNumber, dn.discoveredAt
      FROM discovered_notifications dn
      JOIN watchlist w ON dn.showId = w.id
      WHERE w.status = 'Watching'
        AND EXISTS (
          SELECT 1 FROM discovered_notifications dn_recent
          WHERE dn_recent.showId = dn.showId
            AND dn_recent.discoveredAt >= datetime('now', '-7 days')
        )
        AND CAST(dn.episodeNumber AS INTEGER) = (
          SELECT MIN(CAST(dn2.episodeNumber AS INTEGER))
          FROM discovered_notifications dn2
          WHERE dn2.showId = dn.showId
            AND NOT EXISTS (
              SELECT 1 FROM watched_episodes we2
              WHERE we2.showId = dn2.showId AND we2.episodeNumber = dn2.episodeNumber
            )
        )
        AND NOT EXISTS (
          SELECT 1 FROM watched_episodes we
          WHERE we.showId = dn.showId AND we.episodeNumber = dn.episodeNumber
        )
      ORDER BY CAST(dn.episodeNumber AS INTEGER) ASC`
    )

    return c.json(
      rows.map((row) => ({
        _id: row.id,
        id: row.id,
        name: row.name,
        thumbnail: row.thumbnail || '',
        nativeName: row.nativeName,
        englishName: row.englishName,
        type: row.type,
        episodeNumber: parseInt(row.episodeNumber) || row.episodeNumber,
      }))
    )
  })

  app.post('/api/continue-watching/remove', async (c) => {
    const { showId: showIdRaw } = (await c.req.json()) as { showId?: unknown }
    const showId = await getMigratedId(db(), showIdRaw as string)
    await performWriteTransaction(db(), (tx) => {
      WatchedEpisodesRepository.deleteByShow(tx, showId)
      NotificationsRepository.deleteByShow(tx, showId)
    })
    return c.json({ success: true })
  })

  app.post('/api/continue-watching/remove-many', async (c) => {
    const { ids: idsRaw } = (await c.req.json()) as { ids?: unknown }
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }

    const ids = await Promise.all(idsRaw.map((id: string) => getMigratedId(db(), id)))
    await performWriteTransaction(db(), (tx) => {
      for (const id of ids) {
        WatchedEpisodesRepository.deleteByShow(tx, id)
        NotificationsRepository.deleteByShow(tx, id)
      }
    })

    db().scheduleSave()
    return c.json({ success: true, removed: ids.length })
  })

  app.get('/api/continue-watching/adult-count', async (c) => {
    const ids = await getAdultNonWatchlistShowIds(db())
    return c.json({ count: ids.length })
  })

  app.post('/api/continue-watching/purge-adult', async (c) => {
    const ids = await getAdultNonWatchlistShowIds(db())
    if (ids.length > 0) {
      await performWriteTransaction(db(), (tx) => {
        for (const id of ids) {
          WatchedEpisodesRepository.deleteByShow(tx, id)
          NotificationsRepository.deleteByShow(tx, id)
        }
      })
      db().scheduleSave()
    }
    return c.json({ success: true, removed: ids.length })
  })

  app.post('/api/update-progress', async (c) => {
    const {
      showId: showIdRaw,
      episodeNumber,
      currentTime,
      duration,
      showName,
      showThumbnail,
      nativeName,
      englishName,
      genres,
      popularityScore,
      type,
      status,
      episodeCount,
      isPlaying,
      sessionId,
      isAdult,
    } = (await c.req.json()) as ProgressBody

    const showId = await getMigratedId(db(), showIdRaw as string)

    const titlePreferenceRow = await SettingsRepository.getByKey(db(), 'titlePreference')
    const titlePreference = titlePreferenceRow ? titlePreferenceRow.value : 'englishName'

    let displayName = showName
    if (titlePreference === 'englishName' && englishName) {
      displayName = englishName
    } else if (titlePreference === 'nativeName' && nativeName) {
      displayName = nativeName
    }

    discordRPCService.updatePresence({
      title: displayName as string,
      episode: String(episodeNumber),
      totalEpisodes: episodeCount ? String(episodeCount) : undefined,
      currentTime: (currentTime as number) || 0,
      duration: (duration as number) || 0,
      thumbnail: (showThumbnail as string) || '',
      isPlaying: isPlaying !== false,
      sessionId: sessionId as string | undefined,
      isAdult: isAdult as boolean | undefined,
    })

    const genresStr = Array.isArray(genres) ? JSON.stringify(genres) : genres
    const anilistId = /^\d+$/.test(showId)
      ? (dbGet<{ anilistId: number }>(
          db(),
          'SELECT anilistId FROM shows_meta WHERE id = ? AND anilistId IS NOT NULL',
          [showId]
        )?.anilistId ?? parseInt(showId))
      : undefined

    const metaCandidate = {
      name: showName as string | undefined,
      thumbnail: showThumbnail as string | undefined,
      nativeName: nativeName as string | undefined,
      englishName: englishName as string | undefined,
      genres: genresStr as string | undefined,
      popularityScore: popularityScore as number | undefined,
      status: status as string | undefined,
      episodeCount: episodeCount as number | undefined,
      type: type as string | undefined,
      anilistId,
      isAdult: typeof isAdult === 'boolean' ? (isAdult ? 1 : 0) : null,
      episodeDuration: (duration as number) > 0 ? Math.round((duration as number) / 60) : undefined,
    }

    const metaChanged = showsMetaChanged(db(), showId, metaCandidate)

    if (metaChanged) {
      await performWriteTransaction(db(), (tx) => {
        ShowsMetaRepository.upsert(tx, {
          id: showId,
          ...metaCandidate,
        })
      })
    }

    await performWriteTransaction(db(), (tx) => {
      WatchedEpisodesRepository.upsert(tx, {
        showId,
        episodeNumber: episodeNumber as string,
        currentTime: currentTime as number,
        duration: duration as number,
      })

      NotificationsRepository.deleteSpecificDismissed(tx, showId, episodeNumber as string)
      NotificationsRepository.deleteDiscovered(tx, showId, episodeNumber as string)
    })

    db().scheduleSave()

    return c.json({ success: true })
  })

  app.get('/api/watchlist', async (c) => {
    const page = parseInt(c.req.query('page') as string) || 1
    const limit = parseInt(c.req.query('limit') as string) || 10
    const showMature = c.req.query('showMature')
    const offset = (page - 1) * limit
    const query: Record<string, string | undefined> = {
      query: c.req.query('query') ?? undefined,
      type: c.req.query('type') ?? undefined,
      season: c.req.query('season') ?? undefined,
      year: c.req.query('year') ?? undefined,
      genres: c.req.query('genres') ?? undefined,
      excludeGenres: c.req.query('excludeGenres') ?? undefined,
      sortBy: c.req.query('sortBy') ?? undefined,
      titlePreference: c.req.query('titlePreference') ?? undefined,
    }
    const filters = getWatchlistFilters(query)
    const status = c.req.query('status') as string

    const allRows = await WatchlistRepository.getAll(db(), status)

    let filteredRows = await filterWatchlistRows(allRows, filters, db())

    if (showMature === 'false') {
      const ids = filteredRows.map((r) => r.id)
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',')
        const adultIds = await dbAll<{ id: string }>(
          db(),
          `SELECT id FROM shows_meta WHERE id IN (${placeholders}) AND isAdult = 1`,
          ids
        )
        const adultSet = new Set(adultIds.map((r) => r.id))
        filteredRows = filteredRows.filter((row) => !adultSet.has(row.id))
      }
    }
    const rows = filteredRows.slice(offset, offset + limit)

    for (const row of rows) {
      if (!row.thumbnail || row.thumbnail.trim() === '') {
        try {
          const meta = ShowsMetaRepository.getById(db(), row.id) as {
            thumbnail?: string
          } | null
          if (meta?.thumbnail && meta.thumbnail.trim() !== '') {
            row.thumbnail = meta.thumbnail
          }
        } catch {
          // ignore
        }
      }
    }
    await backfillMissingPosters(db(), rows)

    const rowIds = rows.map((r) => r.id)
    let adultIds = new Set<string>()
    if (rowIds.length > 0) {
      const placeholders = rowIds.map(() => '?').join(',')
      const adultRows = await dbAll<{ id: string }>(
        db(),
        `SELECT id FROM shows_meta WHERE id IN (${placeholders}) AND isAdult = 1`,
        rowIds
      )
      adultIds = new Set(adultRows.map((r) => r.id))
    }

    return c.json({
      data: rows.map((row) => ({
        ...row,
        _id: row.id,
        thumbnail: row.thumbnail || '',
        isAdult: adultIds.has(row.id),
      })),
      total: filteredRows.length,
      page,
      limit,
    })
  })

  app.get('/api/watchlist/check/:showId', async (c) => {
    const showId = await getMigratedId(db(), c.req.param('showId'))
    const item = await WatchlistRepository.getById(db(), showId)
    return c.json({ inWatchlist: !!item, status: item?.status ?? null })
  })

  app.get('/api/queue', async (c) => {
    const rows = await QueueRepository.getAll(db())
    return c.json(
      rows.map((row) => ({
        ...row,
        _id: row.showId,
        id: row.id,
        thumbnail: row.thumbnail || '',
      }))
    )
  })

  app.post('/api/queue/add', async (c) => {
    const {
      showId: showIdRaw,
      episodeNumber,
      showName,
      showThumbnail,
      nativeName,
      englishName,
      type,
    } = (await c.req.json()) as {
      showId?: unknown
      episodeNumber?: unknown
      showName?: unknown
      showThumbnail?: unknown
      nativeName?: unknown
      englishName?: unknown
      type?: unknown
    }

    if (!showIdRaw || !episodeNumber) {
      return c.json({ error: 'showId and episodeNumber are required' }, 400)
    }

    const showId = await getMigratedId(db(), showIdRaw as string)

    const existing = await QueueRepository.getByEpisode(db(), showId, String(episodeNumber))

    await performWriteTransaction(db(), (tx) => {
      if (showName || showThumbnail || nativeName || englishName || type) {
        ShowsMetaRepository.upsert(tx, {
          id: showId,
          name: (showName || '') as string,
          thumbnail: (showThumbnail || '') as string,
          nativeName: nativeName as string | undefined,
          englishName: englishName as string | undefined,
          type: type as string | undefined,
        })
      }

      if (existing) {
        QueueRepository.removeEpisode(tx, showId, String(episodeNumber))
      } else {
        QueueRepository.addToEnd(tx, showId, String(episodeNumber))
      }
    })

    db().scheduleSave()
    return c.json({ success: true, queued: !existing })
  })

  app.post('/api/queue/batch', async (c) => {
    const {
      showId: showIdRaw,
      episodeNumbers,
      showName,
      showThumbnail,
      nativeName,
      englishName,
      type,
    } = (await c.req.json()) as {
      showId?: unknown
      episodeNumbers?: unknown
      showName?: unknown
      showThumbnail?: unknown
      nativeName?: unknown
      englishName?: unknown
      type?: unknown
    }

    if (!showIdRaw || !Array.isArray(episodeNumbers) || episodeNumbers.length === 0) {
      return c.json({ error: 'showId and episodeNumbers are required' }, 400)
    }

    const showId = await getMigratedId(db(), showIdRaw as string)
    const normalized = [...new Set(episodeNumbers.map((ep: string) => String(ep)))]

    await performWriteTransaction(db(), (tx) => {
      if (showName || showThumbnail || nativeName || englishName || type) {
        ShowsMetaRepository.upsert(tx, {
          id: showId,
          name: (showName || '') as string,
          thumbnail: (showThumbnail || '') as string,
          nativeName: nativeName as string | undefined,
          englishName: englishName as string | undefined,
          type: type as string | undefined,
        })
      }
      return QueueRepository.addManyToEnd(
        tx,
        normalized.map((episodeNumber) => ({ showId, episodeNumber }))
      )
    })

    db().scheduleSave()
    return c.json({ success: true, added: normalized.length })
  })

  app.post('/api/queue/remove', async (c) => {
    const { showId: showIdRaw, episodeNumber } = (await c.req.json()) as {
      showId?: unknown
      episodeNumber?: unknown
    }
    const showId = await getMigratedId(db(), showIdRaw as string)
    await performWriteTransaction(db(), (tx) => {
      QueueRepository.removeEpisode(tx, showId, String(episodeNumber))
    })
    return c.json({ success: true })
  })

  app.post('/api/queue/remove-many', async (c) => {
    const { showId: showIdRaw, episodeNumbers } = (await c.req.json()) as {
      showId?: unknown
      episodeNumbers?: unknown
    }
    if (!showIdRaw) {
      return c.json({ error: 'showId is required' }, 400)
    }

    const showId = await getMigratedId(db(), showIdRaw as string)

    let removed: string[]
    await performWriteTransaction(db(), (tx) => {
      removed = (QueueRepository.getByShow(tx, showId) || []).map((ep) => ep.episodeNumber)
      const toRemove =
        Array.isArray(episodeNumbers) && episodeNumbers.length
          ? [...new Set(episodeNumbers.map((ep: string) => String(ep)))]
          : removed
      return QueueRepository.removeMany(tx, showId, toRemove)
    })

    return c.json({ success: true, removed: removed!.length })
  })

  app.post('/api/queue/clear', async (c) => {
    await performWriteTransaction(db(), (tx) => {
      QueueRepository.clear(tx)
    })
    return c.json({ success: true })
  })

  app.post('/api/queue/reorder', async (c) => {
    const { items } = (await c.req.json()) as { items?: unknown }
    if (!Array.isArray(items)) {
      return c.json({ error: 'items must be an array' }, 400)
    }

    await performWriteTransaction(db(), (tx) => {
      QueueRepository.reorder(tx, items)
    })
    return c.json({ success: true })
  })

  app.get('/api/queue/suggested/:showId', async (c) => {
    const showId = await getMigratedId(db(), c.req.param('showId'))
    const resumeProgress = await WatchedEpisodesRepository.getLatestResumeProgress(db(), showId)

    if (resumeProgress) {
      return c.json({
        showId,
        episodeNumber: resumeProgress.episodeNumber,
        resumeTime: resumeProgress.currentTime || 0,
      })
    }

    const [watchedEpisodes, episodes] = await Promise.all([
      WatchedEpisodesRepository.getByShow(db(), showId),
      resolveAvailableEpisodes(db(), showId),
    ])

    const watchedSet = new Set(watchedEpisodes.map((ep) => ep.episodeNumber.toString()))

    const finishedEpisodes = watchedEpisodes
      .filter((ep) => ep.duration > 0 && ep.currentTime >= ep.duration * 0.8)
      .map((ep) => parseFloat(ep.episodeNumber))
      .filter((ep) => !Number.isNaN(ep))

    const nextAfterFinished =
      finishedEpisodes.length > 0 ? String(Math.max(...finishedEpisodes) + 1) : undefined

    const episodeNumber =
      (nextAfterFinished &&
      episodes.includes(nextAfterFinished) &&
      !watchedSet.has(nextAfterFinished)
        ? nextAfterFinished
        : episodes.find((ep) => !watchedSet.has(ep))) ||
      episodes[0] ||
      '1'

    return c.json({ showId, episodeNumber, resumeTime: 0 })
  })

  app.get('/api/queue/remaining/:showId', async (c) => {
    const showId = await getMigratedId(db(), c.req.param('showId'))

    const [watchedEpisodes, queuedEpisodes, episodes] = await Promise.all([
      WatchedEpisodesRepository.getByShow(db(), showId),
      QueueRepository.getByShow(db(), showId),
      resolveAvailableEpisodes(db(), showId),
    ])

    const watchedSet = new Set(watchedEpisodes.map((ep) => ep.episodeNumber.toString()))
    const queuedSet = new Set(queuedEpisodes.map((ep) => ep.episodeNumber.toString()))

    const remaining = episodes.filter((ep) => !watchedSet.has(ep) && !queuedSet.has(ep))

    return c.json({ showId, episodes: remaining })
  })

  app.get('/api/episode-progress/:showId/:episodeNumber', async (c) => {
    const showId = await getMigratedId(db(), c.req.param('showId'))
    const progress = await WatchedEpisodesRepository.getByShowAndEpisode(
      db(),
      showId,
      c.req.param('episodeNumber')
    )
    return c.json(progress || { currentTime: 0, duration: 0 })
  })

  app.get('/api/watched-episodes/:showId', async (c) => {
    const showId = await getMigratedId(db(), c.req.param('showId'))
    const episodes = await WatchedEpisodesRepository.getWatchedEpisodeNumbers(db(), showId)
    return c.json(episodes)
  })

  app.post('/api/watchlist/add', async (c) => {
    const {
      id: idRaw,
      status,
      nativeName,
      englishName,
      name,
      thumbnail,
      type,
      isAdult: isAdultRaw,
    } = (await c.req.json()) as {
      id?: unknown
      status?: unknown
      nativeName?: unknown
      englishName?: unknown
      name?: unknown
      thumbnail?: unknown
      type?: unknown
      isAdult?: unknown
    }
    const id = await getMigratedId(db(), idRaw as string)

    await performWriteTransaction(db(), (tx) => {
      WatchlistRepository.upsert(tx, {
        id,
        name: name as string,
        thumbnail: thumbnail as string,
        status: (status as string) || 'Watching',
        nativeName: (nativeName as string) || '',
        englishName: (englishName as string) || '',
        type: (type as string) || 'TV',
      })
      if (typeof isAdultRaw === 'boolean') {
        ShowsMetaRepository.upsert(tx, { id, isAdult: isAdultRaw ? 1 : 0 })
      }
    })

    await db().saveNow()

    if (name && !/^\d+$/.test(id)) {
      const resolveAndSave = async (): Promise<void> => {
        if (!isAnilistRateLimited()) {
          const result = await searchAnilistByTitle(name as string)
          if (result?.id) {
            ShowsMetaRepository.upsert(db(), { id, anilistId: result.id })
            db().scheduleSave()
            return
          }
        }
        try {
          const kitsuResults = await kitsuSearchAnime({
            query: name as string,
            page: 1,
            perPage: 3,
          })
          if (kitsuResults.length > 0) {
            const anilistId = Math.abs(kitsuResults[0].id)
            ShowsMetaRepository.upsert(db(), { id, anilistId })
            db().scheduleSave()
          }
        } catch {
          // Kitsu failed, show will be skipped in discovery
        }
      }
      void resolveAndSave().catch(() => {})
    }

    return c.json({ success: true })
  })

  app.post('/api/watchlist/remove', async (c) => {
    const { id: idRaw } = (await c.req.json()) as { id?: unknown }
    const id = await getMigratedId(db(), idRaw as string)
    await performWriteTransaction(db(), (tx) => {
      WatchlistRepository.delete(tx, id)
      WatchedEpisodesRepository.deleteByShow(tx, id)
      NotificationsRepository.deleteByShow(tx, id)
    })
    return c.json({ success: true })
  })

  app.post('/api/watchlist/remove-many', async (c) => {
    const { ids: idsRaw } = (await c.req.json()) as { ids?: unknown }
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }

    const ids = await Promise.all(idsRaw.map((id: string) => getMigratedId(db(), id)))
    await performWriteTransaction(db(), (tx) => {
      WatchlistRepository.deleteMany(tx, ids)
      for (const id of ids) {
        WatchedEpisodesRepository.deleteByShow(tx, id)
        NotificationsRepository.deleteByShow(tx, id)
      }
    })

    db().scheduleSave()
    return c.json({ success: true, removed: ids.length })
  })

  app.post('/api/watchlist/status', async (c) => {
    const { id: idRaw, status } = (await c.req.json()) as { id?: unknown; status?: unknown }
    const id = await getMigratedId(db(), idRaw as string)
    await performWriteTransaction(db(), (tx) => {
      WatchlistRepository.updateStatus(tx, id, status as string)
    })
    return c.json({ success: true })
  })

  app.post('/api/watchlist/batch-status', async (c) => {
    const { ids: idsRaw, status } = (await c.req.json()) as { ids?: unknown; status?: unknown }
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return c.json({ error: 'ids must be a non-empty array' }, 400)
    }
    if (!status) {
      return c.json({ error: 'status is required' }, 400)
    }

    const ids = await Promise.all(idsRaw.map((id: string) => getMigratedId(db(), id)))
    await performWriteTransaction(db(), (tx) => {
      WatchlistRepository.updateStatusMany(tx, ids, status as string)
    })

    db().scheduleSave()
    return c.json({ success: true, updated: ids.length })
  })

  app.get('/api/notifications', async (c) => {
    const watchingShows = await WatchlistRepository.getWatchingShows(db())

    const notifications: EpisodeNotification[] = []

    for (const show of watchingShows) {
      try {
        const [watchedEps, dismissedEps, discoveredEps] = await Promise.all([
          WatchedEpisodesRepository.getWatchedEpisodeNumbers(db(), show.id),
          NotificationsRepository.getDismissedByShow(db(), show.id),
          NotificationsRepository.getDiscoveredByShow(db(), show.id),
        ])

        const watchedSet = new Set(watchedEps.map((e) => e.toString()))
        const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

        for (const discovered of discoveredEps) {
          if (
            !watchedSet.has(discovered.episodeNumber) &&
            !dismissedSet.has(discovered.episodeNumber)
          ) {
            notifications.push({
              showId: show.id,
              name: show.name,
              nativeName: show.nativeName,
              englishName: show.englishName,
              thumbnail: show.thumbnail,
              episodeNumber: discovered.episodeNumber,
              id: `${show.id}-${discovered.episodeNumber}`,
            })
          }
        }
      } catch (e) {
        logger.error({ err: e, showId: show.id }, 'Failed to get notifications for show')
      }
    }

    return c.json(
      notifications.sort((a, b) => parseFloat(b.episodeNumber) - parseFloat(a.episodeNumber))
    )
  })

  app.post('/api/notifications/dismiss', async (c) => {
    const { showId, episodeNumber } = (await c.req.json()) as {
      showId?: unknown
      episodeNumber?: unknown
    }
    await performWriteTransaction(db(), (tx) => {
      NotificationsRepository.addDismissed(tx, showId as string, episodeNumber as string)
    })
    return c.json({ success: true })
  })

  app.post('/api/notifications/clear-all', async (c) => {
    const { showId } = (await c.req.json()) as { showId?: unknown }
    await performWriteTransaction(db(), (tx) => {
      NotificationsRepository.dismissFromDiscovered(tx, showId as string)
    })
    return c.json({ success: true })
  })

  app.get('/api/discovery/status', (c) => {
    return c.json(getWatchlistDiscoveryStatus())
  })

  app.post('/api/discovery/nudge', (c) => {
    const started = triggerWatchlistDiscovery(false)
    return c.json({ success: true, started, ...getWatchlistDiscoveryStatus() })
  })

  app.post('/api/discovery/refresh', (c) => {
    const started = triggerWatchlistDiscovery(true)
    return c.json({ success: true, started, ...getWatchlistDiscoveryStatus() })
  })

  app.post('/api/discord/clear', async (c) => {
    const { sessionId } = (await c.req.json()) as { sessionId?: unknown }
    if (!discordRPCService.isServiceEnabled) {
      return c.json({ success: true })
    }
    discordRPCService.clearPresence(sessionId as string)
    return c.json({ success: true })
  })

  app.post('/api/discord/heartbeat', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as
      { sessionId?: unknown; bye?: unknown } | undefined
    const { sessionId, bye } = body ?? {}
    if (typeof sessionId !== 'string' || !discordRPCService.isServiceEnabled) {
      return c.json({ success: true })
    }
    if (bye) {
      discordRPCService.removeHeartbeat(sessionId)
    } else {
      discordRPCService.heartbeat(sessionId)
    }
    return c.json({ success: true })
  })

  app.post('/api/discord/status', async (c) => {
    const { page } = (await c.req.json()) as { page?: unknown }
    if (typeof page !== 'string' || !discordRPCService.isServiceEnabled) {
      return c.json({ success: true })
    }
    discordRPCService.setIdleStatus(page)
    return c.json({ success: true })
  })

  app.post('/api/discord/asmr', async (c) => {
    const {
      title,
      trackLabel,
      isPlaying,
      thumbnail,
      thumbnails,
      currentTime,
      duration,
      isAdult,
      sessionId,
      rjCode,
    } = ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!discordRPCService.isServiceEnabled) return c.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(thumbnail || '')
    const thumbs = Array.isArray(thumbnails) ? thumbnails.map(String).filter(Boolean) : undefined
    const needsDlsite =
      !thumb || thumb.includes('weeabo0.xyz') || thumb.includes('japaneseasmr.com')
    if (needsDlsite && rjCode) {
      const dlsiteThumb = await getDlsitePoster(String(rjCode))
      if (dlsiteThumb) thumb = dlsiteThumb
    }
    if (thumb.includes('/api/image-proxy') || thumb.includes('weeabo0.xyz')) thumb = ''
    discordRPCService.updatePresence({
      title: String(title || 'ASMR').slice(0, 128),
      episode: String(trackLabel || '').slice(0, 64),
      totalEpisodes: '',
      currentTime: Number(currentTime) || 0,
      duration: Number(duration) || 0,
      thumbnail: thumb,
      thumbnails: thumbs,
      isPlaying: !!isPlaying,
      providerName: 'ASMR',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: !!isAdult,
    })
    return c.json({ success: true })
  })

  app.post('/api/discord/radio', async (c) => {
    const { title, stationLabel, isPlaying, thumbnail, currentTime, sessionId } = ((await c.req
      .json()
      .catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!discordRPCService.isServiceEnabled) return c.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(thumbnail || '')
    if (thumb.includes('/api/image-proxy')) {
      const match = thumb.match(/url=([^&]+)/)
      if (match) thumb = decodeURIComponent(match[1])
    }
    if (thumb && !thumb.startsWith('https://')) thumb = ''
    if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) thumb = ''
    discordRPCService.updatePresence({
      title: String(title || 'Radio').slice(0, 128),
      episode: String(stationLabel || '').slice(0, 64),
      totalEpisodes: '',
      stateLine: String(stationLabel || 'Radio').slice(0, 64),
      currentTime: Number(currentTime) || 0,
      duration: 0,
      thumbnail: thumb,
      isPlaying: !!isPlaying,
      providerName: 'Radio',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: false,
    })
    return c.json({ success: true })
  })

  app.post('/api/discord/music', async (c) => {
    const { title, artistLabel, isPlaying, thumbnail, currentTime, duration, sessionId } =
      ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!discordRPCService.isServiceEnabled) return c.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(thumbnail || '')
    if (thumb.includes('/api/image-proxy')) {
      const match = thumb.match(/url=([^&]+)/)
      if (match) thumb = decodeURIComponent(match[1])
    }
    if (thumb && !thumb.startsWith('https://')) thumb = ''
    if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) thumb = ''
    discordRPCService.updatePresence({
      title: String(title || 'Music').slice(0, 128),
      episode: String(artistLabel || '').slice(0, 64),
      totalEpisodes: '',
      stateLine: String(artistLabel || 'Music').slice(0, 64),
      currentTime: Number(currentTime) || 0,
      duration: Number(duration) || 0,
      thumbnail: thumb,
      isPlaying: !!isPlaying,
      providerName: 'Music',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: false,
    })
    return c.json({ success: true })
  })

  app.post('/api/discord/manga', async (c) => {
    const { title, chapterLabel, isPlaying, thumbnail, thumbnails, sessionId, isAdult } =
      ((await c.req.json().catch(() => undefined)) ?? {}) as Record<string, unknown>
    if (!discordRPCService.isServiceEnabled) return c.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    const cleanThumb = (value: unknown): string => {
      let thumb = String(value || '')
      if (thumb.includes('/api/proxy') || thumb.includes('/api/image-proxy')) {
        const match = thumb.match(/url=([^&]+)/)
        if (match) {
          try {
            thumb = decodeURIComponent(match[1])
          } catch {
            return ''
          }
        }
      }
      if (!thumb.startsWith('https://')) return ''
      if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) return ''
      if (thumb.includes('readdetectiveconan.com')) return ''
      return thumb
    }
    let thumb = cleanThumb(thumbnail)
    let thumbs = Array.isArray(thumbnails)
      ? (thumbnails.map(cleanThumb).filter(Boolean) as string[])
      : undefined
    if (!thumb && title) {
      const fallback = await getMangadexCover(String(title))
      if (fallback) {
        thumb = fallback
        thumbs = [fallback, ...(thumbs || [])]
      }
    }
    discordRPCService.updatePresence({
      title: String(title || 'Manga').slice(0, 128),
      episode: String(chapterLabel || '').slice(0, 64),
      totalEpisodes: '',
      stateLine: (chapterLabel ? `Reading ${chapterLabel}` : 'Reading').slice(0, 64),
      currentTime: 0,
      duration: 0,
      thumbnail: thumb,
      thumbnails: thumbs,
      isPlaying: isPlaying !== false,
      providerName: 'Manga',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: isAdult === true,
    })
    return c.json({ success: true })
  })

  app.post('/api/discord/tv', async (c) => {
    const { title, episodeLabel, isPlaying, thumbnail, currentTime, duration, sessionId, isAdult } =
      ((await c.req.json()) ?? {}) as Record<string, unknown>
    if (!discordRPCService.isServiceEnabled) return c.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(thumbnail || '')
    if (thumb.includes('/api/image-proxy')) {
      const match = thumb.match(/url=([^&]+)/)
      if (match) thumb = decodeURIComponent(match[1])
    }
    if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) thumb = ''
    discordRPCService.updatePresence({
      title: String(title || 'TV').slice(0, 128),
      episode: String(episodeLabel || '').slice(0, 64),
      totalEpisodes: '',
      stateLine: String(episodeLabel || 'Movie').slice(0, 64),
      currentTime: Number(currentTime) || 0,
      duration: Number(duration) || 0,
      thumbnail: thumb,
      isPlaying: !!isPlaying,
      providerName: 'TV',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: isAdult === true,
    })
    return c.json({ success: true })
  })
}

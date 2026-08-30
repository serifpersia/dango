import { Request, Response } from 'express'
import logger from '../logger'
import { DatabaseWrapper } from '../db'
import { performWriteTransaction } from '../sync'
import { WatchlistRepository } from '../repositories/watchlist.repository'
import {
  WatchedEpisodesRepository,
  ContinueWatchingResult,
  WatchedEpisode,
} from '../repositories/watched-episodes.repository'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository'
import { NotificationsRepository } from '../repositories/notifications.repository'
import { QueueRepository } from '../repositories/queue.repository'
import { SettingsRepository } from '../repositories/settings.repository'
import { discordRPCService } from '../discord-rpc'
import { requestContext } from '../utils/request-context'
import { dbAll, dbGet } from '../utils/db-utils'
import {
  searchAnilist,
  searchAnilistByTitle,
  getAiredEpisodesForShows,
  getAnilistEpisodes,
  isAnilistRateLimited,
  batchGetShowStatuses,
} from '../lib/anilist'
import { kitsuSearchAnime } from '../lib/kitsu'
import { getMigratedId } from '../lib/migration'

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

export class WatchlistController {
  triggerDiscovery?: (force?: boolean) => boolean
  private discoveryIntervalId: ReturnType<typeof setInterval> | null = null
  private lastExternalDiscoveryAt = 0
  private discoveryBusy = false
  private lastDiscoveryRunAt = 0
  private discoveryState: 'idle' | 'running' | 'complete' | 'empty' | 'error' = 'idle'
  private discoveryTotal = 0
  private discoveryDone = 0
  private stopped = false

  stopNotificationDiscovery(): void {
    this.stopped = true
    if (this.discoveryIntervalId !== null) {
      clearInterval(this.discoveryIntervalId)
      this.discoveryIntervalId = null
    }
  }

  getDiscoveryStatus = (): {
    running: boolean
    state: 'idle' | 'running' | 'complete' | 'empty' | 'error'
    total: number
    done: number
    lastRunAt: number
  } => ({
    running: this.discoveryBusy,
    state: this.discoveryState,
    total: this.discoveryTotal,
    done: Math.min(this.discoveryDone, this.discoveryTotal),
    lastRunAt: this.lastDiscoveryRunAt,
  })

  startNotificationDiscovery(getDb: () => DatabaseWrapper): void {
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
      if (this.discoveryBusy || this.stopped) return
      this.discoveryBusy = true
      this.discoveryState = 'running'
      this.discoveryTotal = 0
      this.discoveryDone = 0

      const db = getDb()
      if (!db || db.isClosedCheck()) {
        this.discoveryBusy = false
        return
      }

      const startedAt = Date.now()
      const MAX_RUN_MS = fast ? 90000 : SLOW_MAX_RUN_MS

      try {
        const watchingShows = await WatchlistRepository.getWatchingShows(db)
        this.discoveryTotal = watchingShows.length
        if (watchingShows.length === 0) {
          this.discoveryBusy = false
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
            this.discoveryDone += 1
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
          this.discoveryBusy = false
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

          const latestFinishedByShow = new Map<string, { episodeKey: string; airingAt: number }>()
          for (const entry of finishedSchedules) {
            if (entry.airingAt > nowUnix) continue
            const watchlistId = reverseMap.get(entry.mediaId)
            if (!watchlistId) continue
            const current = latestFinishedByShow.get(watchlistId)
            if (!current || entry.airingAt > current.airingAt) {
              latestFinishedByShow.set(watchlistId, {
                episodeKey: String(Math.round(entry.episode)),
                airingAt: entry.airingAt,
              })
            }
          }

          for (const [watchlistId, { episodeKey, airingAt }] of latestFinishedByShow) {
            if (nowUnix - airingAt > 30 * 24 * 60 * 60) continue

            const [watchedEps, dismissedEps] = await Promise.all([
              WatchedEpisodesRepository.getWatchedEpisodeNumbers(db, watchlistId),
              NotificationsRepository.getDismissedByShow(db, watchlistId),
            ])

            const watchedSet = new Set(watchedEps.map((e) => e.toString()))
            const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

            if (!watchedSet.has(episodeKey) && !dismissedSet.has(episodeKey)) {
              await NotificationsRepository.addDiscovered(db, watchlistId, episodeKey)
              db.scheduleSave()
            }
          }
        }

        const latestByShow = new Map<string, { episodeKey: string; airingAt: number }>()
        for (const entry of schedules) {
          if (entry.airingAt > nowUnix) continue

          const watchlistId = reverseMap.get(entry.mediaId)
          if (!watchlistId) continue

          const current = latestByShow.get(watchlistId)
          if (!current || entry.airingAt > current.airingAt) {
            latestByShow.set(watchlistId, {
              episodeKey: String(Math.round(entry.episode)),
              airingAt: entry.airingAt,
            })
          }
        }

        for (const [watchlistId, { episodeKey, airingAt }] of latestByShow) {
          const [watchedEps, dismissedEps] = await Promise.all([
            WatchedEpisodesRepository.getWatchedEpisodeNumbers(db, watchlistId),
            NotificationsRepository.getDismissedByShow(db, watchlistId),
          ])

          const watchedSet = new Set(watchedEps.map((e) => e.toString()))
          const dismissedSet = new Set(dismissedEps.map((e) => e.episodeNumber.toString()))

          if (!watchedSet.has(episodeKey) && !dismissedSet.has(episodeKey)) {
            await NotificationsRepository.addDiscovered(db, watchlistId, episodeKey)
            db.scheduleSave()
          }
        }

        await NotificationsRepository.cleanupWatchedNotifications(db)
      } catch (e) {
        this.discoveryState = 'error'
        if ((e as Error)?.message === 'Database is closed') {
          logger.info('Notification discovery stopped: database is closed')
        } else {
          logger.error({ err: e }, 'AniList notification discovery failed')
        }
      } finally {
        this.discoveryBusy = false
        this.lastDiscoveryRunAt = Date.now()
        if (this.discoveryState === 'running') {
          this.discoveryState = this.discoveryTotal === 0 ? 'empty' : 'complete'
        }
      }
    }

    this.triggerDiscovery = (force = false) => {
      if (this.stopped || this.discoveryBusy) return false
      const now = Date.now()
      if (!force && now - this.lastExternalDiscoveryAt < NUDGE_THROTTLE_MS) return false
      this.lastExternalDiscoveryAt = now
      runDiscovery(force)
      return true
    }

    this.discoveryIntervalId = setInterval(() => {
      if (!this.stopped) runDiscovery(false)
    }, BACKGROUND_DISCOVERY_INTERVAL_MS)
  }

  private showsMetaChanged(
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
      differs(candidate.anilistId, existing.anilistId)
    )
  }

  private normalizeFilterValue(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed && trimmed !== 'ALL' ? trimmed : undefined
  }

  private getWatchlistFilters(query: Request['query']): WatchlistFilterOptions {
    return {
      query: this.normalizeFilterValue(query.query),
      type: this.normalizeFilterValue(query.type),
      season: this.normalizeFilterValue(query.season),
      year: this.normalizeFilterValue(query.year),
      genres: this.normalizeFilterValue(query.genres),
      excludeGenres: this.normalizeFilterValue(query.excludeGenres),
      sortBy: this.normalizeFilterValue(query.sortBy),
      titlePreference: ['name', 'nativeName', 'englishName'].includes(String(query.titlePreference))
        ? (query.titlePreference as 'name' | 'nativeName' | 'englishName')
        : 'name',
    }
  }

  private matchesLocalFilters<
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

    if (filters.type && row.type !== filters.type) return false

    return true
  }

  private sortFilteredRows<T extends { name?: string; nativeName?: string; englishName?: string }>(
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

  private async getAnilistSeasonYearMatches(
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

  private rowMatchesAnilistSeasonYear<
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

  private async filterWatchlistRows<
    T extends {
      id: string
      name?: string
      nativeName?: string
      englishName?: string
      type?: string
    },
  >(rows: T[], filters: WatchlistFilterOptions, db?: DatabaseWrapper): Promise<T[]> {
    let filtered = rows.filter((row) => this.matchesLocalFilters(row, filters))

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
      const includeList = filters.genres?.split(',') || []
      const excludeList = filters.excludeGenres?.split(',') || []

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
      const anilistMatches = await this.getAnilistSeasonYearMatches(filters.season, filters.year)
      if (anilistMatches.size > 0) {
        filtered = filtered.filter((row) => this.rowMatchesAnilistSeasonYear(row, anilistMatches))
      }
    }

    return this.sortFilteredRows(filtered, filters)
  }

  private async getContinueWatchingData(
    req: Request,
    limit?: number
  ): Promise<CombinedContinueWatchingShow[]> {
    const rows = await WatchedEpisodesRepository.getContinueWatching(req.db, limit)

    const enrichedRows = rows.map((show) => ({
      ...show,
      episodeCount: show.episodeCount,
      type: show.type || show.smType,
      thumbnail: show.thumbnail ?? '',
    }))

    return enrichedRows
  }

  getAllContinueWatching = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1
    const limit = parseInt(req.query.limit as string) || 10
    const offset = (page - 1) * limit
    const filters = this.getWatchlistFilters(req.query)
    const data = await this.filterWatchlistRows(
      await this.getContinueWatchingData(req),
      filters,
      req.db
    )

    res.json({
      data: data.slice(offset, offset + limit),
      total: data.length,
      page,
      limit,
    })
  }

  updateProgress = async (req: Request, res: Response) => {
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
    } = req.body

    const showId = await getMigratedId(req.db, showIdRaw)

    const titlePreferenceRow = await SettingsRepository.getByKey(req.db, 'titlePreference')
    const titlePreference = titlePreferenceRow ? titlePreferenceRow.value : 'englishName'

    let displayName = showName
    if (titlePreference === 'englishName' && englishName) {
      displayName = englishName
    } else if (titlePreference === 'nativeName' && nativeName) {
      displayName = nativeName
    }

    discordRPCService.updatePresence({
      title: displayName,
      episode: String(episodeNumber),
      totalEpisodes: episodeCount ? String(episodeCount) : undefined,
      currentTime: currentTime || 0,
      duration: duration || 0,
      thumbnail: showThumbnail || '',
      isPlaying: isPlaying !== false,
      sessionId,
      isAdult,
    })

    const genresStr = Array.isArray(genres) ? JSON.stringify(genres) : genres
    const anilistId = /^\d+$/.test(showId)
      ? (dbGet<{ anilistId: number }>(
          req.db,
          'SELECT anilistId FROM shows_meta WHERE id = ? AND anilistId IS NOT NULL',
          [showId]
        )?.anilistId ?? parseInt(showId))
      : undefined

    const metaCandidate = {
      name: showName,
      thumbnail: showThumbnail,
      nativeName,
      englishName,
      genres: genresStr,
      popularityScore,
      status,
      episodeCount,
      type,
      anilistId,
    }

    const metaChanged = this.showsMetaChanged(req.db, showId, metaCandidate)

    if (metaChanged) {
      await performWriteTransaction(req.db, (tx) => {
        ShowsMetaRepository.upsert(tx, {
          id: showId,
          ...metaCandidate,
        })
      })
    }

    await performWriteTransaction(req.db, (tx) => {
      WatchedEpisodesRepository.upsert(tx, {
        showId,
        episodeNumber,
        currentTime,
        duration,
      })

      NotificationsRepository.deleteSpecificDismissed(tx, showId, episodeNumber)
    })

    req.db.scheduleSave()

    res.json({ success: true })
  }

  removeContinueWatching = async (req: Request, res: Response) => {
    const { showId: showIdRaw } = req.body
    const showId = await getMigratedId(req.db, showIdRaw)
    await performWriteTransaction(req.db, (tx) => {
      WatchedEpisodesRepository.deleteByShow(tx, showId)
      NotificationsRepository.deleteByShow(tx, showId)
    })
    res.json({ success: true })
  }

  batchRemoveContinueWatching = async (req: Request, res: Response) => {
    const { ids: idsRaw } = req.body
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }

    const ids = await Promise.all(idsRaw.map((id: string) => getMigratedId(req.db, id)))
    await performWriteTransaction(req.db, (tx) => {
      for (const id of ids) {
        WatchedEpisodesRepository.deleteByShow(tx, id)
        NotificationsRepository.deleteByShow(tx, id)
      }
    })

    req.db.scheduleSave()
    res.json({ success: true, removed: ids.length })
  }

  getWatchlist = async (req: Request, res: Response) => {
    const { status, page: pageStr, limit: limitStr } = req.query
    const page = parseInt(pageStr as string) || 1
    const limit = parseInt(limitStr as string) || 10
    const offset = (page - 1) * limit
    const filters = this.getWatchlistFilters(req.query)

    const allRows = await WatchlistRepository.getAll(req.db, status as string)
    const filteredRows = await this.filterWatchlistRows(allRows, filters, req.db)
    const rows = filteredRows.slice(offset, offset + limit)

    res.json({
      data: rows.map((row) => ({
        ...row,
        _id: row.id,
        thumbnail: row.thumbnail || '',
      })),
      total: filteredRows.length,
      page,
      limit,
    })
  }

  checkWatchlist = async (req: Request, res: Response) => {
    const showId = await getMigratedId(req.db, req.params.showId as string)
    const item = await WatchlistRepository.getById(req.db, showId)
    res.json({ inWatchlist: !!item, status: item?.status ?? null })
  }

  getQueue = async (req: Request, res: Response) => {
    const rows = await QueueRepository.getAll(req.db)
    res.json(
      rows.map((row) => ({
        ...row,
        _id: row.showId,
        id: row.id,
        thumbnail: row.thumbnail || '',
      }))
    )
  }

  addToQueue = async (req: Request, res: Response) => {
    const {
      showId: showIdRaw,
      episodeNumber,
      showName,
      showThumbnail,
      nativeName,
      englishName,
      type,
    } = req.body

    if (!showIdRaw || !episodeNumber) {
      return res.status(400).json({ error: 'showId and episodeNumber are required' })
    }

    const showId = await getMigratedId(req.db, showIdRaw)

    const existing = await QueueRepository.getByEpisode(req.db, showId, String(episodeNumber))

    await performWriteTransaction(req.db, (tx) => {
      if (showName || showThumbnail || nativeName || englishName || type) {
        ShowsMetaRepository.upsert(tx, {
          id: showId,
          name: showName || '',
          thumbnail: showThumbnail || '',
          nativeName,
          englishName,
          type,
        })
      }

      if (existing) {
        QueueRepository.removeEpisode(tx, showId, String(episodeNumber))
      } else {
        QueueRepository.addToEnd(tx, showId, String(episodeNumber))
      }
    })

    req.db.scheduleSave()
    res.json({ success: true, queued: !existing })
  }

  removeFromQueue = async (req: Request, res: Response) => {
    const { showId: showIdRaw, episodeNumber } = req.body
    const showId = await getMigratedId(req.db, showIdRaw)
    await performWriteTransaction(req.db, (tx) => {
      QueueRepository.removeEpisode(tx, showId, String(episodeNumber))
    })
    res.json({ success: true })
  }

  clearQueue = async (req: Request, res: Response) => {
    await performWriteTransaction(req.db, (tx) => {
      QueueRepository.clear(tx)
    })
    res.json({ success: true })
  }

  reorderQueue = async (req: Request, res: Response) => {
    const { items } = req.body
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' })
    }

    await performWriteTransaction(req.db, (tx) => {
      QueueRepository.reorder(tx, items)
    })
    res.json({ success: true })
  }

  private async resolveAvailableEpisodes(db: DatabaseWrapper, showId: string): Promise<string[]> {
    const episodeData = await getAnilistEpisodes(showId)
    const episodes =
      Array.isArray(episodeData) && episodeData.length
        ? [...episodeData].sort((a, b) => parseFloat(a) - parseFloat(b))
        : []
    return episodes
  }

  getQueueRemainingEpisodes = async (req: Request, res: Response) => {
    const showIdRaw = req.params.showId as string
    const showId = await getMigratedId(req.db, showIdRaw)

    const [watchedEpisodes, queuedEpisodes, episodes] = await Promise.all([
      WatchedEpisodesRepository.getByShow(req.db, showId),
      QueueRepository.getByShow(req.db, showId),
      this.resolveAvailableEpisodes(req.db, showId),
    ])

    const watchedSet = new Set(watchedEpisodes.map((ep) => ep.episodeNumber.toString()))
    const queuedSet = new Set(queuedEpisodes.map((ep) => ep.episodeNumber.toString()))

    const remaining = episodes.filter((ep) => !watchedSet.has(ep) && !queuedSet.has(ep))

    res.json({ showId, episodes: remaining })
  }

  addToQueueBatch = async (req: Request, res: Response) => {
    const {
      showId: showIdRaw,
      episodeNumbers,
      showName,
      showThumbnail,
      nativeName,
      englishName,
      type,
    } = req.body

    if (!showIdRaw || !Array.isArray(episodeNumbers) || episodeNumbers.length === 0) {
      return res.status(400).json({ error: 'showId and episodeNumbers are required' })
    }

    const showId = await getMigratedId(req.db, showIdRaw)
    const normalized = [...new Set(episodeNumbers.map((ep: string) => String(ep)))]

    await performWriteTransaction(req.db, (tx) => {
      if (showName || showThumbnail || nativeName || englishName || type) {
        ShowsMetaRepository.upsert(tx, {
          id: showId,
          name: showName || '',
          thumbnail: showThumbnail || '',
          nativeName,
          englishName,
          type,
        })
      }
      return QueueRepository.addManyToEnd(
        tx,
        normalized.map((episodeNumber) => ({ showId, episodeNumber }))
      )
    })

    req.db.scheduleSave()
    res.json({ success: true, added: normalized.length })
  }

  removeFromQueueBatch = async (req: Request, res: Response) => {
    const { showId: showIdRaw, episodeNumbers } = req.body
    if (!showIdRaw) {
      return res.status(400).json({ error: 'showId is required' })
    }

    const showId = await getMigratedId(req.db, showIdRaw)

    let removed: string[]
    await performWriteTransaction(req.db, (tx) => {
      removed = (QueueRepository.getByShow(tx, showId) || []).map((ep) => ep.episodeNumber)
      const toRemove =
        Array.isArray(episodeNumbers) && episodeNumbers.length
          ? [...new Set(episodeNumbers.map((ep: string) => String(ep)))]
          : removed
      return QueueRepository.removeMany(tx, showId, toRemove)
    })

    res.json({ success: true, removed: removed!.length })
  }

  getSuggestedQueueEpisode = async (req: Request, res: Response) => {
    const showIdRaw = req.params.showId as string
    const showId = await getMigratedId(req.db, showIdRaw)
    const resumeProgress = await WatchedEpisodesRepository.getLatestResumeProgress(req.db, showId)

    if (resumeProgress) {
      return res.json({
        showId,
        episodeNumber: resumeProgress.episodeNumber,
        resumeTime: resumeProgress.currentTime || 0,
      })
    }

    const [watchedEpisodes, episodes] = await Promise.all([
      WatchedEpisodesRepository.getByShow(req.db, showId),
      this.resolveAvailableEpisodes(req.db, showId),
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

    res.json({ showId, episodeNumber, resumeTime: 0 })
  }

  getEpisodeProgress = async (req: Request, res: Response) => {
    const showId = await getMigratedId(req.db, req.params.showId as string)
    const progress = await WatchedEpisodesRepository.getByShowAndEpisode(
      req.db,
      showId,
      req.params.episodeNumber as string
    )
    res.json(progress || { currentTime: 0, duration: 0 })
  }

  getWatchedEpisodes = async (req: Request, res: Response) => {
    const showId = await getMigratedId(req.db, req.params.showId as string)
    const episodes = await WatchedEpisodesRepository.getWatchedEpisodeNumbers(req.db, showId)
    res.json(episodes)
  }

  addToWatchlist = async (req: Request, res: Response) => {
    const { id: idRaw, status, nativeName, englishName } = req.body
    const { name, thumbnail, type } = req.body
    const id = await getMigratedId(req.db, idRaw)

    await performWriteTransaction(req.db, (tx) => {
      WatchlistRepository.upsert(tx, {
        id,
        name,
        thumbnail: thumbnail,
        status: status || 'Watching',
        nativeName: nativeName || '',
        englishName: englishName || '',
        type: type || 'TV',
      })
    })

    await req.db.saveNow()

    if (name && !/^\d+$/.test(id)) {
      const resolveAndSave = async (): Promise<void> => {
        if (!isAnilistRateLimited()) {
          const result = await searchAnilistByTitle(name)
          if (result?.id) {
            ShowsMetaRepository.upsert(req.db, { id, anilistId: result.id })
            req.db.scheduleSave()
            return
          }
        }
        try {
          const kitsuResults = await kitsuSearchAnime({ query: name, page: 1, perPage: 3 })
          if (kitsuResults.length > 0) {
            const anilistId = Math.abs(kitsuResults[0].id)
            ShowsMetaRepository.upsert(req.db, { id, anilistId })
            req.db.scheduleSave()
          }
        } catch {
          // Kitsu failed, show will be skipped in discovery
        }
      }
      resolveAndSave().catch(() => {})
    }

    res.json({ success: true })
  }

  removeFromWatchlist = async (req: Request, res: Response) => {
    const { id: idRaw } = req.body
    const id = await getMigratedId(req.db, idRaw)
    await performWriteTransaction(req.db, (tx) => {
      WatchlistRepository.delete(tx, id)
      NotificationsRepository.deleteByShow(tx, id)
    })
    res.json({ success: true })
  }

  updateWatchlistStatus = async (req: Request, res: Response) => {
    const { id: idRaw, status } = req.body
    const id = await getMigratedId(req.db, idRaw)
    await performWriteTransaction(req.db, (tx) => {
      WatchlistRepository.updateStatus(tx, id, status)
    })
    res.json({ success: true })
  }

  batchUpdateWatchlistStatus = async (req: Request, res: Response) => {
    const { ids: idsRaw, status } = req.body
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }
    if (!status) {
      return res.status(400).json({ error: 'status is required' })
    }

    const ids = await Promise.all(idsRaw.map((id: string) => getMigratedId(req.db, id)))
    await performWriteTransaction(req.db, (tx) => {
      WatchlistRepository.updateStatusMany(tx, ids, status)
    })

    req.db.scheduleSave()
    res.json({ success: true, updated: ids.length })
  }

  batchRemoveFromWatchlist = async (req: Request, res: Response) => {
    const { ids: idsRaw } = req.body
    if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array' })
    }

    const ids = await Promise.all(idsRaw.map((id: string) => getMigratedId(req.db, id)))
    await performWriteTransaction(req.db, (tx) => {
      WatchlistRepository.deleteMany(tx, ids)
      for (const id of ids) {
        NotificationsRepository.deleteByShow(tx, id)
      }
    })

    req.db.scheduleSave()
    res.json({ success: true, removed: ids.length })
  }

  getNotifications = async (req: Request, res: Response) => {
    const db = req.db
    const watchingShows = await WatchlistRepository.getWatchingShows(db)

    const notifications: EpisodeNotification[] = []

    for (const show of watchingShows) {
      try {
        const [watchedEps, dismissedEps, discoveredEps] = await Promise.all([
          WatchedEpisodesRepository.getWatchedEpisodeNumbers(db, show.id),
          NotificationsRepository.getDismissedByShow(db, show.id),
          NotificationsRepository.getDiscoveredByShow(db, show.id),
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

    res.json(
      notifications.sort((a, b) => parseFloat(b.episodeNumber) - parseFloat(a.episodeNumber))
    )
  }

  dismissNotification = async (req: Request, res: Response) => {
    const { showId, episodeNumber } = req.body
    await performWriteTransaction(req.db, (tx) => {
      NotificationsRepository.addDismissed(tx, showId, episodeNumber)
    })
    res.json({ success: true })
  }

  clearAllNotifications = async (req: Request, res: Response) => {
    const { showId } = req.body
    await performWriteTransaction(req.db, (tx) => {
      NotificationsRepository.dismissFromDiscovered(tx, showId)
    })
    res.json({ success: true })
  }

  getThisWeekSchedule = async (req: Request, res: Response) => {
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
      req.db,
      `SELECT
        w.id, w.name, w.thumbnail, w.nativeName, w.englishName, w.type,
        dn.episodeNumber, dn.discoveredAt
      FROM discovered_notifications dn
      JOIN watchlist w ON dn.showId = w.id
      WHERE w.status = 'Watching'
        AND dn.episodeNumber = (
          SELECT MAX(CAST(dn2.episodeNumber AS INTEGER))
          FROM discovered_notifications dn2
          WHERE dn2.showId = dn.showId
            AND dn2.discoveredAt >= datetime('now', '-7 days')
            AND NOT EXISTS (
              SELECT 1 FROM watched_episodes we2
              WHERE we2.showId = dn2.showId AND we2.episodeNumber = dn2.episodeNumber
            )
        )
        AND dn.discoveredAt >= datetime('now', '-7 days')
        AND NOT EXISTS (
          SELECT 1 FROM watched_episodes we
          WHERE we.showId = dn.showId AND we.episodeNumber = dn.episodeNumber
        )
      ORDER BY CAST(dn.episodeNumber AS INTEGER) DESC`
    )

    res.json(
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
  }
}

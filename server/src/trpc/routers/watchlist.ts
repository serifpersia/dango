import { protectedProcedure, router } from '../index.js'
import type { DatabaseWrapper } from '../../db.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import {
  WatchedEpisodesRepository,
  type ContinueWatchingResult,
} from '../../repositories/watched-episodes.repository.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { NotificationsRepository } from '../../repositories/notifications.repository.js'
import { QueueRepository } from '../../repositories/queue.repository.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { performWriteTransactionAsync } from '../../sync.js'
import { getMigratedId } from '../../lib/migration.js'
import {
  isAnilistRateLimited,
  searchAnilist,
  searchAnilistByTitle,
  getAnilistEpisodes,
  getShowMetaById,
} from '../../lib/anilist.js'
import { kitsuSearchAnime } from '../../lib/kitsu.js'
import { offlineDb } from '../../lib/offline-db.js'
import { dbAll } from '../../utils/db-utils.js'
import {
  defineSchema,
  idInput,
  idsInput,
  optStr,
  reqObj,
  showIdInput,
  watchlistAddInput,
  watchlistBatchStatusInput,
  watchlistStatusInput,
} from '../validation.js'

const watchlistListInput = () =>
  defineSchema<WatchlistListInput, WatchlistListInput>((value) => {
    const obj = reqObj(value)
    const out: WatchlistListInput = { ...readFilterFields(obj) }
    const status = optStr(obj, 'status')
    if (status !== undefined) out.status = status
    const page = optNum(obj, 'page')
    if (page !== undefined) out.page = page
    const limit = optNum(obj, 'limit')
    if (limit !== undefined) out.limit = limit
    const showMature = optStr(obj, 'showMature')
    if (showMature !== undefined) out.showMature = showMature
    return out
  })

const continueWatchingAllInput = () =>
  defineSchema<ContinueWatchingAllInput, ContinueWatchingAllInput>((value) => {
    const obj = reqObj(value)
    const out: ContinueWatchingAllInput = { ...readFilterFields(obj) }
    const page = optNum(obj, 'page')
    if (page !== undefined) out.page = page
    const limit = optNum(obj, 'limit')
    if (limit !== undefined) out.limit = limit
    return out
  })

export const watchlistRouter = router({
  check: protectedProcedure.input(showIdInput()).query(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    const item = await WatchlistRepository.getById(ctx.db, showId)
    return { inWatchlist: !!item, status: item?.status ?? null }
  }),

  add: protectedProcedure.input(watchlistAddInput()).mutation(async ({ ctx, input }) => {
    const id = await getMigratedId(ctx.db, input.id)
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await WatchlistRepository.upsert(tx, {
        id,
        name: input.name,
        thumbnail: input.thumbnail || '',
        status: input.status || 'Watching',
        nativeName: input.nativeName || '',
        englishName: input.englishName || '',
        type: input.type || 'TV',
      })
      if (typeof input.isAdult === 'boolean') {
        await ShowsMetaRepository.upsert(tx, { id, isAdult: input.isAdult ? 1 : 0 })
      }
    })

    await ctx.db.saveNow()

    if (input.name && !/^\d+$/.test(id)) {
      const db = ctx.db
      const name = input.name
      const resolveAndSave = async (): Promise<void> => {
        if (!isAnilistRateLimited()) {
          const result = await searchAnilistByTitle(name)
          if (result?.id) {
            await ShowsMetaRepository.upsert(db, { id, anilistId: result.id })
            db.scheduleSave()
            return
          }
        }
        try {
          const kitsuResults = await kitsuSearchAnime({ query: name, page: 1, perPage: 3 })
          if (kitsuResults.length > 0) {
            const anilistId = Math.abs(kitsuResults[0].id)
            await ShowsMetaRepository.upsert(db, { id, anilistId })
            db.scheduleSave()
          }
        } catch {
          // ignore
        }
      }
      void resolveAndSave().catch(() => {})
    }

    return { success: true }
  }),

  remove: protectedProcedure.input(idInput()).mutation(async ({ ctx, input }) => {
    const id = await getMigratedId(ctx.db, input.id)
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await WatchlistRepository.delete(tx, id)
      await WatchedEpisodesRepository.deleteByShow(tx, id)
      await NotificationsRepository.deleteByShow(tx, id)
    })
    return { success: true }
  }),

  removeMany: protectedProcedure.input(idsInput()).mutation(async ({ ctx, input }) => {
    const ids = await Promise.all(input.ids.map((id) => getMigratedId(ctx.db, id)))
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await WatchlistRepository.deleteMany(tx, ids)
      for (const id of ids) {
        await WatchedEpisodesRepository.deleteByShow(tx, id)
        await NotificationsRepository.deleteByShow(tx, id)
      }
    })
    ctx.db.scheduleSave()
    return { success: true, removed: ids.length }
  }),

  setStatus: protectedProcedure.input(watchlistStatusInput()).mutation(async ({ ctx, input }) => {
    const id = await getMigratedId(ctx.db, input.id)
    await performWriteTransactionAsync(ctx.db, async (tx) => {
      await WatchlistRepository.updateStatus(tx, id, input.status)
    })
    return { success: true }
  }),

  batchStatus: protectedProcedure
    .input(watchlistBatchStatusInput())
    .mutation(async ({ ctx, input }) => {
      const ids = await Promise.all(input.ids.map((id) => getMigratedId(ctx.db, id)))
      await performWriteTransactionAsync(ctx.db, async (tx) => {
        await WatchlistRepository.updateStatusMany(tx, ids, input.status)
      })
      ctx.db.scheduleSave()
      return { success: true, updated: ids.length }
    }),

  list: protectedProcedure.input(watchlistListInput()).query(async ({ ctx, input }) => {
    const db = ctx.db
    const page = Math.max(parseInt(String(input.page ?? 1)) || 1, 1)
    const limit = Math.min(Math.max(parseInt(String(input.limit ?? 10)) || 10, 1), 100)
    const showMature = input.showMature
    const offset = (page - 1) * limit
    const filters = getWatchlistFilters({
      query: input.query,
      type: input.type,
      season: input.season,
      year: input.year,
      genres: input.genres,
      excludeGenres: input.excludeGenres,
      sortBy: input.sortBy,
      titlePreference: input.titlePreference,
    })
    const status = input.status

    const allRows = await WatchlistRepository.getAll(db, status)

    let filteredRows = await filterWatchlistRows(allRows, filters, db)

    if (showMature === 'false') {
      const ids = filteredRows.map((r) => r.id)
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',')
        const adultIds = await dbAll<{ id: string }>(
          db,
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
          const meta = (await ShowsMetaRepository.getById(db, row.id)) as {
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
    await backfillMissingPosters(db, rows)

    const rowIds = rows.map((r) => r.id)
    let adultIds = new Set<string>()
    if (rowIds.length > 0) {
      const placeholders = rowIds.map(() => '?').join(',')
      const adultRows = await dbAll<{ id: string }>(
        db,
        `SELECT id FROM shows_meta WHERE id IN (${placeholders}) AND isAdult = 1`,
        rowIds
      )
      adultIds = new Set(adultRows.map((r) => r.id))
    }

    return {
      data: rows.map((row) => ({
        ...row,
        _id: row.id,
        thumbnail: row.thumbnail || '',
        isAdult: adultIds.has(row.id),
      })),
      total: filteredRows.length,
      page,
      limit,
    }
  }),

  continueWatchingAll: protectedProcedure
    .input(continueWatchingAllInput())
    .query(async ({ ctx, input }) => {
      const db = ctx.db
      const page = Math.max(parseInt(String(input.page ?? 1)) || 1, 1)
      const limit = Math.min(Math.max(parseInt(String(input.limit ?? 10)) || 10, 1), 100)
      const offset = (page - 1) * limit
      const filters = getWatchlistFilters({
        query: input.query,
        type: input.type,
        season: input.season,
        year: input.year,
        genres: input.genres,
        excludeGenres: input.excludeGenres,
        sortBy: input.sortBy,
        titlePreference: input.titlePreference,
      })
      const data = await filterWatchlistRows(await getContinueWatchingData(db), filters, db)

      return {
        data: data.slice(offset, offset + limit),
        total: data.length,
        page,
        limit,
      }
    }),

  queueSuggested: protectedProcedure.input(showIdInput()).query(async ({ ctx, input }) => {
    const db = ctx.db
    const showId = await getMigratedId(db, input.showId)
    const resumeProgress = await WatchedEpisodesRepository.getLatestResumeProgress(db, showId)

    if (resumeProgress) {
      return {
        showId,
        episodeNumber: resumeProgress.episodeNumber,
        resumeTime: resumeProgress.currentTime || 0,
      }
    }

    const [watchedEpisodes, episodes] = await Promise.all([
      WatchedEpisodesRepository.getByShow(db, showId),
      resolveAvailableEpisodes(db, showId),
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

    return { showId, episodeNumber, resumeTime: 0 }
  }),

  queueRemaining: protectedProcedure.input(showIdInput()).query(async ({ ctx, input }) => {
    const db = ctx.db
    const showId = await getMigratedId(db, input.showId)

    const [watchedEpisodes, queuedEpisodes, episodes] = await Promise.all([
      WatchedEpisodesRepository.getByShow(db, showId),
      QueueRepository.getByShow(db, showId),
      resolveAvailableEpisodes(db, showId),
    ])

    const watchedSet = new Set(watchedEpisodes.map((ep) => ep.episodeNumber.toString()))
    const queuedSet = new Set(queuedEpisodes.map((ep) => ep.episodeNumber.toString()))

    const remaining = episodes.filter((ep) => !watchedSet.has(ep) && !queuedSet.has(ep))

    return { showId, episodes: remaining }
  }),
})

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

export type WatchlistListInput = {
  status?: string
  page?: number
  limit?: number
  showMature?: string
  query?: string
  type?: string
  season?: string
  year?: string
  genres?: string
  excludeGenres?: string
  sortBy?: string
  titlePreference?: string
}

export type ContinueWatchingAllInput = {
  page?: number
  limit?: number
  query?: string
  type?: string
  season?: string
  year?: string
  genres?: string
  excludeGenres?: string
  sortBy?: string
  titlePreference?: string
}

function optNum(obj: Record<string, unknown>, name: string): number | undefined {
  const value = obj[name]
  if (value === undefined || value === null || value === '') return undefined
  const num = Number(value)
  return Number.isFinite(num) ? num : undefined
}

function readFilterFields(
  obj: Record<string, unknown>
): Pick<
  WatchlistListInput,
  'query' | 'type' | 'season' | 'year' | 'genres' | 'excludeGenres' | 'sortBy' | 'titlePreference'
> {
  const out: Pick<
    WatchlistListInput,
    'query' | 'type' | 'season' | 'year' | 'genres' | 'excludeGenres' | 'sortBy' | 'titlePreference'
  > = {}
  const query = optStr(obj, 'query')
  if (query !== undefined) out.query = query
  const type = optStr(obj, 'type')
  if (type !== undefined) out.type = type
  const season = optStr(obj, 'season')
  if (season !== undefined) out.season = season
  const year = optStr(obj, 'year')
  if (year !== undefined) out.year = year
  const genres = optStr(obj, 'genres')
  if (genres !== undefined) out.genres = genres
  const excludeGenres = optStr(obj, 'excludeGenres')
  if (excludeGenres !== undefined) out.excludeGenres = excludeGenres
  const sortBy = optStr(obj, 'sortBy')
  if (sortBy !== undefined) out.sortBy = sortBy
  const titlePreference = optStr(obj, 'titlePreference')
  if (titlePreference !== undefined) out.titlePreference = titlePreference
  return out
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
          await ShowsMetaRepository.upsert(db, {
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
    await ShowsMetaRepository.upsert(db, { id, thumbnail: poster })
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

async function resolveAvailableEpisodes(db: DatabaseWrapper, showId: string): Promise<string[]> {
  const episodeData = await getAnilistEpisodes(showId)
  const episodes =
    Array.isArray(episodeData) && episodeData.length
      ? [...episodeData].sort((a, b) => parseFloat(a) - parseFloat(b))
      : []
  return episodes
}

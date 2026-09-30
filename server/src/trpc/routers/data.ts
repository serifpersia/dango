import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import {
  badRequest,
  defineSchema,
  failed,
  optNum,
  optStr,
  readCount,
  reqObj,
  reqStr,
} from '../validation.js'
import { parseJsonBody } from '../../utils/http.utils.js'
import {
  getTrending,
  getLatestReleases,
  getSeasonal,
  getSchedule,
  searchAnilist,
  searchAnilistByTitle,
  getSpotlightBanners,
  getBatchedHomeData,
  getGenreTagLists,
  anilistUnavailable,
  wasAnilistDownAtBoot,
  checkAnilistStatus,
  getShowMetaById,
  getAnilistEpisodes,
  parseMalId,
  getShowMetaByMalId,
  fromAnilistMedia,
} from '../../lib/anilist.js'
import { malAnimeDetail, malSearchMedia, malSearchTitle } from '../../lib/mal.js'
import { malCacheStore } from '../../repositories/mal-cache.repository.js'
import { getMigratedId } from '../../lib/migration.js'
import { isTempShowId } from '../../lib/temp-ids.js'
import { TempShowIdsRepository } from '../../repositories/temp-show-ids.repository.js'
import { pickBestMatch } from '../../providers/title-matching.js'
import { authRequiredError } from '../errors.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { dbRun } from '../../utils/db-utils.js'
import type { Provider } from '../../providers/provider.interface.js'
import type { AnilistMedia } from '../../lib/anilist.js'
import type { Show } from '../../providers/provider.interface.js'
import type { BrowseCaps } from '../../providers/remote-types.js'
import type { TrpcContext } from '../context.js'
import logger from '../../logger.js'

async function cached<T>(
  ctx: TrpcContext,
  key: string,
  ttl: number | undefined,
  validate: (data: unknown) => boolean,
  produce: () => Promise<T>
): Promise<T> {
  const hit = ctx.apiCache.get<T>(key)
  if (hit) return hit
  const body = await produce()
  if (validate(body)) {
    if (ttl !== undefined) ctx.apiCache.set(key, body, ttl)
    else ctx.apiCache.set(key, body)
  }
  return body
}

const defaultValidate = (d: unknown) => Array.isArray(d) && d.length > 0

export type DataScheduleInput = { date: string; format?: string }

const dataScheduleInput = () =>
  defineSchema<DataScheduleInput, DataScheduleInput>((value) => {
    const obj = reqObj(value)
    const out: DataScheduleInput = { date: reqStr(obj, 'date') }
    const format = optStr(obj, 'format')
    if (format !== undefined) out.format = format
    return out
  })

export type DataLatestReleasesInput = { format?: string; page?: number; size?: number }

const dataLatestReleasesInput = () =>
  defineSchema<DataLatestReleasesInput, DataLatestReleasesInput>((value) => {
    const obj = reqObj(value)
    const out: DataLatestReleasesInput = {}
    const format = optStr(obj, 'format')
    if (format !== undefined) out.format = format
    if (obj.page !== undefined) out.page = readCount(obj, 'page', 1)
    if (obj.size !== undefined) out.size = readCount(obj, 'size', 12)
    return out
  })

export type DataSearchInput = {
  query?: string
  page?: number
  limit?: number
  sortBy?: string
  type?: string
  status?: string
  season?: string
  year?: string | number
  country?: string
  genres?: string
  excludeGenres?: string
  excludeTags?: string
  minScore?: string | number
  minEpisodes?: string | number
  adult?: string
}

type DataSearchParsed = {
  query?: string
  page?: number
  limit?: number
  sortBy?: string
  type?: string
  status?: string
  season?: string
  year?: number
  country?: string
  genres?: string
  excludeGenres?: string
  excludeTags?: string
  minScore?: number
  minEpisodes?: number
  adult?: string
}

const dataSearchInput = () =>
  defineSchema<DataSearchInput, DataSearchParsed>((value) => {
    const obj = reqObj(value)
    const out: DataSearchParsed = {}
    const query = optStr(obj, 'query')
    if (query !== undefined) out.query = query
    if (obj.page !== undefined) out.page = readCount(obj, 'page', 1)
    if (obj.limit !== undefined) out.limit = readCount(obj, 'limit', 14)
    const sortBy = optStr(obj, 'sortBy')
    if (sortBy !== undefined) out.sortBy = sortBy
    const type = optStr(obj, 'type')
    if (type !== undefined) out.type = type
    const status = optStr(obj, 'status')
    if (status !== undefined) out.status = status
    const season = optStr(obj, 'season')
    if (season !== undefined) out.season = season
    const year = optNum(obj, 'year')
    if (year !== undefined) out.year = year
    const country = optStr(obj, 'country')
    if (country !== undefined) out.country = country
    const genres = optStr(obj, 'genres')
    if (genres !== undefined) out.genres = genres
    const excludeGenres = optStr(obj, 'excludeGenres')
    if (excludeGenres !== undefined) out.excludeGenres = excludeGenres
    const excludeTags = optStr(obj, 'excludeTags')
    if (excludeTags !== undefined) out.excludeTags = excludeTags
    const minScore = optNum(obj, 'minScore')
    if (minScore !== undefined) out.minScore = minScore
    const minEpisodes = optNum(obj, 'minEpisodes')
    if (minEpisodes !== undefined) out.minEpisodes = minEpisodes
    const adult = optStr(obj, 'adult')
    if (adult !== undefined) out.adult = adult
    return out
  })

export type DataMatureResolveInput = { title?: string }

const dataMatureResolveInput = () =>
  defineSchema<DataMatureResolveInput, DataMatureResolveInput>((value) => {
    const obj = reqObj(value)
    const out: DataMatureResolveInput = {}
    const title = optStr(obj, 'title')
    if (title !== undefined) out.title = title
    return out
  })

export type DataSkipTimesInput = { showId?: string; episodeNumber?: string }

const dataSkipTimesInput = () =>
  defineSchema<DataSkipTimesInput, DataSkipTimesInput>((value) => {
    const obj = reqObj(value)
    const out: DataSkipTimesInput = {}
    const showId = optStr(obj, 'showId')
    if (showId !== undefined) out.showId = showId
    const episodeNumber = optStr(obj, 'episodeNumber')
    if (episodeNumber !== undefined) out.episodeNumber = episodeNumber
    return out
  })

export type DataSeasonalInput = { page?: number; size?: number; format?: string }

const dataSeasonalInput = () =>
  defineSchema<DataSeasonalInput, DataSeasonalInput>((value) => {
    const obj = reqObj(value)
    const out: DataSeasonalInput = {}
    if (obj.page !== undefined) out.page = readCount(obj, 'page', 1)
    if (obj.size !== undefined) out.size = readCount(obj, 'size', 14)
    const format = optStr(obj, 'format')
    if (format !== undefined) out.format = format
    return out
  })

export type DataPopularListInput = { sort?: string; page?: number; size?: number }

const dataPopularListInput = () =>
  defineSchema<DataPopularListInput, DataPopularListInput>((value) => {
    const obj = reqObj(value)
    const out: DataPopularListInput = {}
    const sort = optStr(obj, 'sort')
    if (sort !== undefined) out.sort = sort
    if (obj.page !== undefined) out.page = readCount(obj, 'page', 1)
    if (obj.size !== undefined) out.size = readCount(obj, 'size', 20)
    return out
  })

export type DataHomeInput = { format?: string }

const dataHomeInput = () =>
  defineSchema<DataHomeInput, DataHomeInput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    const out: DataHomeInput = {}
    const format = optStr(obj, 'format')
    if (format !== undefined) out.format = format
    return out
  })

export type DataEpisodesInput = { showId?: string; mode?: 'sub' | 'dub'; provider?: string }

const dataEpisodesInput = () =>
  defineSchema<DataEpisodesInput, DataEpisodesInput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    const out: DataEpisodesInput = {}
    const showId = optStr(obj, 'showId')
    if (showId !== undefined) out.showId = showId
    const mode = optStr(obj, 'mode')
    if (mode === 'sub' || mode === 'dub') out.mode = mode
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    return out
  })

export type DataShowMetaInput = { id: string }

const dataShowMetaInput = () =>
  defineSchema<DataShowMetaInput, DataShowMetaInput>((value) => ({
    id: reqStr(reqObj(value), 'id'),
  }))

export type DataVideoInput = {
  showId?: string
  episodeNumber?: string
  mode?: 'sub' | 'dub'
  provider?: string
}

const dataVideoInput = () =>
  defineSchema<DataVideoInput, DataVideoInput>((value) => {
    if (value === undefined || value === null) return {}
    const obj = reqObj(value)
    const out: DataVideoInput = {}
    const showId = optStr(obj, 'showId')
    if (showId !== undefined) out.showId = showId
    const episodeNumber = optStr(obj, 'episodeNumber')
    if (episodeNumber !== undefined) out.episodeNumber = episodeNumber
    const mode = optStr(obj, 'mode')
    if (mode === 'sub' || mode === 'dub') out.mode = mode
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    return out
  })

export type DataMatureSearchInput = {
  provider?: string
  query?: string
  page?: number
  limit?: number
  type?: string
  status?: string
  season?: string
  year?: number
  country?: string
  genres?: string
  genre?: string
  excludeGenres?: string
  sortBy?: string
  order?: string
  studio?: string
  blacklist?: string
  minScore?: number
  minEpisodes?: number
}

const dataMatureSearchInput = () =>
  defineSchema<DataMatureSearchInput, DataMatureSearchInput>((value) => {
    const obj = reqObj(value)
    const out: DataMatureSearchInput = {}
    for (const k of [
      'provider',
      'query',
      'type',
      'status',
      'season',
      'country',
      'genres',
      'genre',
      'excludeGenres',
      'sortBy',
      'order',
      'studio',
      'blacklist',
    ] as const) {
      const v = optStr(obj, k)
      if (v !== undefined) out[k] = v
    }
    if (obj.page !== undefined) out.page = readCount(obj, 'page', 1)
    if (obj.limit !== undefined) out.limit = readCount(obj, 'limit', 14)
    const year = optNum(obj, 'year')
    if (year !== undefined) out.year = year
    const minScore = optNum(obj, 'minScore')
    if (minScore !== undefined) out.minScore = minScore
    const minEpisodes = optNum(obj, 'minEpisodes')
    if (minEpisodes !== undefined) out.minEpisodes = minEpisodes
    return out
  })

export type DataMatureAllocateInput = {
  provider?: string
  nativeId?: string
  title?: string
  thumbnail?: string
}

const dataMatureAllocateInput = () =>
  defineSchema<DataMatureAllocateInput, DataMatureAllocateInput>((value) => {
    const obj = reqObj(value)
    const out: DataMatureAllocateInput = {}
    const provider = optStr(obj, 'provider')
    if (provider !== undefined) out.provider = provider
    const nativeId = optStr(obj, 'nativeId')
    if (nativeId !== undefined) out.nativeId = nativeId
    const title = optStr(obj, 'title')
    if (title !== undefined) out.title = title
    const thumbnail = optStr(obj, 'thumbnail')
    if (thumbnail !== undefined) out.thumbnail = thumbnail
    return out
  })

function getProvider(ctx: TrpcContext, queryProvider: string | undefined): Provider | null {
  const providerName = queryProvider?.toLowerCase()
  if (!providerName) return null
  return ctx.getProviders()[providerName] || null
}
function isMatureStreamingProvider(ctx: TrpcContext, provider: string | undefined | null): boolean {
  const key = (provider || '').toLowerCase()
  const providers = ctx.getProviders()
  if (!key || !providers[key] || key === 'mal' || key === 'anilist') return false
  const mature = matureStreamingIds(ctx)
  return mature ? mature.has(key) : true
}

function matureStreamingIds(ctx: TrpcContext): Set<string> | null {
  const catalog = ctx.getCatalog()
  if (!catalog || catalog.length === 0) return null
  return new Set(
    catalog
      .filter((c) => c.mature && (c.kind ?? 'anime') === 'anime' && c.loaded)
      .map((c) => c.id.toLowerCase())
  )
}

async function resolveMatureStreamingId(
  ctx: TrpcContext,
  title: string,
  wanted?: string
): Promise<{ provider: Provider; nativeId: string } | null> {
  const providers = ctx.getProviders()
  const mature = matureStreamingIds(ctx)
  const pool = mature ? [...mature] : Object.keys(providers)
  const names = [wanted, ...pool].filter(
    (p): p is string => !!p && p !== 'mal' && p !== 'anilist' && !!providers[p]
  )
  const seen = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    try {
      const resolved = await providers[name].resolveShowId?.(title)
      if (resolved) return { provider: providers[name], nativeId: resolved }
    } catch {
      // ignore
    }
  }
  return null
}

function parseListParam(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const list = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

export const dataRouter = router({
  schedule: protectedProcedure.input(dataScheduleInput()).query(async ({ ctx, input }) => {
    const date = input.date
    const format = input.format || 'TV'
    return cached(ctx, `schedule-${date}-${format}`, 1800, defaultValidate, async () => {
      try {
        const dateObj = new Date(date + 'T00:00:00.000Z')
        const adult = format === 'ADULT'
        return await getSchedule(dateObj, adult ? undefined : format, adult)
      } catch (e) {
        logger.error({ err: e, date }, 'Schedule fetch failed')
        return []
      }
    })
  }),

  latestReleases: protectedProcedure
    .input(dataLatestReleasesInput())
    .query(async ({ ctx, input }) => {
      const formatStr = input.format || 'TV'
      const pageNum = input.page || 1
      const sizeNum = input.size || 12
      return cached(
        ctx,
        `latest-releases-${formatStr}-${pageNum}-${sizeNum}`,
        300,
        defaultValidate,
        async () => {
          try {
            return await getLatestReleases(formatStr, pageNum, sizeNum)
          } catch (e) {
            logger.error({ err: e }, 'Latest releases fetch failed')
            return []
          }
        }
      )
    }),

  search: protectedProcedure.input(dataSearchInput()).query(async ({ ctx, input }) => {
    const queryEntries: Record<string, string> = {}
    if (input.query !== undefined) queryEntries.query = input.query
    if (input.page !== undefined) queryEntries.page = String(input.page)
    if (input.limit !== undefined) queryEntries.limit = String(input.limit)
    if (input.sortBy !== undefined) queryEntries.sortBy = input.sortBy
    if (input.type !== undefined) queryEntries.type = input.type
    if (input.status !== undefined) queryEntries.status = input.status
    if (input.season !== undefined) queryEntries.season = input.season
    if (input.year !== undefined) queryEntries.year = String(input.year)
    if (input.country !== undefined) queryEntries.country = input.country
    if (input.genres !== undefined) queryEntries.genres = input.genres
    if (input.excludeGenres !== undefined) queryEntries.excludeGenres = input.excludeGenres
    if (input.excludeTags !== undefined) queryEntries.excludeTags = input.excludeTags
    if (input.minScore !== undefined) queryEntries.minScore = String(input.minScore)
    if (input.minEpisodes !== undefined) queryEntries.minEpisodes = String(input.minEpisodes)
    if (input.adult !== undefined) queryEntries.adult = input.adult
    return cached(
      ctx,
      `search-${JSON.stringify(queryEntries)}`,
      1800,
      defaultValidate,
      async () => {
        try {
          return await searchAnilist({
            query: input.query || '',
            page: input.page || 1,
            perPage: input.limit || 14,
            format: input.type,
            status: input.status,
            season: input.season,
            seasonYear: input.year,
            countryOfOrigin: input.country,
            genre: input.genres,
            genre_not_in: parseListParam(input.excludeGenres),
            tag_not_in: parseListParam(input.excludeTags),
            averageScore_greater: input.minScore,
            episodes_greater: input.minEpisodes,
            isAdult: input.adult === 'true' ? true : input.adult === 'false' ? false : undefined,
            sort: input.sortBy,
          })
        } catch (e) {
          logger.error({ err: e }, 'search failed')
          return []
        }
      }
    )
  }),

  matureResolve: protectedProcedure
    .input(dataMatureResolveInput())
    .query(async ({ ctx, input }) => {
      return cached(ctx, `mature-resolve-${input.title || ''}`, 3600, defaultValidate, async () => {
        try {
          const title = (input.title || '').trim()
          if (!title) throw badRequest('title is required')

          const anilistResult = await searchAnilistByTitle(title)
          if (anilistResult) {
            const id = anilistResult.id
            return { id: typeof id === 'number' && id < 0 ? `mal-${Math.abs(id)}` : id }
          }

          const malResult = await malSearchTitle(malCacheStore(), title)
          if (malResult) return { id: malResult, provider: 'mal' }

          throw new TRPCError({ code: 'NOT_FOUND', message: 'No match found' })
        } catch (e) {
          if (e instanceof TRPCError) throw e
          logger.error({ err: e }, 'mature resolve failed')
          throw failed('Resolve failed')
        }
      })
    }),

  skipTimes: protectedProcedure.input(dataSkipTimesInput()).query(async ({ input }) => {
    try {
      const showId = input.showId || ''
      const episodeNumber = input.episodeNumber || ''
      if (/^\d+$/.test(showId)) {
        const skipRes = await fetch(
          `https://api.aniskip.com/v1/skip-times/${showId}/${episodeNumber}?types=op&types=ed`
        )
        if (skipRes.ok) {
          return await parseJsonBody(skipRes)
        }
      }
      return { found: false, results: [] }
    } catch {
      return { found: false, results: [] }
    }
  }),

  seasonal: protectedProcedure.input(dataSeasonalInput()).query(async ({ ctx, input }) => {
    const pageNum = input.page || 1
    const sizeNum = input.size || 14
    const formatStr = input.format
    return cached(
      ctx,
      `seasonal-${formatStr || 'ALL'}-${pageNum}-${sizeNum}`,
      300,
      defaultValidate,
      async () => {
        try {
          return await getSeasonal(pageNum, sizeNum, formatStr)
        } catch (e) {
          logger.error({ err: e }, 'Seasonal fetch failed')
          return []
        }
      }
    )
  }),

  popularList: protectedProcedure.input(dataPopularListInput()).query(async ({ ctx, input }) => {
    const sort = input.sort === 'POPULARITY_DESC' ? 'POPULARITY_DESC' : 'TRENDING_DESC'
    const pageNum = input.page || 1
    const sizeNum = input.size || 20
    return cached(
      ctx,
      `popular-list-${input.sort || 'TRENDING_DESC'}-${pageNum}-${sizeNum}`,
      300,
      defaultValidate,
      async () => {
        try {
          return await getTrending(pageNum, sizeNum, sort)
        } catch (e) {
          logger.error({ err: e }, 'Popular list fetch failed')
          return []
        }
      }
    )
  }),

  trending: protectedProcedure.query(async ({ ctx }) => {
    return cached(ctx, 'trending', 300, defaultValidate, async () => {
      try {
        return await getTrending(1, 20, 'TRENDING_DESC', 'RELEASING')
      } catch (e) {
        logger.error({ err: e }, 'Trending fetch failed')
        return []
      }
    })
  }),

  spotlight: protectedProcedure.query(async ({ ctx }) => {
    return cached(ctx, 'spotlight', 300, defaultValidate, async () => {
      try {
        return await getSpotlightBanners(1, 20)
      } catch (e) {
        logger.error({ err: e }, 'Spotlight fetch failed')
        return []
      }
    })
  }),

  home: protectedProcedure.input(dataHomeInput()).query(async ({ ctx, input }) => {
    const formatStr = input.format
    return cached(ctx, `home-${formatStr || 'TV'}`, 300, defaultValidate, async () => {
      try {
        return await getBatchedHomeData(formatStr)
      } catch (e) {
        logger.error({ err: e }, 'Batched home fetch failed')
        return { trending: [], seasonal: [], spotlight: [] }
      }
    })
  }),

  genresAndTags: protectedProcedure.query(async () => {
    try {
      return await getGenreTagLists()
    } catch (e) {
      logger.error({ err: e }, 'genres-and-tags failed')
      throw failed('Failed to load genres')
    }
  }),

  anilistStatus: protectedProcedure.query(async () => {
    const available = !anilistUnavailable()
    if (!available) {
      checkAnilistStatus().catch(() => {})
    }
    return { available, wasDownAtBoot: wasAnilistDownAtBoot() }
  }),

  systemNotifications: protectedProcedure.query(async () => {
    interface SystemNotification {
      id: string
      type: string
      title: string
      message: string
      icon: string
      createdAt: number
    }
    const notifications: SystemNotification[] = []
    if (wasAnilistDownAtBoot() && anilistUnavailable()) {
      const fb = 'MAL + Kitsu'
      notifications.push({
        id: 'system-anilist-down',
        type: 'system',
        title: 'AniList API',
        message: `AniList metadata API is currently down. dango is experiencing degraded performance. ${fb} is being used as a fallback in the meantime. Some features may be limited until service is restored.`,
        icon: 'warning',
        createdAt: Date.now(),
      })
    }
    return notifications
  }),

  episodes: protectedProcedure.input(dataEpisodesInput()).query(async ({ ctx, input }) => {
    const showIdParam = input.showId
    return cached(ctx, `episodes-${showIdParam || ''}`, 3600, defaultValidate, async () => {
      const showIdRaw = showIdParam
      if (!showIdRaw) return { episodes: [] }
      const db = ctx.db
      const providers = ctx.getProviders()
      let showId = await getMigratedId(db, showIdRaw)
      const epsMalId = parseMalId(showId)
      if (epsMalId) {
        try {
          const malMeta = await getShowMetaByMalId(epsMalId)
          if (malMeta?.anilistId && malMeta.anilistId > 0) showId = String(malMeta.anilistId)
        } catch {
          // ignore
        }
      }
      if (isTempShowId(showId)) {
        try {
          const row = await TempShowIdsRepository.getById(db, showId)
          if (!row || !isMatureStreamingProvider(ctx, row.provider)) return { episodes: [] }
          const wanted = String(input.provider || '').toLowerCase()
          const own = providers[row.provider]
          if (own && (!wanted || wanted === row.provider)) {
            const data = await own.getEpisodes(row.nativeId, input.mode)
            if (data?.episodes?.length) return data
            return { episodes: [] }
          }
          const hit = await resolveMatureStreamingId(ctx, row.title, wanted)
          if (hit) {
            const data = await hit.provider.getEpisodes(hit.nativeId, input.mode)
            if (data?.episodes?.length) return data
          }
        } catch {
          // ignore
        }
        return { episodes: [] }
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(showId)) {
        try {
          if (providers['animepahe']) {
            const data = await providers['animepahe'].getEpisodes(showId, input.mode)
            return data || { episodes: [] }
          }
        } catch {
          return { episodes: [] }
        }
      }
      const isNumeric = /^(mal-\d+|-?\d+)$/i.test(showId)
      if (isNumeric) {
        let episodes: string[] = []
        try {
          episodes = await getAnilistEpisodes(showId)
        } catch (e) {
          logger.error({ err: e, showId }, 'Episodes fetch failed')
        }
        if (episodes.length === 0) {
          const absId = Math.abs(parseInt(showId, 10))
          if (!Number.isFinite(absId)) return { episodes }
          try {
            const d = await malAnimeDetail(malCacheStore(), absId)
            const total = d.detail?.episodes
            if (total && total > 0 && total <= 500) {
              episodes = Array.from({ length: total }, (_, i) => (i + 1).toString())
            }
          } catch {
            // ignore
          }
        }
        if (episodes.length === 0) {
          const providerName = input.provider?.toLowerCase()
          const provider = providerName ? providers[providerName] : undefined
          if (provider?.isDirectId?.(showId)) {
            try {
              const data = await provider.getEpisodes(showId, input.mode)
              if (data?.episodes?.length) return data
            } catch {
              // ignore
            }
          }
        }
        return { episodes }
      }
      const providerName = input.provider?.toLowerCase()
      const provider = providerName ? providers[providerName] : undefined
      if (provider) {
        try {
          const data = await provider.getEpisodes(showId, input.mode)
          if (data?.episodes?.length) return data
        } catch {
          // ignore
        }
      }
      return { episodes: [] }
    })
  }),

  showMeta: protectedProcedure.input(dataShowMetaInput()).query(async ({ ctx, input }) => {
    const showIdRaw = input.id
    return cached(
      ctx,
      `meta-${showIdRaw}`,
      3600,
      (d) => !!d,
      async () => {
        const db = ctx.db
        const id = await getMigratedId(db, showIdRaw)
        if (isTempShowId(id)) {
          const row = await TempShowIdsRepository.getById(db, id)
          if (!row || !isMatureStreamingProvider(ctx, row.provider)) return {}
          return {
            _id: row.id,
            id: row.id,
            name: row.title,
            englishName: row.title,
            thumbnail: row.thumbnail || '',
            type: 'TV',
            isAdult: true,
            status: 'UNKNOWN',
            provider: row.provider,
            nativeId: row.nativeId,
          }
        }
        const isNumeric = /^(mal-\d+|-?\d+)$/i.test(id)
        if (isNumeric) {
          let meta: Show | null = null
          try {
            meta = await getShowMetaById(id)
          } catch (e) {
            logger.warn({ err: e, id }, 'AniList show-meta fetch failed, trying local cache')
            const localMeta = (await ShowsMetaRepository.getById(db, id)) as Record<
              string,
              unknown
            > | null
            if (localMeta) {
              if (typeof localMeta.genres === 'string') {
                try {
                  localMeta.genres = JSON.parse(localMeta.genres as string)
                } catch {
                  localMeta.genres = []
                }
              }
              return localMeta
            }
          }
          if (meta) {
            const poster = meta.thumbnail?.trim() ? meta.thumbnail : undefined
            const hasPoster = !!poster
            try {
              await ShowsMetaRepository.upsert(db, {
                id,
                name: meta.name,
                thumbnail: poster,
                nativeName: meta.nativeName,
                englishName: meta.englishName,
                popularityScore:
                  meta.score ?? (meta.averageScore != null ? meta.averageScore / 10 : undefined),
                genres: meta.genres
                  ? JSON.stringify(
                      meta.genres.map((g) => (typeof g === 'string' ? g : g?.name)).filter(Boolean)
                    )
                  : undefined,
                status: meta.status,
                episodeCount: meta.episodeCount != null ? Number(meta.episodeCount) : undefined,
                type: meta.type,
                anilistId: meta.anilistId,
              })
            } catch {
              // ignore
            }
            if (hasPoster && poster) {
              const existingWatchlist = (await WatchlistRepository.getById(db, id)) as {
                thumbnail?: string
              } | null
              if (existingWatchlist && existingWatchlist.thumbnail !== poster) {
                try {
                  await WatchlistRepository.updateThumbnail(db, id, poster)
                } catch {
                  // ignore
                }
              }
            }
          }
          if (/^(mal-\d+|-\d+)$/i.test(id) && meta?.anilistId && meta.anilistId > 0) {
            try {
              dbRun(
                db,
                'INSERT OR REPLACE INTO legacy_id_mapping (legacyId, numericId) VALUES (?, ?)',
                [id, String(meta.anilistId)]
              )
            } catch {
              // ignore
            }
          }
          return meta || {}
        }
        return {}
      }
    )
  }),

  matureSearch: protectedProcedure.input(dataMatureSearchInput()).query(async ({ ctx, input }) => {
    const provider = (input.provider || 'anilist').toLowerCase()
    if (provider !== 'anilist' && provider !== 'mal' && !isMatureStreamingProvider(ctx, provider)) {
      throw badRequest('Unknown mature provider')
    }
    const queryEntries: Record<string, string> = {}
    for (const [k, v] of Object.entries(input)) {
      if (v !== undefined) queryEntries[k] = String(v)
    }
    return cached(
      ctx,
      `mature-search-${JSON.stringify(queryEntries)}`,
      600,
      (d) => !!d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data),
      async () => {
        try {
          const query = input.query || ''
          const page = input.page || 1
          const limit = input.limit || 14
          if (provider === 'anilist') {
            const result = await searchAnilist({
              query,
              page,
              perPage: limit,
              format: input.type,
              status: input.status,
              season: input.season,
              seasonYear: input.year,
              countryOfOrigin: input.country,
              genre: input.genres,
              genre_not_in: parseListParam(input.excludeGenres),
              isAdult: true,
              sort: input.sortBy,
            })
            return { data: result, hasMore: result.length >= limit }
          }
          if (isMatureStreamingProvider(ctx, provider)) {
            const streaming = ctx.getProviders()[provider]
            if (streaming?.browse) {
              const genre = input.genre || input.genres || undefined
              const result = await streaming.browse({
                query,
                page,
                limit,
                pageSize: limit,
                genre,
                genres: input.genres || genre,
                order: input.order || input.sortBy || undefined,
                sort: input.sortBy || input.order || undefined,
                studio: input.studio || undefined,
                blacklist: input.blacklist || undefined,
              })
              return {
                data: result.shows,
                hasMore: result.hasMore,
                ...(result.total !== undefined ? { total: result.total } : {}),
                ...(result.genres ? { genres: result.genres } : {}),
              }
            }
            const shows = await streaming.search({ query })
            return { data: shows.map((s) => ({ ...s, isAdult: true })), hasMore: false }
          }
          if (provider === 'mal') {
            let result: AnilistMedia[] = []
            try {
              result = await malSearchMedia(malCacheStore(), {
                query,
                page,
                perPage: 50,
                format: input.type,
                status: input.status,
                genre: input.genres || undefined,
                genre_not_in: parseListParam(input.excludeGenres),
                isAdult: true,
                sort: input.sortBy,
                averageScore_greater: input.minScore,
                episodes_greater: input.minEpisodes,
              })
            } catch (e) {
              logger.error({ err: e }, 'mal mature search failed')
            }
            const shows = result.map((m) => {
              const show = fromAnilistMedia(m)
              return { ...show, isAdult: true }
            })
            const sliced = shows.slice(0, limit)
            return { data: sliced, hasMore: shows.length >= limit }
          }
          return { data: [], hasMore: false }
        } catch (e) {
          logger.error({ err: e }, 'mature search failed')
          return { data: [], hasMore: false }
        }
      }
    )
  }),

  matureFilters: protectedProcedure.query(async ({ ctx }) => {
    try {
      const catalog = ctx.getCatalog() ?? []
      const providers: Record<
        string,
        { label: string; browse?: BrowseCaps; genres?: string[]; orders?: string[] }
      > = {}
      for (const item of catalog) {
        if (!item.mature || (item.kind ?? 'anime') !== 'anime' || !item.loaded) continue
        providers[item.id] = {
          label: item.label,
          ...(item.browse ? { browse: item.browse } : {}),
          ...(item.facets?.genres?.length ? { genres: item.facets.genres } : {}),
          ...(item.facets?.orders?.length ? { orders: item.facets.orders } : {}),
        }
      }
      return { providers }
    } catch (e) {
      logger.error({ err: e }, 'mature filters failed')
      throw failed('Failed to load filters')
    }
  }),

  matureAllocate: protectedProcedure
    .input(dataMatureAllocateInput())
    .mutation(async ({ ctx, input }) => {
      try {
        const provider = String(input.provider || '').toLowerCase()
        const nativeId = String(input.nativeId || '').trim()
        const title = String(input.title || '').trim()
        const thumbnail = String(input.thumbnail || '')
        if (!provider || !isMatureStreamingProvider(ctx, provider)) {
          throw badRequest('Unknown provider')
        }
        if (!nativeId || !title) {
          throw badRequest('nativeId and title are required')
        }
        const row = await TempShowIdsRepository.allocate(ctx.db, {
          provider,
          nativeId,
          title,
          thumbnail,
        })
        return { id: row.id }
      } catch (e) {
        if (e instanceof TRPCError) throw e
        logger.error({ err: e }, 'temp show allocate failed')
        throw failed('Allocate failed')
      }
    }),

  video: protectedProcedure.input(dataVideoInput()).query(async ({ ctx, input }) => {
    const db = ctx.db
    const providers = ctx.getProviders()
    try {
      let showId = input.showId as string
      const videoMalId = parseMalId(showId)
      if (videoMalId) {
        try {
          const malMeta = await getShowMetaByMalId(videoMalId)
          if (malMeta?.anilistId && malMeta.anilistId > 0) showId = String(malMeta.anilistId)
        } catch {
          // ignore
        }
      }
      if (isTempShowId(showId)) {
        try {
          const row = await TempShowIdsRepository.getById(db, showId)
          if (!row || !isMatureStreamingProvider(ctx, row.provider)) return []
          const wanted = String(input.provider || '').toLowerCase()
          const own = providers[row.provider]
          if (own && (!wanted || wanted === row.provider)) {
            const urls = await own.getStreamUrls(
              row.nativeId,
              input.episodeNumber as string,
              input.mode
            )
            return urls || []
          }
          const hit = await resolveMatureStreamingId(ctx, row.title, wanted)
          if (hit) {
            const urls = await hit.provider.getStreamUrls(
              hit.nativeId,
              input.episodeNumber as string,
              input.mode
            )
            return urls || []
          }
        } catch (e) {
          logger.error({ err: e, showId }, 'Temp show video fetch failed')
        }
        return []
      }
      const providerName = input.provider as string
      const providerKey = providerName?.toLowerCase()
      const stillMal = parseMalId(showId) !== null
      const isNativeId = !!(providerKey && providers[providerKey]?.isDirectId?.(showId))
      const needsResolution = !isNativeId && (/^\d+$/.test(showId) || stillMal)
      if (providerKey && needsResolution) {
        const meta = (await ShowsMetaRepository.getById(db, showId)) as {
          name?: string
          englishName?: string
        } | null
        let targetTitle = meta?.englishName || meta?.name
        let anilistShow: Show | null = null
        if (!targetTitle) {
          try {
            anilistShow = await getShowMetaById(showId)
            targetTitle = anilistShow?.englishName || anilistShow?.name
            if (anilistShow && targetTitle) {
              await ShowsMetaRepository.upsert(db, {
                id: showId,
                name: anilistShow.name,
                thumbnail: anilistShow.thumbnail,
                nativeName: anilistShow.nativeName,
                englishName: anilistShow.englishName,
                genres: anilistShow.genres
                  ? JSON.stringify(anilistShow.genres.map((genre) => genre.name))
                  : undefined,
                status: anilistShow.status,
                episodeCount:
                  anilistShow.episodeCount != null ? Number(anilistShow.episodeCount) : undefined,
                type: anilistShow.type,
                anilistId: anilistShow.anilistId,
              })
            }
          } catch (err) {
            logger.warn(
              { err, provider: providerKey, showId },
              '[Video] AniList metadata lookup failed while resolving numeric showId'
            )
          }
        }
        if (targetTitle) {
          let romaji = anilistShow?.names?.romaji
          let nativeName: string | undefined = anilistShow?.names?.native
          let synonyms: string[] | undefined = anilistShow?.names?.synonyms
          if (!romaji || !nativeName) {
            try {
              const show = await getShowMetaById(showId)
              romaji = romaji || show?.names?.romaji
              nativeName = nativeName || show?.names?.native
              synonyms = synonyms || show?.names?.synonyms
            } catch {
              // ignore
            }
          }
          const titleTargets = [
            targetTitle,
            romaji,
            nativeName,
            ...(synonyms ?? []).slice(0, 2),
          ].filter((t): t is string => !!t && t.trim().length > 0)
          const distinctTargets = [...new Set(titleTargets.map((t) => t.trim()))].filter(
            (t, i, a) => a.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i
          )
          let resolved: string | null = null
          for (const variant of distinctTargets) {
            try {
              resolved =
                (await providers[providerKey]?.resolveShowId?.(variant, romaji, input.mode)) ?? null
            } catch {
              resolved = null
            }
            if (resolved) break
          }
          if (resolved) {
            showId = resolved
          } else {
            logger.warn(
              { provider: providerKey, showId, title: targetTitle, romaji },
              '[Video] resolveShowId failed, attempting fallback provider search'
            )
            try {
              const fallbackResults = await providers[providerKey]?.search?.({ query: targetTitle })
              const fallbackMatch = pickBestMatch(
                (fallbackResults || []).map((r) => ({
                  title: r.name || r.englishName || '',
                  id: r.id || r._id || '',
                })),
                distinctTargets
              )
              if (fallbackMatch) {
                showId = fallbackMatch.item.id
              } else {
                logger.warn(
                  { provider: providerKey, showId, title: targetTitle },
                  '[Video] fallback provider search returned no results'
                )
                return []
              }
            } catch (fallbackErr) {
              if ((fallbackErr as Error).message === 'AUTH_REQUIRED') {
                throw fallbackErr
              }
              logger.error(
                { err: fallbackErr, provider: providerKey, showId, title: targetTitle },
                '[Video] fallback provider search failed'
              )
              return []
            }
          }
        } else {
          logger.warn(
            { provider: providerKey, showId },
            '[Video] numeric showId passed to provider but local meta missing title'
          )
          return []
        }
      }
      const provider = getProvider(ctx, input.provider)
      if (!provider) return []
      const urls = await provider.getStreamUrls(showId, input.episodeNumber as string, input.mode)
      return urls || []
    } catch (e) {
      if ((e as Error).message === 'AUTH_REQUIRED') {
        throw authRequiredError('animepahe')
      }
      logger.error({ err: e, provider: input.provider }, 'Provider video fetch failed')
      return []
    }
  }),
})

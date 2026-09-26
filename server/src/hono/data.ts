import type { Hono, Context } from 'hono'
import type { AppCache } from '../utils/cache.utils.js'
import type { DatabaseWrapper } from '../db.js'
import { Provider, Show } from '../providers/provider.interface.js'
import type { BrowseCaps } from '../providers/remote-types.js'
import type { ProviderCatalogItem } from '../providers/remote-types.js'
import { parseJsonBody } from '../utils/http.utils.js'
import { pickBestMatch } from '../providers/title-matching.js'
import {
  getTrending,
  getLatestReleases,
  getSeasonal,
  getShowMetaById,
  getAnilistEpisodes,
  getSchedule,
  searchAnilist,
  searchAnilistByTitle,
  parseMalId,
  getShowMetaByMalId,
  getSpotlightBanners,
  getBatchedHomeData,
  getGenreTagLists,
  anilistUnavailable,
  wasAnilistDownAtBoot,
  checkAnilistStatus,
  fromAnilistMedia,
} from '../lib/anilist.js'
import type { AnilistMedia } from '../lib/anilist.js'
import { malSearchMedia, malSearchTitle, malAnimeDetail, toAnilistDetailMedia } from '../lib/mal.js'
import { malCacheStore } from '../repositories/mal-cache.repository.js'
import { getMigratedId } from '../lib/migration.js'
import { isTempShowId } from '../lib/temp-ids.js'
import { TempShowIdsRepository } from '../repositories/temp-show-ids.repository.js'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository.js'
import { WatchlistRepository } from '../repositories/watchlist.repository.js'
import { dbRun } from '../utils/db-utils.js'
import logger from '../logger.js'

function parseListParam(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const list = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

function dataCacheHeader(body: unknown, maxAgeSeconds: number): string {
  const isEmpty = Array.isArray(body)
    ? body.length === 0
    : body == null || (typeof body === 'object' && Object.keys(body).length === 0)
  return isEmpty ? 'no-store' : `public, max-age=${maxAgeSeconds}`
}

async function cached(
  c: Context,
  cache: AppCache,
  key: string,
  ttl: number | undefined,
  validate: (data: unknown) => boolean,
  produce: () => Promise<{ status?: number; body: unknown }>
): Promise<Response> {
  const hit = cache.get<unknown>(key)
  if (hit) return c.json(hit)
  const result = await produce()
  const status = result.status ?? 200
  if (validate(result.body)) {
    if (ttl !== undefined) cache.set(key, result.body, ttl)
    else cache.set(key, result.body)
  }
  return c.json(result.body, status as 200)
}

const defaultValidate = (d: unknown) => Array.isArray(d) && d.length > 0

export function registerData(
  app: Hono,
  getDbs: () => { db: DatabaseWrapper },
  getApiCache: () => AppCache,
  getProviders: () => { [key: string]: Provider },
  getCatalog?: () => ProviderCatalogItem[]
) {
  const getProvider = (queryProvider: string | undefined): Provider | null => {
    const providerName = queryProvider?.toLowerCase()
    if (!providerName) return null
    return getProviders()[providerName] || null
  }

  const matureStreamingIds = (): Set<string> | null => {
    const catalog = getCatalog?.()
    if (!catalog || catalog.length === 0) return null
    return new Set(
      catalog
        .filter((c) => c.mature && (c.kind ?? 'anime') === 'anime' && c.loaded)
        .map((c) => c.id.toLowerCase())
    )
  }

  const isMatureStreamingProvider = (provider: string | undefined | null): boolean => {
    const key = (provider || '').toLowerCase()
    const providers = getProviders()
    if (!key || !providers[key] || key === 'mal' || key === 'anilist') return false
    const mature = matureStreamingIds()
    return mature ? mature.has(key) : true
  }

  const resolveMatureStreamingId = async (
    title: string,
    wanted?: string
  ): Promise<{ provider: Provider; nativeId: string } | null> => {
    const providers = getProviders()
    const mature = matureStreamingIds()
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

  app.get('/api/schedule/:date', async (c) => {
    const date = c.req.param('date')
    const format = c.req.query('format') || 'TV'
    return cached(
      c,
      getApiCache(),
      `schedule-${date}-${c.req.query('format') || 'TV'}`,
      1800,
      defaultValidate,
      async () => {
        try {
          const dateObj = new Date(date + 'T00:00:00.000Z')
          const adult = format === 'ADULT'
          const data = await getSchedule(dateObj, adult ? undefined : format, adult)
          c.header('Cache-Control', dataCacheHeader(data, 300))
          return { body: data }
        } catch (e) {
          logger.error({ err: e, date }, 'Schedule fetch failed')
          c.header('Cache-Control', 'no-store')
          return { body: [] }
        }
      }
    )
  })

  app.get('/api/latest-releases', async (c) => {
    const format = c.req.query('format') || 'TV'
    const page = c.req.query('page') || 1
    const size = c.req.query('size') || 12
    return cached(
      c,
      getApiCache(),
      `latest-releases-${format}-${page}-${size}`,
      300,
      defaultValidate,
      async () => {
        const formatStr = String(format)
        const pageNum = parseInt(String(page)) || 1
        const sizeNum = parseInt(String(size)) || 12
        try {
          const data = await getLatestReleases(formatStr, pageNum, sizeNum)
          c.header('Cache-Control', dataCacheHeader(data, 300))
          return { body: data }
        } catch (e) {
          logger.error({ err: e }, 'Latest releases fetch failed')
          c.header('Cache-Control', 'no-store')
          return { body: [] }
        }
      }
    )
  })

  app.get('/api/search', async (c) => {
    const queryEntries: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.req.query())) queryEntries[k] = v
    return cached(
      c,
      getApiCache(),
      `search-${JSON.stringify(queryEntries)}`,
      1800,
      defaultValidate,
      async () => {
        try {
          const query = c.req.query('query') || ''
          const page = parseInt(c.req.query('page') as string) || 1
          const perPage = parseInt(c.req.query('limit') as string) || 14
          const sort = c.req.query('sortBy') || undefined

          const result = await searchAnilist({
            query,
            page,
            perPage,
            format: c.req.query('type') as string,
            status: c.req.query('status') as string,
            season: c.req.query('season') as string,
            seasonYear: c.req.query('year') ? parseInt(c.req.query('year') as string) : undefined,
            countryOfOrigin: c.req.query('country') as string,
            genre: c.req.query('genres') as string,
            genre_not_in: parseListParam(c.req.query('excludeGenres')),
            tag_not_in: parseListParam(c.req.query('excludeTags')),
            averageScore_greater: c.req.query('minScore')
              ? parseInt(c.req.query('minScore') as string)
              : undefined,
            episodes_greater: c.req.query('minEpisodes')
              ? parseInt(c.req.query('minEpisodes') as string)
              : undefined,
            isAdult:
              c.req.query('adult') === 'true'
                ? true
                : c.req.query('adult') === 'false'
                  ? false
                  : undefined,
            sort,
          })
          return { body: result }
        } catch (e) {
          logger.error({ err: e }, 'search failed')
          return { body: [] }
        }
      }
    )
  })

  app.get('/api/mature/search', async (c) => {
    const provider = ((c.req.query('provider') as string) || 'anilist').toLowerCase()
    if (provider !== 'anilist' && provider !== 'mal' && !isMatureStreamingProvider(provider)) {
      return c.json({ error: 'Unknown mature provider' }, 400)
    }
    const queryEntries: Record<string, string> = {}
    for (const [k, v] of Object.entries(c.req.query())) queryEntries[k] = v
    return cached(
      c,
      getApiCache(),
      `mature-search-${JSON.stringify(queryEntries)}`,
      600,
      (d) => !!d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data),
      async () => {
        try {
          const query = (c.req.query('query') as string) || ''
          const page = parseInt(c.req.query('page') as string) || 1
          const limit = parseInt(c.req.query('limit') as string) || 14

          if (provider === 'anilist') {
            const result = await searchAnilist({
              query,
              page,
              perPage: limit,
              format: c.req.query('type') as string,
              status: c.req.query('status') as string,
              season: c.req.query('season') as string,
              seasonYear: c.req.query('year') ? parseInt(c.req.query('year') as string) : undefined,
              countryOfOrigin: c.req.query('country') as string,
              genre: c.req.query('genres') as string,
              genre_not_in: parseListParam(c.req.query('excludeGenres')),
              isAdult: true,
              sort: (c.req.query('sortBy') as string) || undefined,
            })
            return { body: { data: result, hasMore: result.length >= limit } }
          }

          if (isMatureStreamingProvider(provider)) {
            const streaming = getProviders()[provider]
            if (streaming?.browse) {
              const genre =
                (c.req.query('genre') as string) || (c.req.query('genres') as string) || undefined
              const result = await streaming.browse({
                query,
                page,
                limit,
                pageSize: limit,
                genre,
                genres: (c.req.query('genres') as string) || genre,
                order:
                  (c.req.query('order') as string) ||
                  (c.req.query('sortBy') as string) ||
                  undefined,
                sort:
                  (c.req.query('sortBy') as string) ||
                  (c.req.query('order') as string) ||
                  undefined,
                studio: (c.req.query('studio') as string) || undefined,
                blacklist: (c.req.query('blacklist') as string) || undefined,
              })
              return {
                body: {
                  data: result.shows,
                  hasMore: result.hasMore,
                  ...(result.total !== undefined ? { total: result.total } : {}),
                  ...(result.genres ? { genres: result.genres } : {}),
                },
              }
            }
            const shows = await streaming.search({ query })
            return {
              body: {
                data: shows.map((s) => ({ ...s, isAdult: true })),
                hasMore: false,
              },
            }
          }

          if (provider === 'mal') {
            const malPage = page
            const malLimit = 50
            let result: AnilistMedia[] = []
            try {
              result = await malSearchMedia(malCacheStore(), {
                query,
                page: malPage,
                perPage: malLimit,
                format: c.req.query('type') as string,
                status: c.req.query('status') as string,
                genre: (c.req.query('genres') as string) || undefined,
                genre_not_in: parseListParam(c.req.query('excludeGenres')),
                isAdult: true,
                sort: (c.req.query('sortBy') as string) || undefined,
                averageScore_greater: c.req.query('minScore')
                  ? parseInt(c.req.query('minScore') as string)
                  : undefined,
                episodes_greater: c.req.query('minEpisodes')
                  ? parseInt(c.req.query('minEpisodes') as string)
                  : undefined,
              })
            } catch (e) {
              logger.error({ err: e }, 'mal mature search failed')
            }
            const shows = result.map((m) => {
              const show = fromAnilistMedia(m)
              return { ...show, isAdult: true }
            })
            const sliced = shows.slice(0, limit)
            return { body: { data: sliced, hasMore: shows.length >= limit } }
          }

          return { body: { data: [], hasMore: false } }
        } catch (e) {
          logger.error({ err: e }, 'mature search failed')
          return { body: { data: [], hasMore: false } }
        }
      }
    )
  })

  app.get('/api/mature/resolve', async (c) => {
    return cached(
      c,
      getApiCache(),
      `mature-resolve-${c.req.query('title') || ''}`,
      3600,
      defaultValidate,
      async () => {
        try {
          const title = ((c.req.query('title') as string) || '').trim()
          if (!title) return { status: 400, body: { error: 'title is required' } }

          const anilistResult = await searchAnilistByTitle(title)
          if (anilistResult) {
            const id = anilistResult.id
            return { body: { id: typeof id === 'number' && id < 0 ? `mal-${Math.abs(id)}` : id } }
          }

          const malResult = await malSearchTitle(malCacheStore(), title)
          if (malResult) return { body: { id: malResult, provider: 'mal' } }

          return { status: 404, body: { error: 'No match found' } }
        } catch (e) {
          logger.error({ err: e }, 'mature resolve failed')
          return { status: 500, body: { error: 'Resolve failed' } }
        }
      }
    )
  })

  app.get('/api/mature/filters', async (c) => {
    try {
      const catalog = getCatalog?.() ?? []
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
      return c.json({ providers })
    } catch (e) {
      logger.error({ err: e }, 'mature filters failed')
      return c.json({ error: 'Failed to load filters' }, 500)
    }
  })

  app.post('/api/mature/allocate', async (c) => {
    try {
      const body = (await c.req.json().catch(() => undefined)) as
        { provider?: unknown; nativeId?: unknown; title?: unknown; thumbnail?: unknown } | undefined
      const provider = String(body?.provider || '').toLowerCase()
      const nativeId = String(body?.nativeId || '').trim()
      const title = String(body?.title || '').trim()
      const thumbnail = String(body?.thumbnail || '')
      if (!provider || !isMatureStreamingProvider(provider)) {
        return c.json({ error: 'Unknown provider' }, 400)
      }
      if (!nativeId || !title) {
        return c.json({ error: 'nativeId and title are required' }, 400)
      }
      const row = TempShowIdsRepository.allocate(getDbs().db, {
        provider,
        nativeId,
        title,
        thumbnail,
      })
      return c.json({ id: row.id })
    } catch (e) {
      logger.error({ err: e }, 'temp show allocate failed')
      return c.json({ error: 'Allocate failed' }, 500)
    }
  })

  app.get('/api/skip-times/:showId/:episodeNumber', async (c) => {
    try {
      const showId = c.req.param('showId')
      const episodeNumber = c.req.param('episodeNumber')
      if (/^\d+$/.test(showId)) {
        const skipRes = await fetch(
          `https://api.aniskip.com/v1/skip-times/${showId}/${episodeNumber}?types=op&types=ed`
        )
        if (skipRes.ok) {
          const data = await parseJsonBody(skipRes)
          return c.json(data)
        }
      }
      return c.json({ found: false, results: [] })
    } catch {
      return c.json({ found: false, results: [] })
    }
  })

  app.get('/api/video', async (c) => {
    const db = getDbs().db
    const providers = getProviders()
    try {
      let showId = c.req.query('showId') as string

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
          const row = TempShowIdsRepository.getById(db, showId)
          if (!row || !isMatureStreamingProvider(row.provider)) return c.json([])
          const wanted = String(c.req.query('provider') || '').toLowerCase()
          const own = providers[row.provider]
          if (own && (!wanted || wanted === row.provider)) {
            const urls = await own.getStreamUrls(
              row.nativeId,
              c.req.query('episodeNumber') as string,
              c.req.query('mode') as 'sub' | 'dub'
            )
            return c.json(urls || [])
          }
          const hit = await resolveMatureStreamingId(row.title, wanted)
          if (hit) {
            const urls = await hit.provider.getStreamUrls(
              hit.nativeId,
              c.req.query('episodeNumber') as string,
              c.req.query('mode') as 'sub' | 'dub'
            )
            return c.json(urls || [])
          }
        } catch (e) {
          logger.error({ err: e, showId }, 'Temp show video fetch failed')
        }
        return c.json([])
      }

      const providerName = c.req.query('provider') as string

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
                (await providers[providerKey]?.resolveShowId?.(
                  variant,
                  romaji,
                  c.req.query('mode') as 'sub' | 'dub' | undefined
                )) ?? null
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
              const fallbackResults = await providers[providerKey]?.search?.({
                query: targetTitle,
              })
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
                return c.json([])
              }
            } catch (fallbackErr) {
              if ((fallbackErr as Error).message === 'AUTH_REQUIRED') {
                throw fallbackErr
              }
              logger.error(
                { err: fallbackErr, provider: providerKey, showId, title: targetTitle },
                '[Video] fallback provider search failed'
              )
              return c.json([])
            }
          }
        } else {
          logger.warn(
            { provider: providerKey, showId },
            '[Video] numeric showId passed to provider but local meta missing title'
          )
          return c.json([])
        }
      }

      const provider = getProvider(c.req.query('provider') as string)
      if (!provider) return c.json([])
      const urls = await provider.getStreamUrls(
        showId,
        c.req.query('episodeNumber') as string,
        c.req.query('mode') as 'sub' | 'dub'
      )
      return c.json(urls || [])
    } catch (e) {
      if ((e as Error).message === 'AUTH_REQUIRED') {
        return c.json({ error: 'AUTH_REQUIRED', provider: 'animepahe' }, 403)
      }
      logger.error({ err: e, provider: c.req.query('provider') }, 'Provider video fetch failed')
      return c.json([])
    }
  })

  app.get('/api/episodes', async (c) => {
    const showIdParam = c.req.query('showId')
    return cached(
      c,
      getApiCache(),
      `episodes-${showIdParam || ''}`,
      3600,
      defaultValidate,
      async () => {
        const showIdRaw = showIdParam as string

        if (!showIdRaw) {
          return { body: { episodes: [] } }
        }

        const db = getDbs().db
        const providers = getProviders()
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
            const row = TempShowIdsRepository.getById(db, showId)
            if (!row || !isMatureStreamingProvider(row.provider)) return { body: { episodes: [] } }
            const wanted = String(c.req.query('provider') || '').toLowerCase()
            const own = providers[row.provider]
            if (own && (!wanted || wanted === row.provider)) {
              const data = await own.getEpisodes(row.nativeId, c.req.query('mode') as 'sub' | 'dub')
              if (data?.episodes?.length) return { body: data }
              return { body: { episodes: [] } }
            }
            const hit = await resolveMatureStreamingId(row.title, wanted)
            if (hit) {
              const data = await hit.provider.getEpisodes(
                hit.nativeId,
                c.req.query('mode') as 'sub' | 'dub'
              )
              if (data?.episodes?.length) return { body: data }
            }
          } catch {
            // ignore
          }
          return { body: { episodes: [] } }
        }

        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(showId)) {
          try {
            if (providers['animepahe']) {
              const data = await providers['animepahe'].getEpisodes(
                showId,
                c.req.query('mode') as 'sub' | 'dub'
              )
              return { body: data || { episodes: [] } }
            }
          } catch {
            return { body: { episodes: [] } }
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
            if (!Number.isFinite(absId)) {
              c.header('Cache-Control', 'public, max-age=3600')
              return { body: { episodes } }
            }
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
            const providerName = (c.req.query('provider') as string)?.toLowerCase()
            const provider = providerName ? providers[providerName] : undefined
            if (provider?.isDirectId?.(showId)) {
              try {
                const data = await provider.getEpisodes(
                  showId,
                  c.req.query('mode') as 'sub' | 'dub'
                )
                if (data?.episodes?.length) {
                  c.header('Cache-Control', 'no-store')
                  return { body: data }
                }
              } catch {
                // ignore
              }
            }
          }

          c.header('Cache-Control', 'public, max-age=3600')
          return { body: { episodes } }
        }

        const providerName = (c.req.query('provider') as string)?.toLowerCase()
        const provider = providerName ? providers[providerName] : undefined
        if (provider) {
          try {
            const data = await provider.getEpisodes(showId, c.req.query('mode') as 'sub' | 'dub')
            if (data?.episodes?.length) {
              return { body: data }
            }
          } catch {
            // ignore
          }
        }

        return { body: { episodes: [] } }
      }
    )
  })

  app.get('/api/seasonal', async (c) => {
    const page = parseInt(c.req.query('page') as string) || 1
    const size = parseInt(c.req.query('size') as string) || 14
    const format = c.req.query('format')
    return cached(
      c,
      getApiCache(),
      `seasonal-${format || 'ALL'}-${page}-${size}`,
      300,
      defaultValidate,
      async () => {
        try {
          const data = await getSeasonal(page, size, format as string | undefined)
          c.header('Cache-Control', dataCacheHeader(data, 300))
          return { body: data }
        } catch (e) {
          logger.error({ err: e }, 'Seasonal fetch failed')
          c.header('Cache-Control', 'no-store')
          return { body: [] }
        }
      }
    )
  })

  app.get('/api/show-meta/:id', async (c) => {
    const showIdRaw = c.req.param('id')
    return cached(
      c,
      getApiCache(),
      `meta-${showIdRaw}`,
      3600,
      (d) => !!d,
      async () => {
        const db = getDbs().db
        const id = await getMigratedId(db, showIdRaw)

        if (isTempShowId(id)) {
          const row = TempShowIdsRepository.getById(db, id)
          if (!row || !isMatureStreamingProvider(row.provider)) {
            return { body: {} }
          }
          c.header('Cache-Control', 'public, max-age=300')
          return {
            body: {
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
            },
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
              c.header('Cache-Control', 'public, max-age=3600')
              return { body: localMeta }
            }
          }

          if (meta) {
            const poster = meta.thumbnail?.trim() ? meta.thumbnail : undefined
            const hasPoster = !!poster
            try {
              ShowsMetaRepository.upsert(db, {
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
              db.scheduleSave()
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

          c.header('Cache-Control', dataCacheHeader(meta || {}, 3600))
          return { body: meta || {} }
        }

        return { body: {} }
      }
    )
  })

  app.get('/api/popular-list', async (c) => {
    const sort = c.req.query('sort') === 'POPULARITY_DESC' ? 'POPULARITY_DESC' : 'TRENDING_DESC'
    const page = parseInt(c.req.query('page') as string) || 1
    const size = parseInt(c.req.query('size') as string) || 20
    return cached(
      c,
      getApiCache(),
      `popular-list-${c.req.query('sort') || 'TRENDING_DESC'}-${page}-${size}`,
      300,
      defaultValidate,
      async () => {
        try {
          const data = await getTrending(page, size, sort)
          c.header('Cache-Control', dataCacheHeader(data, 300))
          return { body: data }
        } catch (e) {
          logger.error({ err: e }, 'Popular list fetch failed')
          c.header('Cache-Control', 'no-store')
          return { body: [] }
        }
      }
    )
  })

  app.get('/api/trending', async (c) => {
    return cached(c, getApiCache(), 'trending', 300, defaultValidate, async () => {
      try {
        const data = await getTrending(1, 20, 'TRENDING_DESC', 'RELEASING')
        c.header('Cache-Control', dataCacheHeader(data, 300))
        return { body: data }
      } catch (e) {
        logger.error({ err: e }, 'Trending fetch failed')
        c.header('Cache-Control', 'no-store')
        return { body: [] }
      }
    })
  })

  app.get('/api/spotlight', async (c) => {
    return cached(c, getApiCache(), 'spotlight', 300, defaultValidate, async () => {
      try {
        const data = await getSpotlightBanners(1, 20)
        c.header('Cache-Control', dataCacheHeader(data, 300))
        return { body: data }
      } catch (e) {
        logger.error({ err: e }, 'Spotlight fetch failed')
        c.header('Cache-Control', 'no-store')
        return { body: [] }
      }
    })
  })

  app.get('/api/home', async (c) => {
    const format = c.req.query('format')
    return cached(c, getApiCache(), `home-${format || 'TV'}`, 300, defaultValidate, async () => {
      try {
        const data = await getBatchedHomeData(format as string | undefined)
        const isEmpty =
          data.trending.length === 0 && data.seasonal.length === 0 && data.spotlight.length === 0
        c.header('Cache-Control', isEmpty ? 'no-store' : 'public, max-age=300')
        return { body: data }
      } catch (e) {
        logger.error({ err: e }, 'Batched home fetch failed')
        c.header('Cache-Control', 'no-store')
        return { body: { trending: [], seasonal: [], spotlight: [] } }
      }
    })
  })

  app.get('/api/genres-and-tags', async (c) => {
    try {
      return c.json(await getGenreTagLists())
    } catch (e) {
      logger.error({ err: e }, 'genres-and-tags failed')
      return c.json({ error: 'Failed to load genres' }, 500)
    }
  })

  app.get('/api/anilist-status', async (c) => {
    const available = !anilistUnavailable()
    if (!available) {
      checkAnilistStatus().catch(() => {})
    }
    return c.json({ available, wasDownAtBoot: wasAnilistDownAtBoot() })
  })

  app.get('/api/system-notifications', (c) => {
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
    return c.json(notifications)
  })
}

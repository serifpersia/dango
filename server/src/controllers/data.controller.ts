import { Request, Response } from 'express'
import { Provider, Show } from '../providers/provider.interface'
import { pickBestMatch } from '../providers/title-matching'
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
} from '../lib/anilist'
import type { AnilistMedia } from '../lib/anilist'
import { malSearchMedia, malSearchTitle, malAnimeDetail, toAnilistDetailMedia } from '../lib/mal'
import { malCacheStore } from '../repositories/mal-cache.repository'
import { getMigratedId } from '../lib/migration'
import { isTempShowId, isTempMatureProvider } from '../lib/temp-ids'
import { TempShowIdsRepository } from '../repositories/temp-show-ids.repository'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository'
import { WatchlistRepository } from '../repositories/watchlist.repository'
import { dbRun } from '../utils/db-utils'
import logger from '../logger'

export class DataController {
  constructor(private providers: { [key: string]: Provider }) {}

  private getProvider(req: Request): Provider | null {
    const providerName = (req.query.provider as string)?.toLowerCase()
    if (!providerName) return null
    return this.providers[providerName] || null
  }

  private async resolveMatureStreamingId(
    title: string,
    wanted?: string
  ): Promise<{ provider: Provider; nativeId: string } | null> {
    const names = [wanted, 'wh', 'op'].filter(
      (p): p is string => !!p && p !== 'mal' && !!this.providers[p]
    )
    const seen = new Set<string>()
    for (const name of names) {
      if (seen.has(name)) continue
      seen.add(name)
      try {
        const resolved = await this.providers[name].resolveShowId?.(title)
        if (resolved) return { provider: this.providers[name], nativeId: resolved }
      } catch {
        // ignore
      }
    }
    return null
  }

  getTrending = async (_req: Request, res: Response) => {
    try {
      const data = await getTrending(1, 20, 'TRENDING_DESC', 'RELEASING')
      res.set('Cache-Control', 'public, max-age=300').json(data)
    } catch (e) {
      logger.error({ err: e }, 'Trending fetch failed')
      res.json([])
    }
  }

  getSpotlight = async (_req: Request, res: Response) => {
    try {
      const data = await getSpotlightBanners(1, 20)
      res.set('Cache-Control', 'public, max-age=300').json(data)
    } catch (e) {
      logger.error({ err: e }, 'Spotlight fetch failed')
      res.json([])
    }
  }

  getPopularList = async (req: Request, res: Response) => {
    const sort =
      (req.query.sort as string) === 'POPULARITY_DESC' ? 'POPULARITY_DESC' : 'TRENDING_DESC'
    const page = parseInt(req.query.page as string) || 1
    const size = parseInt(req.query.size as string) || 20
    try {
      const data = await getTrending(page, size, sort)
      res.set('Cache-Control', 'public, max-age=300').json(data)
    } catch (e) {
      logger.error({ err: e }, 'Popular list fetch failed')
      res.json([])
    }
  }

  getSchedule = async (req: Request, res: Response) => {
    try {
      const date = new Date(req.params.date + 'T00:00:00.000Z')
      const format = (req.query.format as string) || undefined
      const adult = format === 'ADULT'
      const data = await getSchedule(date, adult ? undefined : format, adult)
      res.set('Cache-Control', 'public, max-age=300').json(data)
    } catch (e) {
      logger.error({ err: e, date: req.params.date }, 'Schedule fetch failed')
      res.json([])
    }
  }

  getSkipTimes = async (req: Request, res: Response) => {
    try {
      const showId = req.params.showId as string
      const episodeNumber = req.params.episodeNumber as string
      if (/^\d+$/.test(showId)) {
        const skipRes = await fetch(
          `https://api.aniskip.com/v1/skip-times/${showId}/${episodeNumber}?types=op&types=ed`
        )
        if (skipRes.ok) {
          const data = await skipRes.json()
          return res.json(data)
        }
      }
      res.json({ found: false, results: [] })
    } catch {
      res.json({ found: false, results: [] })
    }
  }

  getVideo = async (req: Request, res: Response) => {
    try {
      let showId = req.query.showId as string

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
          const row = TempShowIdsRepository.getById(req.db, showId)
          if (!row || !isTempMatureProvider(row.provider)) return res.json([])
          const wanted = String(req.query.provider || '').toLowerCase()
          const own = this.providers[row.provider]
          if (own && (!wanted || wanted === row.provider)) {
            const urls = await own.getStreamUrls(
              row.nativeId,
              req.query.episodeNumber as string,
              req.query.mode as 'sub' | 'dub'
            )
            return res.json(urls || [])
          }
          const hit = await this.resolveMatureStreamingId(row.title, wanted)
          if (hit) {
            const urls = await hit.provider.getStreamUrls(
              hit.nativeId,
              req.query.episodeNumber as string,
              req.query.mode as 'sub' | 'dub'
            )
            return res.json(urls || [])
          }
        } catch (e) {
          logger.error({ err: e, showId }, 'Temp show video fetch failed')
        }
        return res.json([])
      }

      const providerName = req.query.provider as string

      const providerKey = providerName?.toLowerCase()
      const stillMal = parseMalId(showId) !== null
      if (providerKey && ((/^\d+$/.test(showId) && providerKey !== 'megaplay') || stillMal)) {
        const meta = (await ShowsMetaRepository.getById(req.db, showId)) as {
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
              await ShowsMetaRepository.upsert(req.db, {
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
                (await this.providers[providerKey]?.resolveShowId?.(
                  variant,
                  romaji,
                  req.query.mode as 'sub' | 'dub' | undefined
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
              const fallbackResults = await this.providers[providerKey]?.search?.({
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
                return res.json([])
              }
            } catch (fallbackErr) {
              if ((fallbackErr as Error).message === 'AUTH_REQUIRED') {
                throw fallbackErr
              }
              logger.error(
                { err: fallbackErr, provider: providerKey, showId, title: targetTitle },
                '[Video] fallback provider search failed'
              )
              return res.json([])
            }
          }
        } else {
          logger.warn(
            { provider: providerKey, showId },
            '[Video] numeric showId passed to provider but local meta missing title'
          )
          return res.json([])
        }
      }

      const provider = this.getProvider(req)
      if (!provider) return res.json([])
      const urls = await provider.getStreamUrls(
        showId,
        req.query.episodeNumber as string,
        req.query.mode as 'sub' | 'dub'
      )
      res.json(urls || [])
    } catch (e) {
      if ((e as Error).message === 'AUTH_REQUIRED') {
        return res.status(403).json({ error: 'AUTH_REQUIRED', provider: 'animepahe' })
      }
      logger.error({ err: e, provider: req.query.provider }, 'Provider video fetch failed')
      res.json([])
    }
  }

  getEpisodes = async (req: Request, res: Response) => {
    const showIdRaw = req.query.showId as string

    if (!showIdRaw) {
      return res.json({ episodes: [] })
    }

    let showId = await getMigratedId(req.db, showIdRaw)

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
        const row = TempShowIdsRepository.getById(req.db, showId)
        if (!row || !isTempMatureProvider(row.provider)) return res.json({ episodes: [] })
        const wanted = String(req.query.provider || '').toLowerCase()
        const own = this.providers[row.provider]
        if (own && (!wanted || wanted === row.provider)) {
          const data = await own.getEpisodes(row.nativeId, req.query.mode as 'sub' | 'dub')
          if (data?.episodes?.length) return res.json(data)
          return res.json({ episodes: [] })
        }
        const hit = await this.resolveMatureStreamingId(row.title, wanted)
        if (hit) {
          const data = await hit.provider.getEpisodes(hit.nativeId, req.query.mode as 'sub' | 'dub')
          if (data?.episodes?.length) return res.json(data)
        }
      } catch {
        // ignore
      }
      return res.json({ episodes: [] })
    }

    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(showId)) {
      try {
        if (this.providers['animepahe']) {
          const data = await this.providers['animepahe'].getEpisodes(
            showId,
            req.query.mode as 'sub' | 'dub'
          )
          return res.json(data || { episodes: [] })
        }
      } catch {
        return res.json({ episodes: [] })
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
          res.set('Cache-Control', 'public, max-age=3600').json({ episodes })
          return
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

      res.set('Cache-Control', 'public, max-age=3600').json({ episodes })
      return
    }

    const providerName = (req.query.provider as string)?.toLowerCase()
    const provider = providerName ? this.providers[providerName] : undefined
    if (provider) {
      try {
        const data = await provider.getEpisodes(showId, req.query.mode as 'sub' | 'dub')
        if (data?.episodes?.length) {
          return res.json(data)
        }
      } catch {
        // ignore
      }
    }

    res.json({ episodes: [] })
  }

  search = async (req: Request, res: Response) => {
    try {
      const query = (req.query.query as string) || ''
      const page = parseInt(req.query.page as string) || 1
      const perPage = parseInt(req.query.limit as string) || 14
      const sort = (req.query.sortBy as string) || undefined

      const result = await searchAnilist({
        query,
        page,
        perPage,
        format: req.query.type as string,
        status: req.query.status as string,
        season: req.query.season as string,
        seasonYear: req.query.year ? parseInt(req.query.year as string) : undefined,
        countryOfOrigin: req.query.country as string,
        genre: req.query.genres as string,
        genre_not_in: req.query.excludeGenres
          ? (req.query.excludeGenres as string).split(',')
          : undefined,
        tag_not_in: req.query.excludeTags
          ? (req.query.excludeTags as string).split(',')
          : undefined,
        averageScore_greater: req.query.minScore
          ? parseInt(req.query.minScore as string)
          : undefined,
        episodes_greater: req.query.minEpisodes
          ? parseInt(req.query.minEpisodes as string)
          : undefined,
        isAdult:
          req.query.adult === 'true' ? true : req.query.adult === 'false' ? false : undefined,
        sort,
      })
      return res.json(result)
    } catch (e) {
      logger.error({ err: e }, 'search failed')
      res.json([])
    }
  }

  matureSearch = async (req: Request, res: Response) => {
    try {
      const provider = ((req.query.provider as string) || 'anilist').toLowerCase()
      const query = (req.query.query as string) || ''
      const page = parseInt(req.query.page as string) || 1
      const limit = parseInt(req.query.limit as string) || 14

      if (provider === 'anilist') {
        const result = await searchAnilist({
          query,
          page,
          perPage: limit,
          format: req.query.type as string,
          status: req.query.status as string,
          season: req.query.season as string,
          seasonYear: req.query.year ? parseInt(req.query.year as string) : undefined,
          countryOfOrigin: req.query.country as string,
          genre: req.query.genres as string,
          genre_not_in: req.query.excludeGenres
            ? (req.query.excludeGenres as string).split(',')
            : undefined,
          isAdult: true,
          sort: (req.query.sortBy as string) || undefined,
        })
        return res.json({ data: result, hasMore: result.length >= limit })
      }

      if (provider === 'wh') {
        const p = this.providers['wh'] as unknown as {
          browse: (o: { query?: string; page?: number; genre?: string }) => Promise<{
            shows: Show[]
            hasMore: boolean
          }>
        }
        const result = await p.browse({
          query,
          page,
          genre: (req.query.genre as string) || undefined,
        })
        return res.json({ data: result.shows, hasMore: result.hasMore })
      }

      if (provider === 'op') {
        const p = this.providers['op'] as unknown as {
          browse: (o: {
            query?: string
            page?: number
            limit?: number
            order?: string
            genres?: string
            blacklist?: string
            studio?: string
          }) => Promise<{
            shows: Show[]
            total: number
            hasMore: boolean
          }>
        }
        const result = await p.browse({
          query,
          page,
          limit,
          order: (req.query.order as string) || undefined,
          genres: (req.query.genres as string) || undefined,
          blacklist: (req.query.blacklist as string) || undefined,
          studio: (req.query.studio as string) || undefined,
        })
        return res.json({ data: result.shows, hasMore: result.hasMore, total: result.total })
      }

      if (provider === 'ht') {
        const p = this.providers['ht'] as unknown as {
          browse: (o: {
            query?: string
            limit?: number
            genre?: string
            page?: number
          }) => Promise<{
            shows: Show[]
            hasMore: boolean
          }>
        }
        const result = await p.browse({
          query,
          limit: 40,
          genre: (req.query.genre as string) || undefined,
          page,
        })
        return res.json({ data: result.shows, hasMore: result.hasMore })
      }

      if (provider === 'hn') {
        const p = this.providers['hn'] as unknown as {
          browse: (o: {
            query?: string
            page?: number
            pageSize?: number
            sort?: string
            genre?: string
          }) => Promise<{
            shows: Show[]
            hasMore: boolean
            genres: { slug: string; name: string }[]
          }>
        }
        if (!p?.browse) {
          const shows = await this.providers['hn'].search({ query })
          return res.json({
            data: shows.map((s) => ({ ...s, isAdult: true })),
            hasMore: false,
          })
        }
        const result = await p.browse({
          query,
          page,
          pageSize: limit,
          sort: (req.query.sortBy as string) || undefined,
          genre: (req.query.genre as string) || undefined,
        })
        return res.json({ data: result.shows, hasMore: result.hasMore, genres: result.genres })
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
            format: req.query.type as string,
            status: req.query.status as string,
            genre: undefined,
            genre_not_in: req.query.excludeGenres
              ? (req.query.excludeGenres as string).split(',')
              : undefined,
            isAdult: true,
            sort: (req.query.sortBy as string) || undefined,
            averageScore_greater: req.query.minScore
              ? parseInt(req.query.minScore as string)
              : undefined,
            episodes_greater: req.query.minEpisodes
              ? parseInt(req.query.minEpisodes as string)
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
        return res.json({ data: sliced, hasMore: shows.length >= limit })
      }

      return res.status(400).json({ error: 'Unknown mature provider' })
    } catch (e) {
      logger.error({ err: e }, 'mature search failed')
      res.json({ data: [], hasMore: false })
    }
  }

  resolveMature = async (req: Request, res: Response) => {
    try {
      const title = ((req.query.title as string) || '').trim()
      if (!title) return res.status(400).json({ error: 'title is required' })

      const anilistResult = await searchAnilistByTitle(title)
      if (anilistResult) {
        const id = anilistResult.id
        return res.json({ id: typeof id === 'number' && id < 0 ? `mal-${Math.abs(id)}` : id })
      }

      const malResult = await malSearchTitle(malCacheStore(), title)
      if (malResult) return res.json({ id: malResult, provider: 'mal' })

      return res.status(404).json({ error: 'No match found' })
    } catch (e) {
      logger.error({ err: e }, 'mature resolve failed')
      res.status(500).json({ error: 'Resolve failed' })
    }
  }

  getMatureFilters = async (_req: Request, res: Response) => {
    try {
      const { WH_GENRES } = await import('../providers/wh.provider')
      const { OP_TAGS, OP_ORDERS } = await import('../providers/op.provider')
      const { HT_GENRES } = await import('../providers/ht.provider')
      return res.json({
        whGenres: WH_GENRES,
        opTags: OP_TAGS,
        opOrders: OP_ORDERS,
        htGenres: HT_GENRES,
      })
    } catch (e) {
      logger.error({ err: e }, 'mature filters failed')
      res.status(500).json({ error: 'Failed to load filters' })
    }
  }

  getSeasonal = async (req: Request, res: Response) => {
    const page = parseInt(req.query.page as string) || 1
    const size = parseInt(req.query.size as string) || 14
    const format = req.query.format as string | undefined
    try {
      const data = await getSeasonal(page, size, format)
      res.set('Cache-Control', 'public, max-age=300').json(data)
    } catch (e) {
      logger.error({ err: e }, 'Seasonal fetch failed')
      res.json([])
    }
  }

  getLatestReleases = async (req: Request, res: Response) => {
    const format = (req.query.format as string) || 'TV'
    const page = parseInt(req.query.page as string) || 1
    const size = parseInt(req.query.size as string) || 12
    try {
      const data = await getLatestReleases(format, page, size)
      res.set('Cache-Control', 'public, max-age=300').json(data)
    } catch (e) {
      logger.error({ err: e }, 'Latest releases fetch failed')
      res.json([])
    }
  }

  getShowMeta = async (req: Request, res: Response) => {
    const showIdRaw = req.params.id as string
    const id = await getMigratedId(req.db, showIdRaw)

    if (isTempShowId(id)) {
      const row = TempShowIdsRepository.getById(req.db, id)
      if (!row || !isTempMatureProvider(row.provider)) {
        res.json({})
        return
      }
      res.set('Cache-Control', 'public, max-age=300').json({
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
      })
      return
    }

    const isNumeric = /^(mal-\d+|-?\d+)$/i.test(id)

    if (isNumeric) {
      let meta: Show | null = null
      try {
        meta = await getShowMetaById(id)
      } catch (e) {
        logger.warn({ err: e, id }, 'AniList show-meta fetch failed, trying local cache')
        const localMeta = (await ShowsMetaRepository.getById(req.db, id)) as Record<
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
          res.set('Cache-Control', 'public, max-age=3600').json(localMeta)
          return
        }
      }

      if (meta) {
        ShowsMetaRepository.upsert(req.db, {
          id,
          name: meta.name,
          thumbnail: meta.thumbnail,
          nativeName: meta.nativeName,
          englishName: meta.englishName,
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

        const existingWatchlist = (await WatchlistRepository.getById(req.db, id)) as {
          thumbnail?: string
        } | null
        if (existingWatchlist && existingWatchlist.thumbnail !== (meta.thumbnail || '')) {
          WatchlistRepository.updateThumbnail(req.db, id, meta.thumbnail || '')
        }
      }

      if (!meta && !/^mal-/i.test(id)) {
        try {
          const d = await malAnimeDetail(malCacheStore(), Math.abs(parseInt(id, 10)))
          if (d.detail) {
            meta = { ...fromAnilistMedia(toAnilistDetailMedia(d.detail)), isAdult: true }
          }
        } catch (e) {
          logger.warn({ err: e, id }, 'mal show-meta fallback failed')
        }
      }

      if (/^(mal-\d+|-\d+)$/i.test(id) && meta?.anilistId && meta.anilistId > 0) {
        try {
          dbRun(
            req.db,
            'INSERT OR REPLACE INTO legacy_id_mapping (legacyId, numericId) VALUES (?, ?)',
            [id, String(meta.anilistId)]
          )
        } catch {
          // ignore
        }
      }

      res.set('Cache-Control', 'public, max-age=3600').json(meta || {})
      return
    }

    res.json({})
  }

  allocateTempShow = async (req: Request, res: Response) => {
    try {
      const provider = String(req.body?.provider || '').toLowerCase()
      const nativeId = String(req.body?.nativeId || '').trim()
      const title = String(req.body?.title || '').trim()
      const thumbnail = String(req.body?.thumbnail || '')
      if (!provider || !this.providers[provider] || !isTempMatureProvider(provider)) {
        return res.status(400).json({ error: 'Unknown provider' })
      }
      if (!nativeId || !title) {
        return res.status(400).json({ error: 'nativeId and title are required' })
      }
      const row = TempShowIdsRepository.allocate(req.db, {
        provider,
        nativeId,
        title,
        thumbnail,
      })
      return res.json({ id: row.id })
    } catch (e) {
      logger.error({ err: e }, 'temp show allocate failed')
      res.status(500).json({ error: 'Allocate failed' })
    }
  }

  getAnilistStatus = async (_req: Request, res: Response) => {
    const available = !anilistUnavailable()
    if (!available) {
      checkAnilistStatus().catch(() => {})
    }
    res.json({ available, wasDownAtBoot: wasAnilistDownAtBoot() })
  }

  getGenresAndTags = async (_req: Request, res: Response) => {
    try {
      res.json(await getGenreTagLists())
    } catch (e) {
      logger.error({ err: e }, 'genres-and-tags failed')
      res.status(500).json({ error: 'Failed to load genres' })
    }
  }

  getSystemNotifications = async (_req: Request, res: Response) => {
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
    res.json(notifications)
  }

  getBatchedHome = async (req: Request, res: Response) => {
    try {
      const format = (req.query.format as string) || undefined
      const data = await getBatchedHomeData(format)
      res.set('Cache-Control', 'public, max-age=300').json(data)
    } catch (e) {
      logger.error({ err: e }, 'Batched home fetch failed')
      res.json({ trending: [], seasonal: [], spotlight: [] })
    }
  }
}

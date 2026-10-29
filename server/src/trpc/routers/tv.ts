import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { defineSchema, optStr, readCount, readPage, reqId, reqObj, reqStr } from '../validation.js'
import { badRequest, failed } from '../errors.js'
import {
  tmdbMediaDetails,
  tmdbMediaMeta,
  tmdbSearchMedia,
  tmdbSeasonEpisodes,
  tmdbTrendingMedia,
  TMDB_IMAGE,
  type TmdbEpisode,
  type TmdbSearchItem,
  type TmdbSeason,
} from '../../lib/tmdb.js'
import { fetchWithRetry, parseJsonBody } from '../../utils/http.utils.js'
import { buildTvMediaRequest } from '../../lib/tv-media.js'
import { rankByTitleMatch } from '../../providers/title-matching.js'
import logger from '../../logger.js'

async function resolveTvMeta(
  mediaType: 'movie' | 'tv',
  numericTmdbId: number,
  partial: { title: string; year: string; imdbId: string; totalSeasons: string }
): Promise<{ title: string; year: string; imdbId: string; totalSeasons: string }> {
  const meta = { ...partial }
  if (meta.title && meta.imdbId && meta.year) return meta
  const d = await tmdbMediaMeta(mediaType, numericTmdbId)
  if (d) {
    if (!meta.title) meta.title = d.title || d.name || ''
    if (!meta.year) meta.year = (d.release_date || d.first_air_date || '').split('-')[0] || ''
    if (!meta.imdbId) meta.imdbId = d.external_ids?.imdb_id || d.imdb_id || ''
    if (mediaType === 'tv' && d.number_of_seasons) meta.totalSeasons = String(d.number_of_seasons)
  }
  return meta
}

type SearchResultItem = {
  id: number
  title: string
  year: string
  type: string
  image: string
  backdrop: string
  overview: string
  vote_average: number
  adult: boolean
  genre_ids: number[]
}

function toSearchResult(
  item: TmdbSearchItem & { overview?: string; genre_ids?: number[]; backdrop_path?: string | null },
  type: string
): SearchResultItem {
  return {
    id: item.id,
    title: item.title || item.name || '',
    year: (item.release_date || item.first_air_date || '').split('-')[0],
    type,
    image: item.poster_path ? `${TMDB_IMAGE}/w500${item.poster_path}` : '',
    backdrop: item.backdrop_path ? `${TMDB_IMAGE}/w780${item.backdrop_path}` : '',
    overview: item.overview || '',
    vote_average: item.vote_average || 0,
    adult: item.adult === true,
    genre_ids: item.genre_ids || [],
  }
}

type TvSearchPayload = {
  results: SearchResultItem[]
  total_results: number
  total_pages: number
  page: number
}

type TvSubtitlesPayload = {
  subtitles: {
    language: string
    label: string
    url: string
    trusted: boolean
    hi: boolean
    downloads: number
    media: string
  }[]
}

export type TvSearchInput = {
  q?: string
  page?: number
  type?: string
  genre?: string
  year?: string
  sortBy?: string
}

const tvSearchInput = () =>
  defineSchema<TvSearchInput, TvSearchInput>((value) => {
    const obj = reqObj(value)
    const out: TvSearchInput = {}
    const q = optStr(obj, 'q')
    if (q !== undefined) out.q = q
    if (obj.page !== undefined) out.page = readPage(obj)
    const type = optStr(obj, 'type')
    if (type !== undefined) out.type = type
    const genre = optStr(obj, 'genre')
    if (genre !== undefined) out.genre = genre
    const year = optStr(obj, 'year')
    if (year !== undefined) out.year = year
    const sortBy = optStr(obj, 'sortBy')
    if (sortBy !== undefined) out.sortBy = sortBy
    return out
  })

export type TvTrendingInput = { mediaType?: string; timeWindow?: string; page?: number }

const tvTrendingInput = () =>
  defineSchema<TvTrendingInput, TvTrendingInput>((value) => {
    const obj = reqObj(value)
    const out: TvTrendingInput = {}
    const mediaType = optStr(obj, 'mediaType')
    if (mediaType !== undefined) out.mediaType = mediaType
    const timeWindow = optStr(obj, 'timeWindow')
    if (timeWindow !== undefined) out.timeWindow = timeWindow
    if (obj.page !== undefined) out.page = readPage(obj)
    return out
  })

export type TvDetailsInput = { type: string; id: string }

const tvDetailsInput = () =>
  defineSchema<TvDetailsInput, TvDetailsInput>((value) => {
    const obj = reqObj(value)
    return { type: reqStr(obj, 'type'), id: reqId(obj, 'id') }
  })

export type TvEpisodesInput = { id: string; season: string }

const tvEpisodesInput = () =>
  defineSchema<TvEpisodesInput, TvEpisodesInput>((value) => {
    const obj = reqObj(value)
    return { id: reqId(obj, 'id'), season: reqId(obj, 'season') }
  })

export type TvSubtitlesInput = { type: string; tmdbId: string; season?: string; episode?: string }

const tvSubtitlesInput = () =>
  defineSchema<TvSubtitlesInput, TvSubtitlesInput>((value) => {
    const obj = reqObj(value)
    const out: TvSubtitlesInput = { type: reqStr(obj, 'type'), tmdbId: reqId(obj, 'tmdbId') }
    const season = optStr(obj, 'season')
    if (season !== undefined) out.season = season
    const episode = optStr(obj, 'episode')
    if (episode !== undefined) out.episode = episode
    return out
  })

export type TvSourcesInput = {
  provider: string
  type: string
  tmdbId: string
  season?: number
  episode?: number
  server?: string
  title?: string
  year?: string
  imdbId?: string
  totalSeasons?: string
}

const tvSourcesInput = () =>
  defineSchema<TvSourcesInput, TvSourcesInput>((value) => {
    const obj = reqObj(value)
    const out: TvSourcesInput = {
      provider: reqStr(obj, 'provider'),
      type: reqStr(obj, 'type'),
      tmdbId: reqId(obj, 'tmdbId'),
    }
    if (obj.season !== undefined) out.season = readCount(obj, 'season', 1)
    if (obj.episode !== undefined) out.episode = readCount(obj, 'episode', 1)
    const server = optStr(obj, 'server')
    if (server !== undefined) out.server = server
    const title = optStr(obj, 'title')
    if (title !== undefined) out.title = title
    const year = optStr(obj, 'year')
    if (year !== undefined) out.year = year
    const imdbId = optStr(obj, 'imdbId')
    if (imdbId !== undefined) out.imdbId = imdbId
    const totalSeasons = optStr(obj, 'totalSeasons')
    if (totalSeasons !== undefined) out.totalSeasons = totalSeasons
    return out
  })

export const tvRouter = router({
  search: protectedProcedure.input(tvSearchInput()).query(async ({ ctx, input }) => {
    const query = input.q || ''
    const page = input.page || 1
    const type = input.type || 'multi'
    const genre = input.genre || ''
    const year = input.year || ''
    const sortBy = input.sortBy || 'popularity.desc'
    const cacheKey = `tv-search-${query.toLowerCase()}-${page}-${type}-${genre}-${year}-${sortBy}`
    const cached = ctx.apiCache.get<TvSearchPayload>(cacheKey)
    if (cached) return cached
    try {
      const d = await tmdbSearchMedia({ query, page, type, genre, year, sortBy })
      let results: SearchResultItem[]
      if (type === 'tv' || type === 'movie') {
        results = (d.results || []).map(
          (
            item: TmdbSearchItem & {
              overview?: string
              genre_ids?: number[]
              backdrop_path?: string | null
            }
          ) => toSearchResult(item, type)
        )
      } else {
        results = (d.results || [])
          .filter((item: TmdbSearchItem) => item.media_type !== 'person')
          .map(
            (
              item: TmdbSearchItem & {
                overview?: string
                genre_ids?: number[]
                backdrop_path?: string | null
              }
            ) => toSearchResult(item, item.media_type || 'tv')
          )
      }
      results = rankByTitleMatch(results, query, (item) => [item.title])
      const payload: TvSearchPayload = {
        results,
        total_results: d.total_results || 0,
        total_pages: d.total_pages || 0,
        page: d.page || page,
      }
      ctx.apiCache.set(cacheKey, payload, 1800)
      return payload
    } catch (e) {
      if (e instanceof TRPCError) throw e
      throw failed((e as Error).message)
    }
  }),

  trending: protectedProcedure.input(tvTrendingInput()).query(async ({ ctx, input }) => {
    const mediaType = input.mediaType || 'all'
    const timeWindow = input.timeWindow || 'week'
    const page = input.page || 1
    const cacheKey = `tv-trending-${mediaType}-${timeWindow}-${page}`
    const cached = ctx.apiCache.get<TvSearchPayload>(cacheKey)
    if (cached) return cached
    try {
      const d = await tmdbTrendingMedia(mediaType, timeWindow, page)
      const results = (d.results || [])
        .filter((item: TmdbSearchItem) => item.media_type !== 'person')
        .map(
          (
            item: TmdbSearchItem & {
              overview?: string
              genre_ids?: number[]
              backdrop_path?: string | null
            }
          ) => toSearchResult(item, item.media_type || 'tv')
        )
      const payload: TvSearchPayload = {
        results,
        total_results: d.total_results || 0,
        total_pages: d.total_pages || 0,
        page: d.page || page,
      }
      ctx.apiCache.set(cacheKey, payload, 3600)
      return payload
    } catch (e) {
      if (e instanceof TRPCError) throw e
      throw failed((e as Error).message)
    }
  }),

  details: protectedProcedure.input(tvDetailsInput()).query(async ({ input }) => {
    const type = input.type
    const id = input.id
    try {
      const d = await tmdbMediaDetails(type, id)
      const result: {
        id: number
        imdb_id: string | null
        title?: string
        overview?: string
        vote_average?: number
        year: string
        poster: string
        backdrop: string
        adult: boolean
        seasons?: TmdbSeason[]
        number_of_seasons?: number
      } = {
        id: d.id,
        imdb_id: d.external_ids?.imdb_id || d.imdb_id || null,
        title: d.title || d.name,
        overview: d.overview,
        vote_average: d.vote_average,
        year: (d.release_date || d.first_air_date || '').split('-')[0],
        poster: d.poster_path ? `${TMDB_IMAGE}/w500${d.poster_path}` : '',
        backdrop: d.backdrop_path ? `${TMDB_IMAGE}/original${d.backdrop_path}` : '',
        adult: d.adult === true,
      }
      if (type === 'tv') {
        result.seasons = (d.seasons || [])
          .filter((s: TmdbSeason) => s.season_number > 0)
          .map((s: TmdbSeason) => ({
            season_number: s.season_number,
            episode_count: s.episode_count,
          }))
        result.number_of_seasons = d.number_of_seasons
      }
      return result
    } catch (e) {
      if (e instanceof TRPCError) throw e
      throw failed((e as Error).message)
    }
  }),

  episodes: protectedProcedure.input(tvEpisodesInput()).query(async ({ input }) => {
    const id = input.id
    const season = input.season
    try {
      const episodes = (await tmdbSeasonEpisodes(id, season)).map((ep: TmdbEpisode) => ({
        episode_number: ep.episode_number,
        name: ep.name,
        vote_average: ep.vote_average,
        overview: ep.overview,
        still_path: ep.still_path,
      }))
      return { episodes }
    } catch (e) {
      if (e instanceof TRPCError) throw e
      throw failed((e as Error).message)
    }
  }),

  subtitles: protectedProcedure.input(tvSubtitlesInput()).query(async ({ ctx, input }) => {
    const type = input.type
    const tmdbId = input.tmdbId
    const numericTmdbId = parseInt(tmdbId, 10)
    if (!numericTmdbId) return { subtitles: [] }
    const mediaType = type === 'movie' ? 'movie' : 'tv'
    const season = input.season || '1'
    const episode = input.episode || '1'
    const cacheKey =
      mediaType === 'tv'
        ? `tv-subs-${numericTmdbId}-${season}-${episode}`
        : `tv-subs-${numericTmdbId}-movie`
    const cached = ctx.apiCache.get<TvSubtitlesPayload>(cacheKey)
    if (cached) return cached
    try {
      const searchUrl =
        mediaType === 'tv'
          ? `https://subtitles.vidy.st/search?id=${numericTmdbId}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`
          : `https://subtitles.vidy.st/search?id=${numericTmdbId}`
      const r = await fetchWithRetry(
        searchUrl,
        { headers: { 'User-Agent': 'Mozilla/5.0' } },
        { timeoutMs: 10000 }
      )
      if (!r.ok) return { subtitles: [] }
      const items = (await parseJsonBody(r)) as {
        url?: string
        language?: string
        display?: string
        format?: string
        isTrusted?: boolean
        isHearingImpaired?: boolean
        downloadCount?: number
        media?: string
        release?: string
      }[]
      const subtitles = (Array.isArray(items) ? items : [])
        .filter((s) => typeof s.url === 'string' && s.url.startsWith('https://'))
        .map((s) => ({
          language: String(s.language || 'en'),
          label: String(s.display || s.language || 'Unknown'),
          url: String(s.url),
          trusted: s.isTrusted === true,
          hi: s.isHearingImpaired === true,
          downloads: Number(s.downloadCount) || 0,
          media: String(s.media || s.release || ''),
        }))
        .sort((a, b) => {
          const aEn = a.language.toLowerCase().startsWith('en') ? 0 : 1
          const bEn = b.language.toLowerCase().startsWith('en') ? 0 : 1
          if (aEn !== bEn) return aEn - bEn
          if (a.trusted !== b.trusted) return a.trusted ? -1 : 1
          return b.downloads - a.downloads
        })
        .slice(0, 50)
      const payload: TvSubtitlesPayload = { subtitles }
      ctx.apiCache.set(cacheKey, payload, 3600)
      return payload
    } catch (e) {
      logger.warn({ err: e, mediaType, tmdbId }, 'Subtitle fetch failed')
      return { subtitles: [] }
    }
  }),

  sources: protectedProcedure.input(tvSourcesInput()).query(async ({ ctx, input }) => {
    const provider = input.provider
    const type = input.type
    const tmdbId = input.tmdbId
    const mediaType = type === 'movie' ? 'movie' : 'tv'
    const numericTmdbId = parseInt(tmdbId, 10)
    if (!numericTmdbId) throw badRequest('Bad tmdb id')
    const mod = ctx.getTvProvider(String(provider).toLowerCase())
    if (!mod || typeof mod.getSources !== 'function') {
      throw badRequest(`Unknown TV provider ${provider}`)
    }
    const season = input.season || 1
    const episode = input.episode || 1
    const server = input.server
    const meta = await resolveTvMeta(mediaType, numericTmdbId, {
      title: input.title || '',
      year: input.year || '',
      imdbId: input.imdbId || '',
      totalSeasons: input.totalSeasons || '1',
    })
    const media = buildTvMediaRequest({
      tmdbId: numericTmdbId,
      type: mediaType,
      season,
      episode,
      title: meta.title,
      year: meta.year,
      imdbId: meta.imdbId,
      totalSeasons: parseInt(meta.totalSeasons, 10) || 1,
    })
    try {
      const result = await mod.getSources(media, server)
      if (!result || !Array.isArray(result.sources) || result.sources.length === 0) {
        return {
          provider: mod.name,
          server: result?.server || server,
          sources: [],
          audioTracks: [],
          valid: false,
          error: 'No sources found',
        }
      }
      return {
        provider: mod.name,
        server: result.server || server,
        servers: result.servers,
        embedUrl: result.embedUrl,
        sources: result.sources,
        audioTracks: result.audioTracks || [],
        subtitles: result.subtitles || [],
        referer: result.referer || '',
        valid: true,
      }
    } catch (e) {
      throw failed((e as Error).message)
    }
  }),
})

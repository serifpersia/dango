import type { Hono } from 'hono'
import type { AppCache } from '../utils/cache.utils.js'
import logger from '../logger.js'
import { parseJsonBody } from '../utils/http.utils.js'
import { getTmdbKey, TMDB_BASE, TMDB_IMAGE } from '../lib/tmdb.js'
import { URL } from 'url'
import { isSafeExternalUrl } from '../utils/security.utils.js'
import type { TvMediaRequest, TvProvider } from '../providers/tv.types.js'

async function resolveTvMeta(
  mediaType: 'movie' | 'tv',
  numericTmdbId: number,
  partial: { title: string; year: string; imdbId: string; totalSeasons: string }
): Promise<{ title: string; year: string; imdbId: string; totalSeasons: string }> {
  const meta = { ...partial }
  if (meta.title && meta.imdbId && meta.year) return meta
  try {
    const tmdbKey = await getTmdbKey()
    if (tmdbKey) {
      const tmdbRes = await fetch(
        `${TMDB_BASE}/${mediaType}/${numericTmdbId}?api_key=${tmdbKey}&append_to_response=external_ids`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
      )
      if (tmdbRes.ok) {
        const d = await parseJsonBody<TmdbMetaBody>(tmdbRes)
        if (!meta.title) meta.title = d.title || d.name || ''
        if (!meta.year) meta.year = (d.release_date || d.first_air_date || '').split('-')[0] || ''
        if (!meta.imdbId) meta.imdbId = d.external_ids?.imdb_id || d.imdb_id || ''
        if (mediaType === 'tv' && d.number_of_seasons)
          meta.totalSeasons = String(d.number_of_seasons)
      }
    }
  } catch {
    // ignore
  }
  return meta
}

interface TmdbSearchItem {
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  media_type?: string
  poster_path?: string | null
  vote_average?: number
  adult?: boolean
}

interface TmdbSeason {
  season_number: number
  episode_count: number
}

interface TmdbEpisode {
  episode_number: number
  name?: string
  vote_average?: number
  overview?: string
  still_path?: string | null
}

interface TmdbDetailsResult {
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
}

interface TmdbMetaBody {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  imdb_id?: string | null
  external_ids?: { imdb_id?: string | null }
  number_of_seasons?: number
}

interface TmdbDetailsBody {
  id: number
  title?: string
  name?: string
  overview?: string
  vote_average?: number
  release_date?: string
  first_air_date?: string
  poster_path?: string | null
  backdrop_path?: string | null
  adult?: boolean
  imdb_id?: string | null
  external_ids?: { imdb_id?: string | null }
  seasons?: TmdbSeason[]
  number_of_seasons?: number
}

function proxiedMediaUrl(targetUrl: string, refererStr: string): string {
  return `/api/tv/stream-proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(refererStr)}`
}

export function rewriteTvPlaylist(body: string, baseUrl: URL, refererStr: string): string {
  return body
    .split('\n')
    .map((line: string) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) {
        return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
          const absolute = new URL(uri, baseUrl).href
          return `URI="${proxiedMediaUrl(absolute, refererStr)}"`
        })
      }
      const absolute = new URL(trimmed, baseUrl).href
      return proxiedMediaUrl(absolute, refererStr)
    })
    .join('\n')
}

export function isPlaylistBody(body: Buffer): boolean {
  return (
    body.length >= 7 &&
    body
      .subarray(0, 32)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .trimStart()
      .startsWith('#EXTM3U')
  )
}

interface ImdbSuggestion {
  id?: string
  l?: string
  y?: number
  qid?: string
  i?: { imageUrl?: string }
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

export function registerTv(
  app: Hono,
  getApiCache: () => AppCache,
  getTvProvider: (name: string) => TvProvider | undefined
) {
  app.get('/api/tv/search', async (c) => {
    const query = c.req.query('q') || ''
    const page = parseInt(c.req.query('page') as string) || 1
    const type = c.req.query('type') || 'multi'
    const genre = c.req.query('genre') || ''
    const year = c.req.query('year') || ''
    const sortBy = c.req.query('sort_by') || 'popularity.desc'
    const hasTypeFilter = type === 'tv' || type === 'movie'
    const hasGenre = !!genre
    const hasYear = !!year && year !== 'ALL'
    const cacheKey = `tv-search-${query.toLowerCase()}-${page}-${type}-${genre}-${year}-${sortBy}`
    const cached = getApiCache().get(cacheKey)
    if (cached) return c.json(cached)
    const key = await getTmdbKey()
    if (!key) return c.json({ error: 'No TMDB API key available' }, 500)
    try {
      let url: string
      if (type === 'tv' || type === 'movie') {
        if (!query.trim()) {
          const params = new URLSearchParams({
            api_key: key,
            page: String(page),
            sort_by: sortBy,
          })
          if (genre) params.set('with_genres', genre)
          if (year) {
            if (type === 'tv') params.set('first_air_date_year', year)
            else params.set('primary_release_year', year)
          }
          url = `${TMDB_BASE}/discover/${type}?${params.toString()}`
        } else {
          const params = new URLSearchParams({
            api_key: key,
            query: encodeURIComponent(query.trim()),
            page: String(page),
            include_adult: 'true',
          })
          url = `${TMDB_BASE}/search/${type}?${params.toString()}`
        }
      } else if (!query.trim()) {
        const params = new URLSearchParams({
          api_key: key,
          page: String(page),
          sort_by: sortBy,
        })
        if (genre) params.set('with_genres', genre)
        if (year) params.set('first_air_date_year', year)
        url = `${TMDB_BASE}/discover/tv?${params.toString()}`
      } else {
        const params = new URLSearchParams({
          api_key: key,
          query: encodeURIComponent(query),
          page: String(page),
          include_adult: 'true',
        })
        url = `${TMDB_BASE}/search/multi?${params.toString()}`
      }
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!r.ok) return c.json({ error: 'TMDB search failed' }, 500)
      const d = await parseJsonBody<{
        results?: TmdbSearchItem[]
        total_results?: number
        total_pages?: number
        page?: number
      }>(r)
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
      const payload = {
        results,
        total_results: d.total_results || 0,
        total_pages: d.total_pages || 0,
        page: d.page || page,
      }
      getApiCache().set(cacheKey, payload, 1800)
      return c.json(payload)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  app.get('/api/tv/trending', async (c) => {
    const mediaType = c.req.query('media_type') || 'all'
    const timeWindow = c.req.query('time_window') || 'week'
    const page = parseInt(c.req.query('page') as string) || 1
    const cacheKey = `tv-trending-${mediaType}-${timeWindow}-${page}`
    const cached = getApiCache().get(cacheKey)
    if (cached) return c.json(cached)
    const key = await getTmdbKey()
    if (!key) return c.json({ error: 'No TMDB API key available' }, 500)
    try {
      const r = await fetch(
        `${TMDB_BASE}/trending/${mediaType}/${timeWindow}?api_key=${key}&page=${page}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!r.ok) return c.json({ error: 'TMDB trending failed' }, 500)
      const d = await parseJsonBody<{
        results?: (TmdbSearchItem & {
          overview?: string
          genre_ids?: number[]
          backdrop_path?: string | null
        })[]
        total_results?: number
        total_pages?: number
        page?: number
      }>(r)
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
      const payload = {
        results,
        total_results: d.total_results || 0,
        total_pages: d.total_pages || 0,
        page: d.page || page,
      }
      getApiCache().set(cacheKey, payload, 3600)
      return c.json(payload)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  app.get('/api/tv/genres', async (c) => {
    const cacheKey = 'tv-genres-list'
    const cached = getApiCache().get(cacheKey)
    if (cached) return c.json(cached)
    const key = await getTmdbKey()
    if (!key) return c.json({ error: 'No TMDB API key available' }, 500)
    try {
      const [tvRes, movieRes] = await Promise.all([
        fetch(`${TMDB_BASE}/genre/tv/list?api_key=${key}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }),
        fetch(`${TMDB_BASE}/genre/movie/list?api_key=${key}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        }),
      ])
      const tvData = tvRes.ok
        ? await parseJsonBody<{ genres?: { id: number; name: string }[] }>(tvRes)
        : { genres: [] }
      const movieData = movieRes.ok
        ? await parseJsonBody<{ genres?: { id: number; name: string }[] }>(movieRes)
        : { genres: [] }
      const payload = {
        tv: (tvData.genres || []).map((g: { id: number; name: string }) => ({
          id: g.id,
          name: g.name,
        })),
        movie: (movieData.genres || []).map((g: { id: number; name: string }) => ({
          id: g.id,
          name: g.name,
        })),
      }
      getApiCache().set(cacheKey, payload, 86400)
      return c.json(payload)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  app.get('/api/tv/details/:type/:id', async (c) => {
    const type = c.req.param('type')
    const id = c.req.param('id')
    const key = await getTmdbKey()
    if (!key) return c.json({ error: 'No TMDB API key available' }, 500)
    try {
      const r = await fetch(
        `${TMDB_BASE}/${type}/${id}?api_key=${key}&append_to_response=external_ids`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!r.ok) return c.json({ error: 'TMDB details failed' }, 500)
      const d = await parseJsonBody<TmdbDetailsBody>(r)
      const result: TmdbDetailsResult = {
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
      return c.json(result)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  app.get('/api/tv/episodes/:id/:season', async (c) => {
    const id = c.req.param('id')
    const season = c.req.param('season')
    const key = await getTmdbKey()
    if (!key) return c.json({ error: 'No TMDB API key available' }, 500)
    try {
      const r = await fetch(`${TMDB_BASE}/tv/${id}/season/${season}?api_key=${key}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      if (!r.ok) return c.json({ error: 'TMDB episodes failed' }, 500)
      const d = await parseJsonBody<{ episodes?: TmdbEpisode[] }>(r)
      const episodes = (d.episodes || []).map((ep: TmdbEpisode) => ({
        episode_number: ep.episode_number,
        name: ep.name,
        vote_average: ep.vote_average,
        overview: ep.overview,
        still_path: ep.still_path,
      }))
      return c.json({ episodes })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  app.get('/api/tv/lookup/imdb-to-tmdb/:imdbId', async (c) => {
    const key = await getTmdbKey()
    if (!key) return c.json({ tmdbId: null, error: 'No TMDB API key available' })
    try {
      const r = await fetch(
        `${TMDB_BASE}/find/${c.req.param('imdbId')}?api_key=${key}&external_source=imdb_id`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!r.ok) return c.json({ tmdbId: null, error: `TMDB error ${r.status}` })
      const d = await parseJsonBody<{
        movie_results?: TmdbSearchItem[]
        tv_results?: TmdbSearchItem[]
      }>(r)
      const movie = d.movie_results?.[0]
      const tv = d.tv_results?.[0]
      const result = movie || tv
      return c.json({
        tmdbId: result?.id || null,
        type: movie ? 'movie' : tv ? 'tv' : null,
        title: result?.title || result?.name || null,
        year: (result?.release_date || result?.first_air_date || '').substring(0, 4) || null,
      })
    } catch (e) {
      return c.json({ tmdbId: null, error: (e as Error).message })
    }
  })

  app.get('/api/tv/search/imdb', async (c) => {
    const query = c.req.query('q') || ''
    if (!query) return c.json([])
    const cacheKey = `tv-imdb-search-${query.toLowerCase()}`
    const cached = getApiCache().get(cacheKey)
    if (cached) return c.json(cached)
    try {
      const response = await fetch(
        `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!response.ok) return c.json({ error: 'IMDB search failed' }, 500)
      const data = await parseJsonBody<{ d?: ImdbSuggestion[] }>(response)
      const TV_TYPES = new Set(['tvSeries', 'tvMiniSeries', 'movie'])
      const matches = (data.d || [])
        .filter(
          (entry: ImdbSuggestion) => Boolean(entry.id && entry.l) && TV_TYPES.has(entry.qid || '')
        )
        .slice(0, 10)
        .map((entry: ImdbSuggestion) => ({
          id: entry.id,
          title: entry.l,
          year: entry.y,
          type: entry.qid,
          image: entry.i?.imageUrl || '',
        }))
      getApiCache().set(cacheKey, matches, 3600)
      return c.json(matches)
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500)
    }
  })

  app.get('/api/tv/subtitles/:type/:tmdbId', async (c) => {
    const type = c.req.param('type')
    const tmdbId = c.req.param('tmdbId')
    const numericTmdbId = parseInt(tmdbId, 10)
    if (!numericTmdbId) return c.json({ subtitles: [] })
    const mediaType = type === 'movie' ? 'movie' : 'tv'
    const season = String(c.req.query('season') || '1')
    const episode = String(c.req.query('episode') || '1')
    const cacheKey =
      mediaType === 'tv'
        ? `tv-subs-${numericTmdbId}-${season}-${episode}`
        : `tv-subs-${numericTmdbId}-movie`
    const cached = getApiCache().get(cacheKey)
    if (cached) return c.json(cached)
    try {
      const searchUrl =
        mediaType === 'tv'
          ? `https://subtitles.vidy.st/search?id=${numericTmdbId}&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`
          : `https://subtitles.vidy.st/search?id=${numericTmdbId}`
      const r = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) return c.json({ subtitles: [] })
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
      const payload = { subtitles }
      getApiCache().set(cacheKey, payload, 3600)
      return c.json(payload)
    } catch {
      return c.json({ subtitles: [] })
    }
  })

  app.get('/api/tv/sources/:provider/:type/:tmdbId', async (c) => {
    const provider = c.req.param('provider')
    const type = c.req.param('type')
    const tmdbId = c.req.param('tmdbId')
    const mediaType = type === 'movie' ? 'movie' : 'tv'
    const numericTmdbId = parseInt(tmdbId, 10)
    if (!numericTmdbId) return c.json({ sources: [], audioTracks: [], error: 'Bad tmdb id' })
    const mod = getTvProvider(String(provider).toLowerCase())
    if (!mod || typeof mod.getSources !== 'function') {
      return c.json({ sources: [], audioTracks: [], error: `Unknown TV provider ${provider}` })
    }
    const season = parseInt(String(c.req.query('season') || '1'), 10) || 1
    const episode = parseInt(String(c.req.query('episode') || '1'), 10) || 1
    const server = typeof c.req.query('server') === 'string' ? c.req.query('server') : undefined
    const meta = await resolveTvMeta(mediaType, numericTmdbId, {
      title: String(c.req.query('title') || ''),
      year: String(c.req.query('year') || ''),
      imdbId: String(c.req.query('imdbId') || ''),
      totalSeasons: String(c.req.query('totalSeasons') || '1'),
    })
    const media: TvMediaRequest = {
      tmdbId: numericTmdbId,
      type: mediaType,
      season,
      episode,
      title: meta.title,
      year: meta.year,
      imdbId: meta.imdbId,
      totalSeasons: parseInt(meta.totalSeasons, 10) || 1,
    }
    try {
      const result = await mod.getSources(media, server)
      if (!result || !Array.isArray(result.sources) || result.sources.length === 0) {
        return c.json({
          provider: mod.name,
          server: result?.server || server,
          sources: [],
          audioTracks: [],
          valid: false,
          error: 'No sources found',
        })
      }
      return c.json({
        provider: mod.name,
        server: result.server || server,
        sources: result.sources,
        audioTracks: result.audioTracks || [],
        subtitles: result.subtitles || [],
        referer: result.referer || '',
        valid: true,
      })
    } catch (e) {
      return c.json({
        provider: mod.name,
        sources: [],
        audioTracks: [],
        valid: false,
        error: (e as Error).message,
      })
    }
  })

  app.get('/api/tv/embed/:provider/:type/:tmdbId', async (c) => {
    const provider = c.req.param('provider')
    const type = c.req.param('type')
    const tmdbId = c.req.param('tmdbId')
    const mediaType = type === 'movie' ? 'movie' : 'tv'
    const numericTmdbId = parseInt(tmdbId, 10)
    if (!numericTmdbId) return c.json({ url: null, error: 'Bad tmdb id' })
    const mod = getTvProvider(String(provider).toLowerCase())
    if (!mod || typeof mod.getEmbedUrl !== 'function') {
      return c.json({ url: null, error: `Unknown TV provider ${provider}` })
    }
    const media: TvMediaRequest = {
      tmdbId: numericTmdbId,
      type: mediaType,
      season: parseInt(String(c.req.query('season') || '1'), 10) || 1,
      episode: parseInt(String(c.req.query('episode') || '1'), 10) || 1,
      title: '',
      year: '',
      imdbId: '',
      totalSeasons: 1,
    }
    try {
      const url = await mod.getEmbedUrl(media)
      if (!url) return c.json({ url: null, error: 'No embed url' })
      return c.json({ url })
    } catch (e) {
      return c.json({ url: null, error: (e as Error).message })
    }
  })

  app.get('/api/tv/stream-proxy', async (c) => {
    const urlStr = c.req.query('url') ?? ''
    const refererStr = c.req.query('referer') || ''
    if (!urlStr) return c.text('URL required', 400)

    const safeCheck = isSafeExternalUrl(urlStr)
    if (!safeCheck.safe) {
      return c.text(safeCheck.error || 'Invalid URL', 400)
    }

    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 30000)
    c.req.raw.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        abort.abort()
      },
      { once: true }
    )

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
      if (refererStr) headers['Referer'] = refererStr

      const fetchResp = await fetch(urlStr, {
        headers,
        signal: abort.signal,
        redirect: 'follow',
      })

      const status = fetchResp.status
      if (status !== 200 && status !== 206) {
        return c.text('Upstream error', (status || 502) as 502)
      }

      const contentType = fetchResp.headers.get('content-type') || 'application/octet-stream'
      const contentLength = fetchResp.headers.get('content-length')
      const contentRange = fetchResp.headers.get('content-range')
      const acceptRanges = fetchResp.headers.get('accept-ranges')

      const outHeaders = new Headers()
      outHeaders.set('Content-Type', contentType)
      if (contentLength) outHeaders.set('Content-Length', contentLength)
      if (contentRange) outHeaders.set('Content-Range', contentRange)
      if (acceptRanges) outHeaders.set('Accept-Ranges', acceptRanges)
      outHeaders.set('Access-Control-Allow-Origin', '*')
      outHeaders.set('Connection', 'keep-alive')

      if (urlStr.includes('.m3u8') || /mpegurl|m3u8/i.test(contentType)) {
        const body = await fetchResp.text()
        const baseUrl = new URL(fetchResp.url || urlStr)
        const rewritten = rewriteTvPlaylist(body, baseUrl, refererStr)
        const bodyBuffer = Buffer.from(rewritten, 'utf8')
        outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
        outHeaders.set('Content-Length', String(bodyBuffer.length))
        return new Response(bodyBuffer as unknown as BodyInit, { status, headers: outHeaders })
      }

      const chunks: Buffer[] = []
      const reader = fetchResp.body?.getReader()
      if (!reader) {
        return c.text('No response body', 500)
      }
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(Buffer.from(value))
        }
        const body = Buffer.concat(chunks)
        if (isPlaylistBody(body)) {
          const baseUrl = new URL(fetchResp.url || urlStr)
          const rewritten = rewriteTvPlaylist(body.toString('utf8'), baseUrl, refererStr)
          const bodyBuffer = Buffer.from(rewritten, 'utf8')
          outHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
          outHeaders.set('Content-Length', String(bodyBuffer.length))
          return new Response(bodyBuffer as unknown as BodyInit, { status, headers: outHeaders })
        }
        return new Response(body as unknown as BodyInit, { status, headers: outHeaders })
      } catch {
        return c.text('Proxy error', 500)
      }
    } catch {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      return c.text('Proxy error', 500)
    } finally {
      clearTimeout(timeout)
    }
  })
}

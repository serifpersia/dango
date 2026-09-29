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
        logger.warn({ host: safeCheck.url?.hostname }, 'tv stream-proxy: upstream sent no body')
        return c.text('Upstream sent no body', 502)
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
      } catch (err) {
        logger.warn(
          { err, host: safeCheck.url?.hostname },
          'tv stream-proxy: upstream body stream failed'
        )
        return c.text('Upstream stream failed', 502)
      }
    } catch (err) {
      if (abort.signal.aborted) return new Response(null, { status: 499 })
      logger.warn({ err, host: safeCheck.url?.hostname }, 'tv stream-proxy: upstream fetch failed')
      return c.text('Upstream fetch failed', 502)
    } finally {
      clearTimeout(timeout)
    }
  })
}

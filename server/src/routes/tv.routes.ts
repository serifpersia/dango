import { Router, Request, Response } from 'express'
import NodeCache from 'node-cache'
import { getTmdbKey, TMDB_BASE, TMDB_IMAGE } from '../lib/tmdb'
import https from 'https'
import http from 'http'
import { URL } from 'url'

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
  title: string
  overview: string
  vote_average?: number
  year: string
  poster: string
  backdrop: string
  adult: boolean
  seasons?: TmdbSeason[]
  number_of_seasons?: number
}

interface ImdbSuggestion {
  id?: string
  l?: string
  y?: number
  qid?: string
  i?: { imageUrl?: string }
}

interface MovySource {
  url?: string
  quality?: string
}

export function createTvRouter(apiCache: NodeCache): Router {
  const router = Router()

  router.get('/tv/search', async (req, res) => {
    const query = (req.query.q as string) || ''
    if (!query) return res.json([])
    const page = parseInt(req.query.page as string) || 1
    const cacheKey = `tv-search-${query.toLowerCase()}-${page}`
    const cached = apiCache.get(cacheKey)
    if (cached) return res.json(cached)
    const key = await getTmdbKey()
    if (!key) return res.status(500).json({ error: 'No TMDB API key available' })
    try {
      const r = await fetch(
        `${TMDB_BASE}/search/multi?api_key=${key}&query=${encodeURIComponent(query)}&page=${page}&include_adult=true`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!r.ok) return res.status(500).json({ error: 'TMDB search failed' })
      const d = await r.json()
      const results = (d.results || [])
        .filter((item: TmdbSearchItem) => item.media_type !== 'person')
        .map((item: TmdbSearchItem) => ({
          id: item.id,
          title: item.title || item.name,
          year: (item.release_date || item.first_air_date || '').split('-')[0],
          type: item.media_type,
          image: item.poster_path ? `${TMDB_IMAGE}/w500${item.poster_path}` : '',
          vote_average: item.vote_average,
          adult: item.adult === true,
        }))
      apiCache.set(cacheKey, results, 3600)
      res.json(results)
    } catch (e) {
      res.status(500).json({ error: (e as Error).message })
    }
  })

  router.get('/tv/details/:type/:id', async (req, res) => {
    const { type, id } = req.params
    const key = await getTmdbKey()
    if (!key) return res.status(500).json({ error: 'No TMDB API key available' })
    try {
      const r = await fetch(
        `${TMDB_BASE}/${type}/${id}?api_key=${key}&append_to_response=external_ids`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!r.ok) return res.status(500).json({ error: 'TMDB details failed' })
      const d = await r.json()
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
      res.json(result)
    } catch (e) {
      res.status(500).json({ error: (e as Error).message })
    }
  })

  router.get('/tv/episodes/:id/:season', async (req, res) => {
    const { id, season } = req.params
    const key = await getTmdbKey()
    if (!key) return res.status(500).json({ error: 'No TMDB API key available' })
    try {
      const r = await fetch(`${TMDB_BASE}/tv/${id}/season/${season}?api_key=${key}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      })
      if (!r.ok) return res.status(500).json({ error: 'TMDB episodes failed' })
      const d = await r.json()
      const episodes = (d.episodes || []).map((ep: TmdbEpisode) => ({
        episode_number: ep.episode_number,
        name: ep.name,
        vote_average: ep.vote_average,
        overview: ep.overview,
        still_path: ep.still_path,
      }))
      res.json({ episodes })
    } catch (e) {
      res.status(500).json({ error: (e as Error).message })
    }
  })

  router.get('/tv/lookup/imdb-to-tmdb/:imdbId', async (req, res) => {
    const key = await getTmdbKey()
    if (!key) return res.json({ tmdbId: null, error: 'No TMDB API key available' })
    try {
      const r = await fetch(
        `${TMDB_BASE}/find/${req.params.imdbId}?api_key=${key}&external_source=imdb_id`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!r.ok) return res.json({ tmdbId: null, error: `TMDB error ${r.status}` })
      const d = await r.json()
      const movie = d.movie_results?.[0]
      const tv = d.tv_results?.[0]
      const result = movie || tv
      res.json({
        tmdbId: result?.id || null,
        type: movie ? 'movie' : tv ? 'tv' : null,
        title: result?.title || result?.name || null,
        year: (result?.release_date || result?.first_air_date || '').substring(0, 4) || null,
      })
    } catch (e) {
      res.json({ tmdbId: null, error: (e as Error).message })
    }
  })

  router.get('/tv/search/imdb', async (req, res) => {
    const query = (req.query.q as string) || ''
    if (!query) return res.json([])
    const cacheKey = `tv-imdb-search-${query.toLowerCase()}`
    const cached = apiCache.get(cacheKey)
    if (cached) return res.json(cached)
    try {
      const response = await fetch(
        `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(query)}.json`,
        { headers: { 'User-Agent': 'Mozilla/5.0' } }
      )
      if (!response.ok) return res.status(500).json({ error: 'IMDB search failed' })
      const data = await response.json()
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
      apiCache.set(cacheKey, matches, 3600)
      res.json(matches)
    } catch (e) {
      res.status(500).json({ error: (e as Error).message })
    }
  })

  router.get('/tv/movybz/:type/:tmdbId', async (req, res) => {
    const { type, tmdbId } = req.params
    const mediaType = type === 'movie' ? 'movie' : 'tv'
    const season = String(req.query.season || '1')
    const episode = String(req.query.episode || '1')
    const MOVY_API = 'https://api.wecollege.net'
    const MOVY_SERVERS = [
      'miami',
      'phoenix',
      'dallas',
      'seattle',
      'denver',
      'cancun',
      'atlanta',
      'houston',
      'portland',
      'austin',
      'munich',
      'berlin',
      'paris',
      'delhi',
    ]
    const MOVY_K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
      0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
      0x9bdc06a7, 0xc19bf174,
    ]
    const MOVY_MAGIC = [109, 118, 109, 49]
    const movyIsEven = (e: number) => ((e * (e + 1)) & 1) === 0

    function movyMix(e: number) {
      e >>>= 0
      e ^= e >>> 16
      e = Math.imul(e, 0x85ebca6b) >>> 0
      e ^= e >>> 13
      e = Math.imul(e, 0xc2b2ae35) >>> 0
      e ^= e >>> 16
      return e >>> 0
    }

    function movyShift(e: number, t: number) {
      return ((e >>>= 0), 0 === (t &= 31) ? e >>> 0 : ((e << t) | (e >>> (32 - t))) >>> 0)
    }

    function decodeMovyPayload(e: string, t: string | number, a: number): string {
      const r = (function (e: string) {
        const t = e
          .replace(/-/g, '+')
          .replace(/_/g, '/')
          .padEnd(4 * Math.ceil(e.length / 4), '=')
        return new Uint8Array(Buffer.from(t, 'base64'))
      })(e)
      const n = (function (e: string, t: string | number, a: number) {
        const s = (function (e: string, t: string | number) {
          const s = Array(61)
          let r =
            movyMix(
              (function (e: string) {
                let t = 0x811c9dc5
                for (let a = 0; a < e.length; a++)
                  t = Math.imul(t ^ e.charCodeAt(a), 0x1000193) >>> 0
                return movyMix(t)
              })(e) ^ movyMix(((t as number) >>> 0) ^ 0x9e3779b9)
            ) >>> 0
          for (let e = 0; e < 8; e++) {
            if (movyIsEven(e)) {
              const t = r % 61
              r = movyShift((r + 0x9e3779b9) >>> 0, 7 + (7 & e))
              s[t] = (r ^ movyMix(r)) >>> 0
              r = movyMix((r + t) >>> 0)
            } else {
              s[e] = MOVY_K[15 & e]
            }
          }
          return { S: s, acc: movyMix(0xa5a5a5a5 ^ r) >>> 0 }
        })(e, t)
        const r = new Uint8Array(a)
        let n = 0
        for (let e = 0; e < a; ) {
          const t = (function (e: { S: number[]; acc: number }, t: number) {
            const r = e.S
            let n = e.acc
            const i = n % 61
            const o = 0 - Number(i in r)
            const l = r[i] >>> 0
            const c = Math.imul(0x9e3779b9, t + 1) >>> 0
            const h = ((((n ^ ((l ^ c) >>> 0)) >>> 0) | (n & ((l ^ c) >>> 0) & o)) >>> 0) >>> 0
            n = movyMix(
              ((movyShift((h + n) >>> 0, 31 & i) ^ movyShift(n, 31 & Math.imul(i, 7))) +
                0x9e3779b9) >>>
                0
            )
            r[i] = n >>> 0
            e.acc = n
            return n >>> 0
          })(s, n++)
          r[e++] = 255 & t
          if (e < a) r[e++] = (t >>> 8) & 255
          if (e < a) r[e++] = (t >>> 16) & 255
          if (e < a) r[e++] = (t >>> 24) & 255
        }
        return r
      })(String(t), a, r.length)
      for (let e = 0; e < r.length; e++) r[e] ^= n[e]
      for (let e = 0; e < MOVY_MAGIC.length; e++) {
        if (r[e] !== MOVY_MAGIC[e]) throw new Error('decrypt failed: bad seed or payload')
      }
      return Buffer.from(r.subarray(MOVY_MAGIC.length)).toString('utf8')
    }

    const movySeedCache = new Map<string, { seed: string; expiresAt: number }>()
    const inflightSeedRequests = new Map<string, Promise<string>>()

    async function movyGetSeed(mediaId: number, forceRefresh = false): Promise<string | null> {
      const key = String(mediaId)
      const now = Date.now()
      if (!forceRefresh) {
        const cached = movySeedCache.get(key)
        if (cached && cached.expiresAt - 4000 > now) return cached.seed
      }
      if (inflightSeedRequests.has(key)) return await inflightSeedRequests.get(key)!
      const promise = (async () => {
        try {
          const r = await fetch(`${MOVY_API}/seed?mediaId=${mediaId}`, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              Accept: 'application/json, text/plain, */*',
              Referer: 'https://www.movy.bz/',
              Origin: 'https://www.movy.bz',
            },
            signal: AbortSignal.timeout(5000),
          })
          if (r.ok) {
            const data = await r.json()
            const ttl = data.ttlMs || 30000
            movySeedCache.set(key, { seed: data.seed, expiresAt: Date.now() + ttl })
            return data.seed
          }
          if (r.status === 429) {
            const cached = movySeedCache.get(key)
            if (cached) return cached.seed
          }
        } catch (e) {
          const cached = movySeedCache.get(key)
          if (cached) return cached.seed
        } finally {
          inflightSeedRequests.delete(key)
        }
        return movySeedCache.get(key)?.seed || null
      })()
      inflightSeedRequests.set(key, promise)
      return await promise
    }

    const numericTmdbId = parseInt(tmdbId, 10)
    let title = String(req.query.title || '')
    let year = String(req.query.year || '')
    let imdbId = String(req.query.imdbId || '')
    let totalSeasons = String(req.query.totalSeasons || '1')

    if (!title || !imdbId || !year) {
      try {
        const tmdbKey = await getTmdbKey()
        if (tmdbKey) {
          const tmdbRes = await fetch(
            `${TMDB_BASE}/${mediaType}/${numericTmdbId}?api_key=${tmdbKey}&append_to_response=external_ids`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }
          )
          if (tmdbRes.ok) {
            const d = await tmdbRes.json()
            if (!title) title = d.title || d.name || ''
            if (!year) year = (d.release_date || d.first_air_date || '').split('-')[0] || ''
            if (!imdbId) imdbId = d.external_ids?.imdb_id || d.imdb_id || ''
            if (mediaType === 'tv' && d.number_of_seasons)
              totalSeasons = String(d.number_of_seasons)
          }
        }
      } catch {
        // ignore
      }
    }

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://www.movy.bz/',
      Origin: 'https://www.movy.bz',
    }

    const seed = await movyGetSeed(numericTmdbId)
    if (!seed) {
      return res.status(500).json({ error: 'Seed unavailable', tmdbId: numericTmdbId })
    }
    const validSeed: string = seed

    const baseParams: Record<string, string> = {
      title,
      mediaType,
      year,
      tmdbId: String(numericTmdbId),
      imdbId,
      enc: '2',
      seed: validSeed,
    }

    if (mediaType === 'tv') {
      baseParams.totalSeasons = totalSeasons
      baseParams.seasonId = season
      baseParams.episodeId = episode
    }

    for (const city of MOVY_SERVERS) {
      try {
        baseParams.seed = validSeed
        const params = new URLSearchParams(baseParams)
        const r = await fetch(`${MOVY_API}/${city}/sources?${params.toString()}`, {
          headers,
          signal: AbortSignal.timeout(5000),
        })
        if (!r.ok) continue
        const encrypted = await r.text()
        let decrypted
        try {
          decrypted = decodeMovyPayload(encrypted, validSeed, numericTmdbId)
        } catch {
          const retrySeed = await movyGetSeed(numericTmdbId, true)
          if (!retrySeed) continue
          baseParams.seed = retrySeed
          const retryParams = new URLSearchParams(baseParams)
          const retryResp = await fetch(`${MOVY_API}/${city}/sources?${retryParams.toString()}`, {
            headers,
            signal: AbortSignal.timeout(5000),
          })
          if (!retryResp.ok) continue
          decrypted = decodeMovyPayload(await retryResp.text(), retrySeed, numericTmdbId)
        }
        const data = JSON.parse(decrypted)
        if (Array.isArray(data.sources) && data.sources.length > 0) {
          const validSources = data.sources.filter(
            (s: MovySource) => !(s.url || '').includes('.mpd')
          )
          if (validSources.length === 0) continue
          const sources = []
          for (const s of validSources) {
            const isHls = s.url?.includes('.m3u8')
            const isMp4 = s.url?.includes('.mp4')
            const sourceType = isHls ? 'hls' : isMp4 ? 'mp4' : 'hls'
            if (isHls) {
              try {
                const plRes = await fetch(s.url, {
                  headers: {
                    'User-Agent': headers['User-Agent'],
                    Referer: 'https://www.movy.bz/',
                    Origin: 'https://www.movy.bz',
                  },
                  signal: AbortSignal.timeout(6000),
                })
                if (plRes.ok) {
                  const playlist = await plRes.text()
                  const variantRegex =
                    /#EXT-X-STREAM-INF:[^\n]*BANDWIDTH=(\d+)[^\n]*RESOLUTION=(\d+x\d+)[^\n]*(?:FRAME-RATE=([\d.]+))?[^\n]*\n([^\n]+)/g
                  let match
                  const variants = []
                  while ((match = variantRegex.exec(playlist)) !== null) {
                    const resParts = match[2].split('x')
                    variants.push({
                      bandwidth: parseInt(match[1], 10),
                      width: parseInt(resParts[0], 10),
                      height: parseInt(resParts[1], 10),
                      frameRate: match[3] ? parseFloat(match[3]) : null,
                      uri: match[4],
                    })
                  }
                  if (variants.length > 0) {
                    variants.sort((a, b) => a.height - b.height)
                    for (const v of variants) {
                      const fullUrl = v.uri.startsWith('http') ? v.uri : new URL(v.uri, s.url).href
                      sources.push({
                        url: fullUrl,
                        quality: `${v.height}p`,
                        type: 'hls',
                        width: v.width,
                        height: v.height,
                        bandwidth: v.bandwidth,
                        frameRate: v.frameRate,
                      })
                    }
                  } else {
                    sources.push({ url: s.url, quality: s.quality || 'Auto', type: 'hls' })
                  }
                } else {
                  sources.push({ url: s.url, quality: s.quality || 'Auto', type: 'hls' })
                }
              } catch {
                sources.push({ url: s.url, quality: s.quality || 'Auto', type: 'hls' })
              }
            } else {
              sources.push({
                url: s.url,
                quality: s.quality || 'Auto',
                type: isMp4 ? 'mp4' : 'hls',
              })
            }
          }
          return res.json({ server: city, sources, subtitles: data.subtitles || [] })
        }
      } catch {
        continue
      }
    }
    res.json({ sources: [], subtitles: [], error: 'No sources found from Movy servers' })
  })

  router.get('/tv/vixsrc/:type/:tmdbId', async (req, res) => {
    const { type, tmdbId } = req.params
    const season = req.query.season
    const episode = req.query.episode
    const mediaType = type === 'movie' ? 'movie' : 'tv'
    const BASE_URL = 'https://vixsrc.to'
    const HEADERS = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150 Safari/537.36',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      Referer: BASE_URL,
      Origin: BASE_URL,
    }
    try {
      const pageUrl =
        mediaType === 'movie'
          ? `${BASE_URL}/api/movie/${tmdbId}`
          : `${BASE_URL}/api/tv/${tmdbId}/${season}/${episode}`
      const apiRes = await fetch(pageUrl, { headers: HEADERS })
      if (!apiRes.ok) {
        return res.status(500).json({ error: 'VixSrc API failed', status: apiRes.status })
      }
      const apiData = await apiRes.json()
      if (!apiData?.src) {
        return res.json({ sources: [] })
      }
      const htmlUrl = BASE_URL + apiData.src
      const htmlRes = await fetch(htmlUrl, {
        headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml,*/*' },
      })
      if (!htmlRes.ok) {
        return res.status(500).json({ error: 'VixSrc embed failed' })
      }
      const html = await htmlRes.text()
      const token = html.match(/token["']\s*:\s*["']([^"']+)/)?.[1]
      const expires = html.match(/expires["']\s*:\s*["']([^"']+)/)?.[1]
      const playlist = html.match(/url\s*:\s*["']([^"']+)/)?.[1]
      if (!token || !expires || !playlist) {
        return res.json({ sources: [] })
      }
      const sep = playlist.includes('?') ? '&' : '?'
      const masterUrl = `${playlist}${sep}token=${token}&expires=${expires}&h=1`
      const plRes = await fetch(masterUrl, { headers: { ...HEADERS, Referer: pageUrl } })
      if (!plRes.ok) {
        return res.status(500).json({ error: 'VixSrc playlist failed' })
      }
      const playlistContent = await plRes.text()
      const regex = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=\d+x(\d+)[^\n]*\n([^\n]+)/g
      let match
      let bestResolution = 0
      while ((match = regex.exec(playlistContent)) !== null) {
        const resVal = parseInt(match[1], 10)
        if (resVal > bestResolution) bestResolution = resVal
      }
      const sources =
        bestResolution > 0 ? [{ url: masterUrl, quality: `${bestResolution}p`, type: 'hls' }] : []
      const audioTracks = []
      const subtitles = []
      for (const line of playlistContent.split('\n')) {
        if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
          const language = line.match(/LANGUAGE="([^"]+)"/)?.[1] ?? 'unknown'
          const label = line.match(/NAME="([^"]+)"/)?.[1] ?? 'Audio'
          audioTracks.push({ language, label })
        } else if (line.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) {
          const language = line.match(/LANGUAGE="([^"]+)"/)?.[1] ?? 'unknown'
          const label = line.match(/NAME="([^"]+)"/)?.[1] ?? 'Subs'
          const uri = line.match(/URI="([^"]+)"/)?.[1]
          if (uri) {
            subtitles.push({ language, label, url: new URL(uri, masterUrl).href })
          }
        }
      }
      res.json({ sources, audioTracks, subtitles, masterUrl, referer: pageUrl })
    } catch (e) {
      res.status(500).json({ error: 'VixSrc fetch failed', message: (e as Error).message })
    }
  })

  router.get('/tv/stream-proxy', async (req, res) => {
    const { url, referer } = req.query
    const urlStr = url as string
    const refererStr = (referer as string) || ''
    if (!urlStr) return res.status(400).send('URL required')

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), 30000)
    res.on('close', () => {
      clearTimeout(timeout)
      abortController.abort()
    })

    try {
      const headers: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
      if (refererStr) headers['Referer'] = refererStr

      const fetchResp = await fetch(urlStr, {
        headers,
        signal: abortController.signal,
        redirect: 'follow',
      })

      const status = fetchResp.status
      if (status !== 200 && status !== 206) {
        return res.status(status ?? 502).send('Upstream error')
      }

      const contentType = fetchResp.headers.get('content-type') || 'application/octet-stream'
      const contentLength = fetchResp.headers.get('content-length')
      const contentRange = fetchResp.headers.get('content-range')
      const acceptRanges = fetchResp.headers.get('accept-ranges')

      res.status(status)
      res.set('Content-Type', contentType)
      if (contentLength) res.set('Content-Length', contentLength)
      if (contentRange) res.set('Content-Range', contentRange)
      if (acceptRanges) res.set('Accept-Ranges', acceptRanges)
      res.set('Access-Control-Allow-Origin', '*')
      res.set('Connection', 'keep-alive')

      if (urlStr.includes('.m3u8')) {
        const body = await fetchResp.text()
        const baseUrl = new URL(fetchResp.url || urlStr)
        const proxiedMediaUrl = (targetUrl: string) =>
          `/api/tv/stream-proxy?url=${encodeURIComponent(targetUrl)}&referer=${encodeURIComponent(refererStr)}`

        const rewritten = body
          .split('\n')
          .map((line: string) => {
            const trimmed = line.trim()
            if (!trimmed) return line
            if (trimmed.startsWith('#')) {
              return trimmed.replace(/URI="([^"]+)"/g, (_, uri) => {
                const absolute = new URL(uri, baseUrl).href
                return `URI="${proxiedMediaUrl(absolute)}"`
              })
            }
            const absolute = new URL(trimmed, baseUrl).href
            return proxiedMediaUrl(absolute)
          })
          .join('\n')

        const bodyBuffer = Buffer.from(rewritten, 'utf8')
        res.set('Content-Type', 'application/vnd.apple.mpegurl')
        res.set('Content-Length', String(bodyBuffer.length))
        if (!res.headersSent) {
          res.send(bodyBuffer)
        }
      } else {
        const chunks: Buffer[] = []
        const reader = fetchResp.body?.getReader()
        if (!reader) {
          return res.status(500).send('No response body')
        }
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(Buffer.from(value))
          }
          const body = Buffer.concat(chunks)
          res.set('Content-Type', contentType)
          if (contentLength) res.set('Content-Length', contentLength)
          if (contentRange) res.set('Content-Range', contentRange)
          if (acceptRanges) res.set('Accept-Ranges', acceptRanges)
          res.set('Access-Control-Allow-Origin', '*')
          res.set('Connection', 'keep-alive')
          if (!res.headersSent) {
            res.send(body)
          }
        } catch (e) {
          if (!res.headersSent) {
            res.status(500).send('Proxy error')
          }
        }
      }
    } catch (e) {
      if (abortController.signal.aborted) return
      if (!res.headersSent) {
        res.status(500).send('Proxy error')
      }
    }
  })

  return router
}

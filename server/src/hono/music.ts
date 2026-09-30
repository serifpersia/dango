import type { Hono } from 'hono'
import logger from '../logger.js'
import { setProxyHeaders } from '../utils/http.utils.js'
import {
  getInnertube,
  getAuthedInnertube,
  getMusicCookie,
  refreshAuthedInnertube,
  type YtPlayerSession,
  type YtStreamingData,
} from '../lib/ytmusic.js'

interface DecipheredAudio {
  url: string
  mimeType?: string
  fetchedAt: number
}

const UPSTREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const audioCache = new Map<string, DecipheredAudio>()
const AUDIO_CACHE_MS = 5 * 60 * 1000

const AUDIO_CHUNK_BYTES = 262144

function capUpstreamRange(range: string | null): string {
  const m = /^bytes=(\d+)-(\d*)$/.exec((range ?? '').trim())
  if (!m) return `bytes=0-${AUDIO_CHUNK_BYTES - 1}`
  if (m[2] !== '') return m[0]
  const start = Number(m[1])
  return `bytes=${start}-${start + AUDIO_CHUNK_BYTES - 1}`
}

async function decipherWith(
  yt: Awaited<ReturnType<typeof getInnertube>>,
  videoId: string
): Promise<DecipheredAudio> {
  const info = await yt.music.getInfo(videoId)
  const streaming = (info as YtStreamingData).streaming_data
  const formats = streaming?.adaptive_formats ?? []
  const sorted = [...formats]
    .filter((f) => f.has_audio && !f.has_video)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
  const player = (yt.session as YtPlayerSession).player
  for (const fmt of sorted) {
    try {
      const url = await fmt.decipher(player)
      if (url && url.startsWith('http')) {
        const entry: DecipheredAudio = { url, mimeType: fmt.mime_type, fetchedAt: Date.now() }
        audioCache.set(videoId, entry)
        return entry
      }
    } catch {
      // ignore
    }
  }
  throw new Error('No stream available')
}

async function decipherAudio(videoId: string): Promise<DecipheredAudio> {
  const cached = audioCache.get(videoId)
  if (cached && Date.now() - cached.fetchedAt < AUDIO_CACHE_MS) return cached
  const authed = await getAuthedInnertube().catch(() => null)
  if (authed) {
    try {
      return await decipherWith(authed, videoId)
    } catch (err) {
      logger.warn(
        { err },
        '[music] authed stream lookup failed, retrying with a fresh saved-cookie session'
      )
      const fresh = await refreshAuthedInnertube()
      if (fresh) {
        try {
          return await decipherWith(fresh, videoId)
        } catch (retryErr) {
          logger.warn(
            { err: retryErr },
            '[music] refreshed stream lookup failed, falling back to public session'
          )
        }
      }
    }
  }
  return decipherWith(await getInnertube(), videoId)
}

export function registerMusic(app: Hono) {
  app.get('/api/music/stream', async (c) => {
    const videoId = String(c.req.query('videoId') || c.req.query('id') || '').trim()
    if (!videoId) return c.json({ error: 'videoId is required' }, 400)
    try {
      const entry = await decipherAudio(videoId)
      return c.json({ url: entry.url, mimeType: entry.mimeType })
    } catch (err) {
      logger.error({ err }, '[music] stream failed')
      return c.json({ error: 'Stream lookup failed' }, 502)
    }
  })

  app.get('/api/music/audio', async (c) => {
    const videoId = String(c.req.query('videoId') || c.req.query('id') || '').trim()
    if (!videoId) return c.json({ error: 'videoId is required' }, 400)
    try {
      let entry: DecipheredAudio
      try {
        entry = await decipherAudio(videoId)
      } catch {
        return c.json({ error: 'No stream available' }, 502)
      }
      const signal = c.req.raw.signal.aborted
        ? c.req.raw.signal
        : AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(30000)])
      if (c.req.raw.signal.aborted) return new Response(null, { status: 499 })
      let upstream: globalThis.Response
      try {
        const cookie = getMusicCookie()
        upstream = await fetch(entry.url, {
          headers: {
            'User-Agent': UPSTREAM_UA,
            Referer: 'https://music.youtube.com/',
            Origin: 'https://music.youtube.com/',
            Range: capUpstreamRange(c.req.header('range') ?? null),
            ...(cookie ? { Cookie: cookie } : {}),
          },
          signal,
        })
      } catch (err) {
        if (c.req.raw.signal.aborted) return new Response(null, { status: 499 })
        logger.error({ err }, '[music] audio upstream failed')
        return c.json({ error: 'Upstream error' }, 502)
      }
      if (upstream.status !== 200 && upstream.status !== 206) {
        try {
          await upstream.body?.cancel()
        } catch {
          // ignore
        }
        logger.warn(
          { videoId, status: upstream.status },
          '[music] audio upstream rejected range request'
        )
        audioCache.delete(videoId)
        return c.json({ error: 'Upstream error' }, 502)
      }
      const headers = new Headers()
      const upstreamType = upstream.headers.get('content-type')
      if (upstreamType) headers.set('Content-Type', upstreamType)
      else headers.set('Content-Type', entry.mimeType || 'audio/webm')
      setProxyHeaders(headers, (name) => upstream.headers.get(name))
      headers.set('Accept-Ranges', 'bytes')
      if (!upstream.body) {
        return c.json({ error: 'Upstream error' }, 502)
      }
      return new Response(upstream.body, { status: upstream.status, headers })
    } catch (err) {
      if (c.req.raw.signal.aborted) return new Response(null, { status: 499 })
      logger.error({ err }, '[music] audio failed')
      return c.json({ error: 'Stream lookup failed' }, 502)
    }
  })
}

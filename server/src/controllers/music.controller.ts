import { Request, Response } from 'express'
import { Readable } from 'node:stream'
import { AppCache } from '../utils/cache.utils.js'
import logger from '../logger.js'
import {
  getInnertube,
  getAuthedInnertube,
  saveMusicCookie,
  getMusicAuthStatus,
  signOutMusic,
  isParserVariantError,
} from '../lib/ytmusic.js'

interface MusicTrack {
  id: string
  title: string
  artists: string
  album?: string
  duration?: string
  thumbnails: { url: string; width?: number; height?: number }[]
}

const NAME_SUFFIXES = [
  /\s*(- topic)$/i,
  /\s*vevo$/i,
  /\s*[(|[]official(.*?)[)|\]]/i,
  /\s*[(|[]((lyrics?|visualizer|audio)\s*(video)?)[)|\]]/i,
  /\s*[(|[](performance video)[)|\]]/i,
  /\s*[(|[](clip official)[)|\]]/i,
  /\s*[(|[](video version)[)|\]]/i,
  /\s*[(|[](HD|HQ)\s*?(?:audio)?[)|\]]$/i,
  /\s*[(|[](live)[)|\]]$/i,
  /\s*[(|[]4K\s*?(?:upgrade)?[)|\]]$/i,
]

export function cleanupMusicName(name: string): string {
  if (!name) return name
  let out = name
  for (const re of NAME_SUFFIXES) out = out.replace(re, '')
  return out.trim()
}

function toTrack(node: unknown): MusicTrack | null {
  const n = node as Record<string, unknown>
  const id = (n['video_id'] as string) || (n['videoId'] as string) || (n['id'] as string) || ''
  if (!id || typeof id !== 'string') return null
  const titleObj = n['title'] as { text?: string } | string | undefined
  const title = typeof titleObj === 'string' ? titleObj : (titleObj?.text ?? 'Unknown title')
  const artistsRaw = n['artists'] ?? n['authors'] ?? n['subtitle']
  let artists = ''
  if (Array.isArray(artistsRaw)) {
    artists = artistsRaw
      .map((a) => {
        const item = a as { name?: string; text?: string; title?: string }
        return item.name || item.text || item.title || ''
      })
      .filter(Boolean)
      .join(', ')
  } else if (typeof artistsRaw === 'string') {
    artists = artistsRaw
  } else if (artistsRaw && typeof artistsRaw === 'object') {
    artists = (artistsRaw as { text?: string }).text ?? ''
  }
  const thumbsRaw = (n['thumbnails'] ?? n['thumbnail']) as
    | { url: string; width?: number; height?: number }[]
    | { thumbnails?: { url: string; width?: number; height?: number }[] }
    | undefined
  const thumbnails = Array.isArray(thumbsRaw)
    ? thumbsRaw
    : Array.isArray((thumbsRaw as { thumbnails?: unknown[] })?.thumbnails)
      ? ((thumbsRaw as { thumbnails: { url: string }[] }).thumbnails as MusicTrack['thumbnails'])
      : []
  const albumText = textOf(n['album'])
  const durationText = textOf(n['duration'])
  return {
    id,
    title: cleanupMusicName(String(title)),
    artists: cleanupMusicName(artists),
    album: albumText ? cleanupMusicName(albumText) : undefined,
    duration: durationText || undefined,
    thumbnails,
  }
}

interface MusicPlaylist {
  id: string
  title: string
  subtitle?: string
  thumbnails: { url: string; width?: number; height?: number }[]
}

function textOf(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  const obj = value as { text?: string; runs?: { text?: string }[] }
  if (typeof obj.text === 'string') return obj.text
  if (Array.isArray(obj.runs)) return obj.runs.map((r) => r.text || '').join('')
  return ''
}

function thumbsOf(value: unknown): MusicTrack['thumbnails'] {
  if (!value) return []
  if (Array.isArray(value)) {
    return (value as { url?: string; width?: number; height?: number }[])
      .filter((t) => t && typeof t.url === 'string')
      .map((t) => ({ url: t.url as string, width: t.width, height: t.height }))
  }
  const obj = value as { thumbnails?: unknown }
  if (Array.isArray(obj.thumbnails)) return thumbsOf(obj.thumbnails)
  return []
}

interface PlaylistPage {
  items?: unknown[]
  contents?: unknown[]
  has_continuation?: boolean
  getContinuation?: () => Promise<unknown>
}

async function fetchPlaylistTracks(
  yt: Awaited<ReturnType<typeof getAuthedInnertube>> & {},
  id: string,
  cap = 500
): Promise<MusicTrack[]> {
  const tracks: MusicTrack[] = []
  let page = (await yt.music.getPlaylist(id)) as unknown as PlaylistPage
  for (let fetches = 0; fetches < 6; fetches++) {
    for (const item of (page.items ?? page.contents ?? []).slice(0, cap - tracks.length)) {
      const track = toTrack(item)
      if (track) tracks.push(track)
    }
    if (tracks.length >= cap) break
    if (!page.has_continuation || typeof page.getContinuation !== 'function') break
    try {
      page = (await page.getContinuation()) as PlaylistPage
    } catch (err) {
      logger.warn({ err }, '[music] playlist continuation failed')
      break
    }
  }
  return tracks
}

async function readLibrary(yt: Awaited<ReturnType<typeof getAuthedInnertube>> & {}) {
  let lib: { contents?: { items?: unknown[]; contents?: unknown[] }[] }
  try {
    lib = (await yt.music.getLibrary()) as unknown as {
      contents?: { items?: unknown[]; contents?: unknown[] }[]
    }
  } catch (err) {
    if (!isParserVariantError(err)) throw err
    logger.warn('[music] library landing hit a layout variant, falling back to Liked playlist')
    try {
      const tracks = await fetchPlaylistTracks(yt, 'LM')
      return { tracks, playlists: [] as MusicPlaylist[] }
    } catch (fallbackErr) {
      logger.warn({ err: fallbackErr }, '[music] liked playlist fallback failed')
      return { tracks: [], playlists: [] as MusicPlaylist[] }
    }
  }
  const gridItems: unknown[] = []
  for (const section of lib.contents ?? []) {
    const items = section.items ?? section.contents ?? []
    gridItems.push(...items)
  }
  const playlists: MusicPlaylist[] = []
  const seen = new Set<string>()
  for (const item of gridItems) {
    const n = item as Record<string, unknown>
    const id =
      (typeof n['playlist_id'] === 'string' && (n['playlist_id'] as string)) ||
      (typeof n['playlistId'] === 'string' && (n['playlistId'] as string)) ||
      (typeof n['id'] === 'string' && (n['id'] as string)) ||
      ''
    const title = textOf(n['title'])
    const subtitle = textOf(n['subtitle'])
    if (!id || !title || seen.has(id)) continue
    if (!/playlist|mix/i.test(subtitle) && title !== 'Liked Music') continue
    seen.add(id)
    playlists.push({
      id,
      title,
      subtitle: subtitle || undefined,
      thumbnails: thumbsOf(n['thumbnails'] ?? n['thumbnail']),
    })
  }
  const tracks: MusicTrack[] = []
  const liked = playlists.find((p) => p.title === 'Liked Music')
  if (liked) {
    try {
      tracks.push(...(await fetchPlaylistTracks(yt, liked.id)))
    } catch (err) {
      logger.warn({ err }, '[music] liked playlist fetch failed')
    }
  }
  logger.info(
    `[music] library parsed tracks=${tracks.length} playlists=${playlists.length} gridItems=${gridItems.length}`
  )
  return { tracks, playlists }
}

interface DecipheredAudio {
  url: string
  mimeType?: string
  fetchedAt: number
}

const UPSTREAM_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const audioCache = new Map<string, DecipheredAudio>()
const AUDIO_CACHE_MS = 5 * 60 * 1000

async function decipherAudio(videoId: string): Promise<DecipheredAudio> {
  const cached = audioCache.get(videoId)
  if (cached && Date.now() - cached.fetchedAt < AUDIO_CACHE_MS) return cached
  const authed = await getAuthedInnertube().catch(() => null)
  const yt = authed ?? (await getInnertube())
  const info = await yt.music.getInfo(videoId)
  const streaming = (
    info as unknown as {
      streaming_data?: {
        adaptive_formats?: {
          mime_type?: string
          bitrate?: number
          has_audio?: boolean
          has_video?: boolean
          decipher: (player: unknown) => Promise<string>
        }[]
      }
    }
  ).streaming_data
  const formats = streaming?.adaptive_formats ?? []
  const sorted = [...formats]
    .filter((f) => f.has_audio && !f.has_video)
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
  const player = (yt.session as unknown as { player?: unknown }).player
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

const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

export class MusicController {
  constructor(private cache: AppCache) {}

  getAuthStatus = (_req: Request, res: Response) => {
    res.json(getMusicAuthStatus())
  }

  startAuth = async (req: Request, res: Response) => {
    try {
      let cookie = String(req.body?.cookie || '').trim()
      if (!cookie) return res.status(400).json({ error: 'Cookie is required' })
      cookie = cookie
        .replace(/^cookie\s*:\s*/i, '')
        .replace(/^["']+|["']+$/g, '')
        .trim()
      if (cookie.includes('…') || cookie.includes('...')) {
        return res.status(400).json({
          error: `Cookie looks truncated (${cookie.length} chars). In DevTools, right-click the Cookie header → Copy value (do not copy from the wrapped preview).`,
        })
      }
      if (!cookie.includes('SID') && !cookie.includes('SAPISID')) {
        return res.status(400).json({
          error:
            'That does not look like a YouTube cookie at all. Copy the full Cookie request header from a "browse" call on music.youtube.com in DevTools → Network.',
        })
      }
      await saveMusicCookie(cookie)
      const yt = await getAuthedInnertube()
      if (yt) {
        try {
          const lib = await readLibrary(yt)
          return res.json({
            success: true,
            tracks: lib.tracks.length,
            playlists: lib.playlists.length,
          })
        } catch {
          // ignore
        }
      }
      res.json({ success: true, tracks: 0, playlists: 0 })
    } catch (err) {
      logger.error({ err }, '[music] cookie sign-in failed')
      res.status(401).json({
        error:
          'Cookie rejected by YouTube Music. Copy a fresh Cookie header from music.youtube.com.',
      })
    }
  }

  signOut = async (_req: Request, res: Response) => {
    try {
      await signOutMusic()
      res.json({ success: true })
    } catch (err) {
      logger.error({ err }, '[music] sign-out failed')
      res.status(500).json({ error: 'Sign-out failed' })
    }
  }

  search = async (req: Request, res: Response) => {
    const q = String(req.query.q || '').trim()
    if (!q) return res.json({ tracks: [] })
    const cacheKey = `music-search-${q.toLowerCase()}`
    const cached = this.cache.get<MusicTrack[]>(cacheKey)
    if (cached) return res.json({ tracks: cached })
    try {
      const yt = await getInnertube()
      const result = await yt.music.search(q, { type: 'song' })
      const tracks: MusicTrack[] = []
      const contents = (result as unknown as { contents?: unknown[] }).contents ?? []
      for (const section of contents) {
        const items = (section as { contents?: unknown[] }).contents ?? [section]
        for (const item of items) {
          const track = toTrack(item)
          if (track) tracks.push(track)
          if (tracks.length >= 25) break
        }
        if (tracks.length >= 25) break
      }
      this.cache.set(cacheKey, tracks, 300)
      res.json({ tracks })
    } catch (err) {
      logger.error({ err }, '[music] search failed')
      res.json({ tracks: [] })
    }
  }

  stream = async (req: Request, res: Response) => {
    const videoId = String(req.query.videoId || req.query.id || '').trim()
    if (!videoId) return res.status(400).json({ error: 'videoId is required' })
    try {
      const entry = await decipherAudio(videoId)
      res.json({ url: entry.url, mimeType: entry.mimeType })
    } catch (err) {
      logger.error({ err }, '[music] stream failed')
      res.status(502).json({ error: 'Stream lookup failed' })
    }
  }

  audio = async (req: Request, res: Response) => {
    const videoId = String(req.query.videoId || req.query.id || '').trim()
    if (!videoId) return res.status(400).json({ error: 'videoId is required' })
    const aborter = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) aborter.abort()
    })
    try {
      let entry: DecipheredAudio
      try {
        entry = await decipherAudio(videoId)
      } catch {
        return res.status(502).json({ error: 'No stream available' })
      }
      const timeout = AbortSignal.timeout(30000)
      const signal = aborter.signal.aborted
        ? aborter.signal
        : AbortSignal.any([aborter.signal, timeout])
      let upstream: globalThis.Response
      try {
        upstream = await fetch(entry.url, {
          headers: {
            'User-Agent': UPSTREAM_UA,
            Referer: 'https://music.youtube.com/',
            Origin: 'https://music.youtube.com/',
            Range: typeof req.headers.range === 'string' ? req.headers.range : 'bytes=0-',
          },
          signal,
        })
      } catch (err) {
        if (aborter.signal.aborted) return
        logger.error({ err }, '[music] audio upstream failed')
        if (!res.headersSent) res.status(502).json({ error: 'Upstream error' })
        return
      }
      if (upstream.status !== 200 && upstream.status !== 206) {
        try {
          await upstream.body?.cancel()
        } catch {
          // ignore
        }
        audioCache.delete(videoId)
        if (!res.headersSent) res.status(502).json({ error: 'Upstream error' })
        return
      }
      res.status(upstream.status)
      for (const name of PASSTHROUGH_HEADERS) {
        const value = upstream.headers.get(name)
        if (value) res.set(name === 'content-type' ? 'Content-Type' : name, value)
      }
      if (!res.get('Content-Type')) res.set('Content-Type', entry.mimeType || 'audio/webm')
      res.set('Accept-Ranges', 'bytes')
      res.set('Access-Control-Allow-Origin', '*')
      if (!upstream.body) {
        if (!res.headersSent) res.status(502).json({ error: 'Upstream error' })
        return
      }
      try {
        const nodeStream = Readable.fromWeb(
          upstream.body as unknown as import('node:stream/web').ReadableStream
        )
        nodeStream.on('error', () => {
          try {
            if (!res.writableEnded) res.destroy()
          } catch {
            // ignore
          }
        })
        nodeStream.pipe(res)
      } catch (err) {
        logger.error({ err }, '[music] audio pipe failed')
        if (!res.headersSent) res.status(502).json({ error: 'Upstream error' })
      }
    } catch (err) {
      if (aborter.signal.aborted) return
      logger.error({ err }, '[music] audio failed')
      if (!res.headersSent) res.status(502).json({ error: 'Stream lookup failed' })
    }
  }

  track = async (req: Request, res: Response) => {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'id is required', track: null })
    const cacheKey = `music-track-${id.toLowerCase()}`
    const cached = this.cache.get<MusicTrack>(cacheKey)
    if (cached) return res.json({ track: cached })
    try {
      const yt = await getInnertube()
      const info = await yt.music.getInfo(id)
      const basic = (
        info as unknown as {
          basic_info?: {
            title?: string
            author?: string
            duration?: number
            thumbnail?: { url: string; width?: number; height?: number }[]
          }
        }
      ).basic_info
      if (!basic?.title) return res.json({ track: null })
      const durationSec =
        typeof basic.duration === 'number' && Number.isFinite(basic.duration)
          ? Math.max(Math.round(basic.duration), 0)
          : 0
      const track: MusicTrack = {
        id,
        title: cleanupMusicName(String(basic.title)),
        artists: cleanupMusicName(String(basic.author || 'Unknown artist')),
        duration: durationSec
          ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, '0')}`
          : undefined,
        thumbnails: Array.isArray(basic.thumbnail) ? basic.thumbnail : [],
      }
      this.cache.set(cacheKey, track, 300)
      res.json({ track })
    } catch (err) {
      logger.error({ err }, '[music] track lookup failed')
      res.json({ track: null })
    }
  }

  playlist = async (req: Request, res: Response) => {
    const id = String(req.query.id || '').trim()
    if (!id) return res.status(400).json({ error: 'id is required', tracks: [] })
    const yt = await getAuthedInnertube()
    if (!yt) {
      return res.status(401).json({ error: 'MUSIC_AUTH_REQUIRED', tracks: [] })
    }
    try {
      res.json({ tracks: await fetchPlaylistTracks(yt, id) })
    } catch (err) {
      logger.warn({ err }, '[music] playlist failed, returning empty')
      res.json({ tracks: [] })
    }
  }

  library = async (_req: Request, res: Response) => {
    const yt = await getAuthedInnertube()
    if (!yt) {
      return res.status(401).json({ error: 'MUSIC_AUTH_REQUIRED', tracks: [], playlists: [] })
    }
    try {
      res.json(await readLibrary(yt))
    } catch (err) {
      logger.warn({ err }, '[music] library failed, returning empty')
      res.json({ tracks: [], playlists: [] })
    }
  }

  home = async (_req: Request, res: Response) => {
    try {
      const yt = await getInnertube()
      const feed = await yt.music.getHomeFeed()
      res.json(feed)
    } catch (err) {
      logger.error({ err }, '[music] home feed failed')
      res.json({ contents: [] })
    }
  }
}

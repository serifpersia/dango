import type { Hono } from 'hono'
import { Readable } from 'node:stream'
import { AppCache } from '../utils/cache.utils.js'
import logger from '../logger.js'
import {
  getInnertube,
  getAuthedInnertube,
  refreshAuthedInnertube,
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
  liked?: boolean | null
}

const musicCache = new AppCache({ ttlSeconds: 3600, maxKeys: 5000 })

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

function nodeType(node: unknown): string {
  const n = node as { type?: unknown; constructor?: { name?: string } }
  if (typeof n?.type === 'string') return n.type
  return n?.constructor?.name ?? ''
}

function upnextToTrack(node: unknown, trustLike = false): MusicTrack | null {
  const kind = nodeType(node)
  if (kind === 'AutomixPreviewVideo') return null
  const n = node as Record<string, unknown>
  const video =
    kind === 'PlaylistPanelVideoWrapper'
      ? ((n['primary'] as Record<string, unknown> | null) ?? null)
      : n
  if (!video || typeof video !== 'object') return null
  const id = video['video_id']
  if (typeof id !== 'string' || !id) return null
  const artistsRaw = video['artists']
  let artists = ''
  if (Array.isArray(artistsRaw)) {
    artists = artistsRaw
      .map((a) => (a as { name?: string })?.name || '')
      .filter(Boolean)
      .join(', ')
  }
  if (!artists && typeof video['author'] === 'string') artists = video['author']
  const albumRaw = video['album'] as { name?: string } | undefined
  const durationRaw = video['duration'] as { text?: string } | string | undefined
  const durationText = typeof durationRaw === 'string' ? durationRaw : (durationRaw?.text ?? '')
  let liked: boolean | null = null
  if (trustLike) {
    for (const menu of [video['menu'], (node as Record<string, unknown>)['menu']]) {
      let found: boolean | null = null
      for (const entry of asMenuItems(menu)) {
        if (nodeType(entry) !== 'ToggleMenuServiceItem') continue
        const icon = entry['icon_type']
        if (icon !== 'FAVORITE' && icon !== 'UNFAVORITE') continue
        found = icon === 'UNFAVORITE'
        break
      }
      if (found !== null) {
        liked = found
        break
      }
    }
  }
  return {
    id,
    title: cleanupMusicName(textOf(video['title']) || 'Unknown title'),
    artists: cleanupMusicName(artists || 'Unknown artist'),
    album: albumRaw?.name ? cleanupMusicName(albumRaw.name) : undefined,
    duration: durationText || undefined,
    thumbnails: thumbsOf(video['thumbnail'] ?? video['thumbnails']),
    ...(liked !== null ? { liked } : {}),
  }
}

interface MenuEndpoint {
  call: (actions: unknown) => Promise<unknown>
}

function parseUpnext(
  panel: unknown,
  trustLike: boolean
): { tracks: MusicTrack[]; playlistId: string | null } {
  const tracks: MusicTrack[] = []
  const contents = (panel as unknown as { contents?: unknown[] }).contents ?? []
  for (const item of contents) {
    const track = upnextToTrack(item, trustLike)
    if (track) tracks.push(track)
    if (tracks.length >= 50) break
  }
  const playlistId = (panel as unknown as { playlist_id?: string }).playlist_id ?? null
  return { tracks, playlistId }
}

function asMenuItems(menu: unknown): Record<string, unknown>[] {
  if (!menu || typeof menu !== 'object') return []
  const items = (menu as { items?: unknown }).items
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : []
}

function findLikeToggle(
  item: unknown,
  videoId: string
): { like: MenuEndpoint | null; unlike: MenuEndpoint | null } {
  const result = { like: null as MenuEndpoint | null, unlike: null as MenuEndpoint | null }
  const kind = nodeType(item)
  const n = item as Record<string, unknown>
  const video =
    kind === 'PlaylistPanelVideoWrapper'
      ? ((n['primary'] as Record<string, unknown> | null) ?? null)
      : n
  if (!video || video['video_id'] !== videoId) return result
  const menus = [video['menu'], n['menu']]
  for (const menu of menus) {
    for (const entry of asMenuItems(menu)) {
      if (nodeType(entry) !== 'ToggleMenuServiceItem') continue
      const icon = entry['icon_type']
      if (icon !== 'FAVORITE' && icon !== 'UNFAVORITE') continue
      for (const key of ['default_endpoint', 'toggled_endpoint'] as const) {
        const ep = entry[key] as Partial<MenuEndpoint> & {
          payload?: { status?: string }
        }
        if (typeof ep?.call !== 'function') continue
        const status = ep.payload?.status
        if (status === 'LIKE' && !result.like) result.like = ep as MenuEndpoint
        else if (status === 'INDIFFERENT' && !result.unlike) result.unlike = ep as MenuEndpoint
      }
      if (result.like && result.unlike) return result
    }
  }
  return result
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
      if (tracks.length >= cap) break
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

async function decipherWith(
  yt: Awaited<ReturnType<typeof getInnertube>>,
  videoId: string
): Promise<DecipheredAudio> {
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

const PASSTHROUGH_HEADERS = ['content-type', 'content-length', 'content-range', 'accept-ranges']

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
        upstream = await fetch(entry.url, {
          headers: {
            'User-Agent': UPSTREAM_UA,
            Referer: 'https://music.youtube.com/',
            Origin: 'https://music.youtube.com/',
            Range: c.req.header('range') ?? 'bytes=0-',
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
        audioCache.delete(videoId)
        return c.json({ error: 'Upstream error' }, 502)
      }
      const headers = new Headers()
      for (const name of PASSTHROUGH_HEADERS) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name === 'content-type' ? 'Content-Type' : name, value)
      }
      if (!headers.get('Content-Type')) headers.set('Content-Type', entry.mimeType || 'audio/webm')
      headers.set('Accept-Ranges', 'bytes')
      headers.set('Access-Control-Allow-Origin', '*')
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

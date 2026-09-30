import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { badRequest, defineSchema, failed, optStr, reqObj } from '../validation.js'
import logger from '../../logger.js'
import {
  getInnertube,
  getAuthedInnertube,
  refreshAuthedInnertube,
  saveMusicCookie,
  getMusicAuthStatus,
  signOutMusic,
  isParserVariantError,
} from '../../lib/ytmusic.js'

interface MusicTrack {
  id: string
  title: string
  artists: string
  album?: string
  duration?: string
  thumbnails: { url: string; width?: number; height?: number }[]
  liked?: boolean | null
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

function cleanupMusicName(name: string): string {
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

function unauthorized(message: string): TRPCError {
  return new TRPCError({ code: 'UNAUTHORIZED', message })
}

export type MusicSearchInput = { q?: string }

const musicSearchInput = () =>
  defineSchema<MusicSearchInput, MusicSearchInput>((value) => {
    const obj = reqObj(value)
    const out: MusicSearchInput = {}
    const q = optStr(obj, 'q')
    if (q !== undefined) out.q = q
    return out
  })

export type MusicTrackInput = { id?: string }

const musicTrackInput = () =>
  defineSchema<MusicTrackInput, MusicTrackInput>((value) => {
    const obj = reqObj(value)
    const out: MusicTrackInput = {}
    const id = optStr(obj, 'id')
    if (id !== undefined) out.id = id
    return out
  })

export type MusicAuthStartInput = { cookie?: string }

const musicAuthStartInput = () =>
  defineSchema<MusicAuthStartInput, MusicAuthStartInput>((value) => {
    const obj = reqObj(value)
    const out: MusicAuthStartInput = {}
    const cookie = optStr(obj, 'cookie')
    if (cookie !== undefined) out.cookie = cookie
    return out
  })

export type MusicLikeInput = { id?: string; like?: boolean | string }

const musicLikeInput = () =>
  defineSchema<MusicLikeInput, MusicLikeInput>((value) => {
    const obj = reqObj(value)
    const out: MusicLikeInput = {}
    const id = optStr(obj, 'id')
    if (id !== undefined) out.id = id
    if (typeof obj.like === 'boolean' || typeof obj.like === 'string') out.like = obj.like
    return out
  })

function requireId(input: { id?: string }): string {
  const id = String(input.id || '').trim()
  if (!id) throw badRequest('id is required')
  return id
}

export const musicRouter = router({
  authStatus: protectedProcedure.query(() => {
    return getMusicAuthStatus()
  }),

  authStart: protectedProcedure.input(musicAuthStartInput()).mutation(async ({ input }) => {
    let cookie = String(input.cookie || '').trim()
    if (!cookie) throw badRequest('Cookie is required')
    cookie = cookie
      .replace(/^cookie\s*:\s*/i, '')
      .replace(/^["']+|["']+$/g, '')
      .trim()
    if (cookie.includes('…') || cookie.includes('...')) {
      throw badRequest(
        `Cookie looks truncated (${cookie.length} chars). In DevTools, right-click the Cookie header → Copy value (do not copy from the wrapped preview).`
      )
    }
    if (!cookie.includes('SID') && !cookie.includes('SAPISID')) {
      throw badRequest(
        'That does not look like a YouTube cookie at all. Copy the full Cookie request header from a "browse" call on music.youtube.com in DevTools → Network.'
      )
    }
    try {
      await saveMusicCookie(cookie)
      const yt = await getAuthedInnertube()
      if (yt) {
        try {
          const lib = await readLibrary(yt)
          return {
            success: true,
            tracks: lib.tracks.length,
            playlists: lib.playlists.length,
          }
        } catch {
          // ignore
        }
      }
      return { success: true, tracks: 0, playlists: 0 }
    } catch (err) {
      if (err instanceof TRPCError) throw err
      logger.error({ err }, '[music] cookie sign-in failed')
      throw unauthorized(
        'Cookie rejected by YouTube Music. Copy a fresh Cookie header from music.youtube.com.'
      )
    }
  }),

  signOut: protectedProcedure.mutation(async () => {
    try {
      await signOutMusic()
      return { success: true }
    } catch (err) {
      logger.error({ err }, '[music] sign-out failed')
      throw failed('Sign-out failed')
    }
  }),

  search: protectedProcedure.input(musicSearchInput()).query(async ({ ctx, input }) => {
    const q = String(input.q || '').trim()
    if (!q) return { tracks: [] as MusicTrack[] }
    const cacheKey = `music-search-${q.toLowerCase()}`
    const cached = ctx.apiCache.get<MusicTrack[]>(cacheKey)
    if (cached) return { tracks: cached }
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
      ctx.apiCache.set(cacheKey, tracks, 300)
      return { tracks }
    } catch (err) {
      logger.error({ err }, '[music] search failed')
      return { tracks: [] as MusicTrack[] }
    }
  }),

  track: protectedProcedure.input(musicTrackInput()).query(async ({ ctx, input }) => {
    const id = requireId(input)
    const cacheKey = `music-track-${id.toLowerCase()}`
    const cached = ctx.apiCache.get<MusicTrack>(cacheKey)
    if (cached) return { track: cached }
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
      if (!basic?.title) return { track: null as MusicTrack | null }
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
      ctx.apiCache.set(cacheKey, track, 300)
      return { track: track as MusicTrack | null }
    } catch (err) {
      logger.error({ err }, '[music] track lookup failed')
      return { track: null as MusicTrack | null }
    }
  }),

  playlist: protectedProcedure.input(musicTrackInput()).query(async ({ input }) => {
    const id = requireId(input)
    const yt = await getAuthedInnertube().catch(() => null)
    if (!yt) {
      throw unauthorized('MUSIC_AUTH_REQUIRED')
    }
    try {
      return { tracks: await fetchPlaylistTracks(yt, id) }
    } catch (err) {
      logger.warn({ err }, '[music] playlist failed, retrying with a fresh saved-cookie session')
      const fresh = await refreshAuthedInnertube()
      if (!fresh) return { tracks: [] as MusicTrack[] }
      try {
        return { tracks: await fetchPlaylistTracks(fresh, id) }
      } catch (retryErr) {
        logger.warn({ err: retryErr }, '[music] playlist retry failed, returning empty')
        return { tracks: [] as MusicTrack[] }
      }
    }
  }),

  library: protectedProcedure.query(async () => {
    const yt = await getAuthedInnertube().catch(() => null)
    if (!yt) {
      throw unauthorized('MUSIC_AUTH_REQUIRED')
    }
    try {
      const first = await readLibrary(yt)
      if (first.tracks.length > 0 || first.playlists.length > 0) return first
      logger.warn('[music] library came back empty, retrying with a fresh saved-cookie session')
    } catch (err) {
      logger.warn({ err }, '[music] library failed, retrying with a fresh saved-cookie session')
    }
    const fresh = await refreshAuthedInnertube()
    if (!fresh) return { tracks: [] as MusicTrack[], playlists: [] as MusicPlaylist[] }
    try {
      return await readLibrary(fresh)
    } catch (err) {
      logger.warn({ err }, '[music] library retry failed, returning empty')
      return { tracks: [] as MusicTrack[], playlists: [] as MusicPlaylist[] }
    }
  }),

  home: protectedProcedure.query(async () => {
    try {
      const yt = await getInnertube()
      const feed = await yt.music.getHomeFeed()
      return JSON.parse(JSON.stringify(feed)) as unknown
    } catch (err) {
      logger.error({ err }, '[music] home feed failed')
      return { contents: [] as unknown[] }
    }
  }),

  upnext: protectedProcedure.input(musicTrackInput()).query(async ({ ctx, input }) => {
    const id = requireId(input)
    const authed = await getAuthedInnertube().catch(() => null)
    if (!authed) {
      const cacheKey = `music-upnext-${id.toLowerCase()}`
      const cached = ctx.apiCache.get<{ tracks: MusicTrack[]; playlistId: string | null }>(cacheKey)
      if (cached) return cached
      try {
        const yt = await getInnertube()
        const payload = parseUpnext(await yt.music.getUpNext(id), false)
        ctx.apiCache.set(cacheKey, payload, 300)
        return payload
      } catch (err) {
        logger.error({ err }, '[music] upnext failed')
        return { tracks: [] as MusicTrack[], playlistId: null as string | null }
      }
    }
    try {
      return parseUpnext(await authed.music.getUpNext(id), true)
    } catch (err) {
      logger.warn(
        { err },
        '[music] authed upnext failed, retrying with a fresh saved-cookie session'
      )
    }
    const fresh = await refreshAuthedInnertube()
    if (fresh) {
      try {
        return parseUpnext(await fresh.music.getUpNext(id), true)
      } catch (retryErr) {
        logger.warn({ err: retryErr }, '[music] upnext retry failed, falling back to public')
      }
    }
    try {
      const yt = await getInnertube()
      return parseUpnext(await yt.music.getUpNext(id), false)
    } catch (err) {
      logger.error({ err }, '[music] upnext failed')
      return { tracks: [] as MusicTrack[], playlistId: null as string | null }
    }
  }),

  likes: protectedProcedure.query(async ({ ctx }) => {
    const yt = await getAuthedInnertube().catch(() => null)
    if (!yt) {
      throw unauthorized('MUSIC_AUTH_REQUIRED')
    }
    const cacheKey = 'music-liked-ids'
    const cached = ctx.apiCache.get<string[]>(cacheKey)
    if (cached) return { likedIds: cached }
    const fetchLikedIds = async (
      session: Awaited<ReturnType<typeof getAuthedInnertube>> & {}
    ): Promise<string[]> => {
      const tracks = await fetchPlaylistTracks(session, 'LM', 500)
      return tracks.map((t) => t.id)
    }
    try {
      const likedIds = await fetchLikedIds(yt)
      ctx.apiCache.set(cacheKey, likedIds, 120)
      return { likedIds }
    } catch (err) {
      logger.warn({ err }, '[music] liked ids failed, retrying with a fresh saved-cookie session')
      const fresh = await refreshAuthedInnertube()
      if (!fresh) return { likedIds: [] as string[] }
      try {
        const likedIds = await fetchLikedIds(fresh)
        ctx.apiCache.set(cacheKey, likedIds, 120)
        return { likedIds }
      } catch (retryErr) {
        logger.warn({ err: retryErr }, '[music] liked ids retry failed, returning empty')
        return { likedIds: [] as string[] }
      }
    }
  }),

  like: protectedProcedure.input(musicLikeInput()).mutation(async ({ ctx, input }) => {
    const id = String(input.id || '').trim()
    const like = input.like === true || input.like === 'true'
    if (!id) throw badRequest('id is required')
    const yt = await getAuthedInnertube().catch(() => null)
    if (!yt) {
      throw unauthorized('MUSIC_AUTH_REQUIRED')
    }
    const attempt = async (
      session: Awaited<ReturnType<typeof getAuthedInnertube>> & {}
    ): Promise<void> => {
      const actions =
        (session as unknown as { actions?: unknown; session?: { actions?: unknown } }).actions ??
        (session as unknown as { session?: { actions?: unknown } }).session?.actions
      if (!actions) throw new Error('Actions unavailable')
      const panel = await session.music.getUpNext(id)
      const contents = (panel as unknown as { contents?: unknown[] }).contents ?? []
      let endpoint: MenuEndpoint | null = null
      for (const item of contents) {
        const toggle = findLikeToggle(item, id)
        endpoint = like ? toggle.like : toggle.unlike
        if (endpoint) break
      }
      if (!endpoint) throw new Error('Like toggle not found for track')
      await endpoint.call(actions)
    }
    try {
      await attempt(yt)
    } catch (err) {
      logger.warn({ err }, '[music] rate failed, retrying with a fresh saved-cookie session')
      const fresh = await refreshAuthedInnertube()
      if (!fresh) throw failed('Like action failed')
      try {
        await attempt(fresh)
      } catch (retryErr) {
        logger.error({ err: retryErr }, '[music] rate retry failed')
        throw failed('Like action failed')
      }
    }
    ctx.apiCache.delete('music-liked-ids')
    logger.info(`[music] rate id=${id} liked=${like} via=toggle`)
    return { success: true, liked: like }
  }),
})

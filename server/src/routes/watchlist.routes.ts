import { Router } from 'express'
import { WatchlistController } from '../controllers/watchlist.controller'
import { discordRPCService } from '../discord-rpc'
import { DatabaseWrapper } from '../db'
import { pickBestMatch } from '../providers/title-matching'

const dlsitePosterCache = new Map<string, { url: string; ts: number }>()
const mangadexCoverCache = new Map<string, { url: string | null; ts: number }>()

async function getMangadexCover(title: string): Promise<string | null> {
  const key = title.trim().toLowerCase()
  if (!key) return null
  const cached = mangadexCoverCache.get(key)
  if (cached && Date.now() - cached.ts < 3600_000) return cached.url
  try {
    const params = new URLSearchParams({
      title: title.trim(),
      limit: '5',
      'includes[]': 'cover_art',
      'order[relevance]': 'desc',
    })
    for (const r of ['safe', 'suggestive', 'erotica', 'pornographic']) {
      params.append('contentRating[]', r)
    }
    const res = await fetch(`https://api.mangadex.org/manga?${params.toString()}`, {
      headers: { 'User-Agent': 'Dango/3.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      data?: Array<{
        id: string
        attributes?: { title?: Record<string, string>; altTitles?: Record<string, string>[] }
        relationships?: Array<{ type: string; attributes?: { fileName?: string } }>
      }>
    }
    const candidates: Array<{ title: string; cover: string }> = []
    for (const m of data.data || []) {
      const fileName = m.relationships?.find((r) => r.type === 'cover_art')?.attributes?.fileName
      if (!fileName) continue
      const cover = `https://uploads.mangadex.org/covers/${m.id}/${fileName}.256.jpg`
      const main = m.attributes?.title
      const mainTitle = main?.en || main?.['ja-ro'] || Object.values(main || {})[0]
      if (mainTitle) candidates.push({ title: mainTitle, cover })
      for (const alt of m.attributes?.altTitles || []) {
        const t = Object.values(alt)[0]
        if (t) candidates.push({ title: t, cover })
      }
    }
    const match = pickBestMatch(candidates, [title])
    const url = match ? match.item.cover : null
    mangadexCoverCache.set(key, { url, ts: Date.now() })
    return url
  } catch {
    return null
  }
}

async function getDlsitePoster(rjCode: string): Promise<string | null> {
  const key = String(rjCode).trim().toUpperCase()
  if (!/^RJ\d{5,}$/.test(key)) return null
  const cached = dlsitePosterCache.get(key)
  if (cached && Date.now() - cached.ts < 3600_000) return cached.url
  try {
    const res = await fetch(`https://www.dlsite.com/maniax/product/info/ajax?product_id=${key}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const raw = (await res.json()) as unknown
    const data = raw as Record<string, unknown>
    const entryRaw = (data[key] ?? data) as unknown
    const entry = entryRaw as { work_image?: unknown }
    const img: string | undefined =
      typeof entry?.work_image === 'string' ? entry.work_image : undefined
    if (!img) return null
    const url = img.startsWith('//') ? `https:${img}` : img
    dlsitePosterCache.set(key, { url, ts: Date.now() })
    return url
  } catch {
    return null
  }
}

export function createWatchlistRouter(getDb: () => DatabaseWrapper): {
  router: Router
  stopDiscovery: () => void
} {
  const router = Router()
  const controller = new WatchlistController()

  controller.startNotificationDiscovery(getDb)

  router.get('/continue-watching/all', controller.getAllContinueWatching)
  router.get('/continue-watching/this-week', controller.getThisWeekSchedule)
  router.post('/continue-watching/remove', controller.removeContinueWatching)
  router.post('/continue-watching/remove-many', controller.batchRemoveContinueWatching)
  router.get('/continue-watching/adult-count', controller.getAdultContinueWatchingCount)
  router.post('/continue-watching/purge-adult', controller.purgeAdultContinueWatching)
  router.post('/update-progress', controller.updateProgress)
  router.get('/watchlist', controller.getWatchlist)
  router.get('/watchlist/check/:showId', controller.checkWatchlist)
  router.post('/watchlist/add', controller.addToWatchlist)
  router.post('/watchlist/remove', controller.removeFromWatchlist)
  router.post('/watchlist/remove-many', controller.batchRemoveFromWatchlist)
  router.post('/watchlist/status', controller.updateWatchlistStatus)
  router.post('/watchlist/batch-status', controller.batchUpdateWatchlistStatus)
  router.get('/queue', controller.getQueue)
  router.get('/queue/suggested/:showId', controller.getSuggestedQueueEpisode)
  router.get('/queue/remaining/:showId', controller.getQueueRemainingEpisodes)
  router.post('/queue/add', controller.addToQueue)
  router.post('/queue/batch', controller.addToQueueBatch)
  router.post('/queue/remove', controller.removeFromQueue)
  router.post('/queue/remove-many', controller.removeFromQueueBatch)
  router.post('/queue/clear', controller.clearQueue)
  router.post('/queue/reorder', controller.reorderQueue)
  router.get('/episode-progress/:showId/:episodeNumber', controller.getEpisodeProgress)
  router.get('/watched-episodes/:showId', controller.getWatchedEpisodes)
  router.get('/notifications', controller.getNotifications)
  router.post('/notifications/dismiss', controller.dismissNotification)
  router.post('/notifications/clear-all', controller.clearAllNotifications)
  router.get('/discovery/status', (req, res) => {
    res.json(controller.getDiscoveryStatus())
  })
  router.post('/discovery/nudge', (req, res) => {
    const started = controller.triggerDiscovery?.(false) ?? false
    res.json({ success: true, started, ...controller.getDiscoveryStatus() })
  })
  router.post('/discovery/refresh', (req, res) => {
    const started = controller.triggerDiscovery?.(true) ?? false
    res.json({ success: true, started, ...controller.getDiscoveryStatus() })
  })

  router.post('/discord/clear', (req, res) => {
    const { sessionId } = req.body
    if (!discordRPCService.isServiceEnabled) {
      return res.json({ success: true })
    }
    discordRPCService.clearPresence(sessionId)
    res.json({ success: true })
  })

  router.post('/discord/heartbeat', (req, res) => {
    const { sessionId, bye } = req.body ?? {}
    if (typeof sessionId !== 'string' || !discordRPCService.isServiceEnabled) {
      return res.json({ success: true })
    }
    if (bye) {
      discordRPCService.removeHeartbeat(sessionId)
    } else {
      discordRPCService.heartbeat(sessionId)
    }
    res.json({ success: true })
  })

  router.post('/discord/status', (req, res) => {
    const { page } = req.body
    if (typeof page !== 'string' || !discordRPCService.isServiceEnabled) {
      return res.json({ success: true })
    }
    discordRPCService.setIdleStatus(page)
    res.json({ success: true })
  })

  router.post('/discord/asmr', async (req, res) => {
    const {
      title,
      trackLabel,
      isPlaying,
      thumbnail,
      thumbnails,
      currentTime,
      duration,
      isAdult,
      sessionId,
      rjCode,
    } = req.body ?? {}
    if (!discordRPCService.isServiceEnabled) return res.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(thumbnail || '')
    const thumbs = Array.isArray(thumbnails) ? thumbnails.map(String).filter(Boolean) : undefined
    // ASMR thumbs from japaneseasmr/weeabo0 require Referer and will 403 on Discord's fetch.
    // Try DLSite's direct img.dlsite.jp poster which is public (no Referer needed).
    const needsDlsite =
      !thumb || thumb.includes('weeabo0.xyz') || thumb.includes('japaneseasmr.com')
    if (needsDlsite && rjCode) {
      const dlsiteThumb = await getDlsitePoster(String(rjCode))
      if (dlsiteThumb) thumb = dlsiteThumb
    }
    // fallback to logo if still proxied/weeabo0 (Discord can't fetch localhost or 403)
    if (thumb.includes('/api/image-proxy') || thumb.includes('weeabo0.xyz')) thumb = ''
    discordRPCService.updatePresence({
      title: String(title || 'ASMR').slice(0, 128),
      episode: String(trackLabel || '').slice(0, 64),
      totalEpisodes: '',
      currentTime: Number(currentTime) || 0,
      duration: Number(duration) || 0,
      thumbnail: thumb,
      thumbnails: thumbs,
      isPlaying: !!isPlaying,
      providerName: 'ASMR',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: !!isAdult,
    })
    res.json({ success: true })
  })

  router.post('/discord/radio', (req, res) => {
    const { title, stationLabel, isPlaying, thumbnail, currentTime, sessionId } = req.body ?? {}
    if (!discordRPCService.isServiceEnabled) return res.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(thumbnail || '')
    if (thumb.includes('/api/image-proxy')) {
      const match = thumb.match(/url=([^&]+)/)
      if (match) thumb = decodeURIComponent(match[1])
    }
    if (thumb && !thumb.startsWith('https://')) thumb = ''
    if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) thumb = ''
    discordRPCService.updatePresence({
      title: String(title || 'Radio').slice(0, 128),
      episode: String(stationLabel || '').slice(0, 64),
      totalEpisodes: '',
      stateLine: String(stationLabel || 'Radio').slice(0, 64),
      currentTime: Number(currentTime) || 0,
      duration: 0,
      thumbnail: thumb,
      isPlaying: !!isPlaying,
      providerName: 'Radio',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: false,
    })
    res.json({ success: true })
  })

  router.post('/discord/manga', async (req, res) => {
    const { title, chapterLabel, isPlaying, thumbnail, thumbnails, sessionId, isAdult } =
      req.body ?? {}
    if (!discordRPCService.isServiceEnabled) return res.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    const cleanThumb = (value: unknown): string => {
      let thumb = String(value || '')
      if (thumb.includes('/api/proxy') || thumb.includes('/api/image-proxy')) {
        const match = thumb.match(/url=([^&]+)/)
        if (match) {
          try {
            thumb = decodeURIComponent(match[1])
          } catch {
            return ''
          }
        }
      }
      if (!thumb.startsWith('https://')) return ''
      if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) return ''
      if (thumb.includes('readdetectiveconan.com')) return ''
      return thumb
    }
    let thumb = cleanThumb(thumbnail)
    let thumbs = Array.isArray(thumbnails)
      ? (thumbnails.map(cleanThumb).filter(Boolean) as string[])
      : undefined
    if (!thumb && title) {
      const fallback = await getMangadexCover(String(title))
      if (fallback) {
        thumb = fallback
        thumbs = [fallback, ...(thumbs || [])]
      }
    }
    discordRPCService.updatePresence({
      title: String(title || 'Manga').slice(0, 128),
      episode: String(chapterLabel || '').slice(0, 64),
      totalEpisodes: '',
      stateLine: (chapterLabel ? `Reading ${chapterLabel}` : 'Reading').slice(0, 64),
      currentTime: 0,
      duration: 0,
      thumbnail: thumb,
      thumbnails: thumbs,
      isPlaying: isPlaying !== false,
      providerName: 'Manga',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: isAdult === true,
    })
    res.json({ success: true })
  })

  router.post('/discord/tv', (req, res) => {
    const { title, episodeLabel, isPlaying, thumbnail, currentTime, duration, sessionId, isAdult } =
      req.body ?? {}
    if (!discordRPCService.isServiceEnabled) return res.json({ success: true })
    if (typeof sessionId === 'string') discordRPCService.heartbeat(sessionId)
    let thumb = String(thumbnail || '')
    if (thumb.includes('/api/image-proxy')) {
      const match = thumb.match(/url=([^&]+)/)
      if (match) thumb = decodeURIComponent(match[1])
    }
    if (thumb.includes('localhost') || thumb.includes('127.0.0.1')) thumb = ''
    discordRPCService.updatePresence({
      title: String(title || 'TV').slice(0, 128),
      episode: String(episodeLabel || '').slice(0, 64),
      totalEpisodes: '',
      stateLine: String(episodeLabel || 'Movie').slice(0, 64),
      currentTime: Number(currentTime) || 0,
      duration: Number(duration) || 0,
      thumbnail: thumb,
      isPlaying: !!isPlaying,
      providerName: 'TV',
      sessionId: typeof sessionId === 'string' ? sessionId : undefined,
      isAdult: isAdult === true,
    })
    res.json({ success: true })
  })

  return {
    router,
    stopDiscovery: () => controller.stopNotificationDiscovery(),
  }
}

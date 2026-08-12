import { Show } from '../providers/provider.interface'
import logger from '../logger'

const SUB_SCHEDULE_URL =
  'https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/sub-schedule.json'
const SUB_FEED_URL =
  'https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/sub-episode-feed.json'
const HENTAI_FEED_URL =
  'https://raw.githubusercontent.com/RockinChaos/AniSchedule/master/raw/hentai-episode-feed.json'

const SCHEDULE_TTL_MS = 15 * 60 * 1000
const FEED_TTL_MS = 10 * 60 * 1000
const FETCH_TIMEOUT_MS = 10000

export interface AniScheduleNode {
  episode: number
  airingAt: number
}

export interface AniScheduleShow {
  id: number
  idMal: number | null
  title?: { romaji?: string; english?: string; native?: string }
  format?: string
  genres?: string[]
  duration?: number | null
  seasonYear?: number | null
  coverImage?: { extraLarge?: string; medium?: string; color?: string }
  bannerImage?: string | null
  isAdult?: boolean
  airingSchedule: { nodes: AniScheduleNode[] }
}

export interface AniScheduleFeedEntry {
  id: number
  idMal: number | null
  format?: string
  duration?: number | null
  episode: { aired: number; airedAt: string; addedAt: string }
}

interface CacheEntry<T> {
  data: T | null
  expiry: number
}

const scheduleCache = { data: null as AniScheduleShow[] | null, expiry: 0 }
const subFeedCache = { data: null as AniScheduleFeedEntry[] | null, expiry: 0 }
const hentaiFeedCache = { data: null as AniScheduleFeedEntry[] | null, expiry: 0 }
const inFlight = new Map<string, Promise<unknown>>()

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ani-web' },
    })
    if (!response.ok) {
      throw new Error(`AniSchedule fetch failed with status ${response.status}`)
    }
    const json = (await response.json()) as T
    if (Array.isArray(json) && json.length === 0) {
      throw new Error('AniSchedule returned an empty payload')
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

function fetchCached<T>(key: string, url: string, cache: CacheEntry<T>, ttlMs: number): Promise<T> {
  if (cache.data !== null && Date.now() < cache.expiry) {
    return Promise.resolve(cache.data)
  }
  const existing = inFlight.get(key)
  if (existing) return existing as Promise<T>

  const request = fetchJson<T>(url)
    .then((data) => {
      cache.data = data
      cache.expiry = Date.now() + ttlMs
      return data
    })
    .catch((err) => {
      inFlight.delete(key)
      throw err
    })
  inFlight.set(key, request)
  return request
}

export function getAniScheduleShows(): Promise<AniScheduleShow[]> {
  return fetchCached('anischedule:shows', SUB_SCHEDULE_URL, scheduleCache, SCHEDULE_TTL_MS)
}

export function getAniScheduleSubFeed(): Promise<AniScheduleFeedEntry[]> {
  return fetchCached('anischedule:subfeed', SUB_FEED_URL, subFeedCache, FEED_TTL_MS)
}

export function getAniScheduleHentaiFeed(): Promise<AniScheduleFeedEntry[]> {
  return fetchCached('anischedule:hentaifeed', HENTAI_FEED_URL, hentaiFeedCache, FEED_TTL_MS)
}

export function withScheduleFields(show: Show, episode: number, airingAt: number): Show {
  const now = Math.floor(Date.now() / 1000)
  return {
    ...show,
    episodeNumber: episode,
    aired: airingAt <= now,
    nextAiring: { episode, timeUntilAiring: airingAt - now },
    nextEpisodeAirDate: new Date(airingAt * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    airTime: new Date(airingAt * 1000).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }),
  }
}

function fromAniScheduleShow(s: AniScheduleShow): Show {
  const title = s.title
  const name = title?.romaji || title?.english || title?.native || 'Unknown'
  return {
    _id: s.id.toString(),
    id: s.id.toString(),
    anilistId: s.id,
    name,
    englishName: title?.english,
    nativeName: title?.native,
    names: {
      romaji: title?.romaji,
      english: title?.english,
      native: title?.native,
    },
    thumbnail: s.coverImage?.extraLarge || s.coverImage?.medium || '',
    bannerImage: s.bannerImage || undefined,
    genres: s.genres?.map((g) => ({ name: g })),
    type: s.format,
    year: s.seasonYear ?? undefined,
    isAdult: s.isAdult,
  }
}

export interface AniScheduleDayEntry {
  show: Show | null
  episode: number
  airingAt: number
  aired: boolean
}

export interface AniScheduleDayResult {
  entries: AniScheduleDayEntry[]
  missingMeta: { id: number; episode: number; airingAt: number; format?: string }[]
}

export async function getScheduleFromAniSchedule(
  date: Date,
  format?: string,
  adult = false
): Promise<AniScheduleDayResult> {
  const dayStart = Math.floor(date.getTime() / 1000)
  const dayEnd = dayStart + 86400
  const now = Math.floor(Date.now() / 1000)
  const formatFilter = format && format !== 'ALL' ? format : undefined

  const schedulePromise = getAniScheduleShows()
  const subFeedPromise = getAniScheduleSubFeed()
  const hentaiFeedPromise = adult ? getAniScheduleHentaiFeed() : Promise.resolve([])

  const [shows, subFeed, hentaiFeed] = await Promise.all([
    schedulePromise,
    subFeedPromise,
    hentaiFeedPromise,
  ])

  const showById = new Map<number, AniScheduleShow>()
  for (const show of shows) {
    showById.set(show.id, show)
  }

  const matchesAdult = (show: AniScheduleShow): boolean => (adult ? !!show.isAdult : !show.isAdult)

  const bestByShow = new Map<
    number,
    { show: Show; episode: number; airingAt: number; aired: boolean }
  >()
  const missingMeta = new Map<
    number,
    { id: number; episode: number; airingAt: number; format?: string }
  >()

  const consider = (id: number, episode: number, airingAt: number, entryFormat?: string) => {
    const show = showById.get(id)
    if (show) {
      if (formatFilter && show.format !== formatFilter) return
      if (!matchesAdult(show)) return
      const key = show.idMal ?? show.id
      const current = bestByShow.get(key)
      if (!current || airingAt > current.airingAt) {
        bestByShow.set(key, {
          show: fromAniScheduleShow(show),
          episode,
          airingAt,
          aired: airingAt <= now,
        })
      }
      return
    }
    if (adult) return
    if (formatFilter && entryFormat && entryFormat !== formatFilter) return
    const existing = missingMeta.get(id)
    if (!existing || airingAt > existing.airingAt) {
      missingMeta.set(id, { id, episode, airingAt, format: entryFormat })
    }
  }

  for (const show of shows) {
    for (const node of show.airingSchedule.nodes) {
      if (node.airingAt >= dayStart && node.airingAt < dayEnd) {
        consider(show.id, node.episode, node.airingAt)
      }
    }
  }

  const feed = adult ? [...subFeed, ...hentaiFeed] : subFeed
  for (const entry of feed) {
    const airedAt = Date.parse(entry.episode.airedAt) / 1000
    if (airedAt >= dayStart && airedAt < dayEnd) {
      consider(entry.id, entry.episode.aired, airedAt, entry.format)
    }
  }

  const entries: AniScheduleDayEntry[] = Array.from(bestByShow.entries())
    .map(([, value]) => value)
    .sort((a, b) => a.airingAt - b.airingAt)

  return {
    entries,
    missingMeta: Array.from(missingMeta.values()),
  }
}

export async function getAiredEpisodesFromAniScheduleFeed(
  ids: number[],
  startEpoch: number,
  endEpoch: number
): Promise<{ mediaId: number; episode: number; airingAt: number }[]> {
  const idSet = new Set(ids)
  const [subFeed, hentaiFeed] = await Promise.all([
    getAniScheduleSubFeed(),
    getAniScheduleHentaiFeed(),
  ])

  const results: { mediaId: number; episode: number; airingAt: number }[] = []
  for (const entry of [...subFeed, ...hentaiFeed]) {
    if (!idSet.has(entry.id)) continue
    const airedAt = Date.parse(entry.episode.airedAt) / 1000
    if (airedAt >= startEpoch && airedAt <= endEpoch) {
      results.push({ mediaId: entry.id, episode: entry.episode.aired, airingAt: airedAt })
    }
  }
  return results
}

export function isAniScheduleAvailable(): boolean {
  return !!scheduleCache.data || !!subFeedCache.data
}

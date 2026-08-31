import { Show } from '../providers/provider.interface'
import logger from '../logger'
import { findTmdbDefaultBackdrop } from './tmdb'
import {
  getScheduleFromAniSchedule,
  getAiredEpisodesFromAniScheduleFeed,
  withScheduleFields,
} from './anischedule'
import {
  kitsuSearchAnime,
  kitsuTrending,
  kitsuSeasonal,
  kitsuMetaByAnilistId,
  kitsuMetaByMalId,
  kitsuEpisodes,
} from './kitsu'

const ANILIST_API = 'https://graphql.anilist.co'

let anilistDownUntil = 0
let anilistRateLimited = false
let anilistWasDownAtBoot = false
const DOWN_COOLDOWN_MS = 10 * 60 * 1000
const NETWORK_COOLDOWN_MS = 2 * 60 * 1000
const RATE_LIMIT_FALLBACK_THRESHOLD_MS = 30 * 1000

export function anilistUnavailable(): boolean {
  if (anilistDownUntil > Date.now()) return true
  if (anilistRateLimited && anilistCooldownUntil - Date.now() > RATE_LIMIT_FALLBACK_THRESHOLD_MS) {
    return true
  }
  return false
}

export function anilistIsDown(): boolean {
  return anilistDownUntil > Date.now()
}

export function isAnilistRateLimited(): boolean {
  return anilistRateLimited && anilistCooldownUntil > Date.now()
}

export function markAnilistDownAtBoot(): void {
  anilistWasDownAtBoot = anilistUnavailable()
}

export async function checkAnilistStatus(): Promise<boolean> {
  const available = await performAnilistStatusCheck()
  if (!available) {
    anilistWasDownAtBoot = true
  }
  return available
}

async function performAnilistStatusCheck(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    const response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query: 'query { __typename }' }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const available = response.ok
    if (!available) {
      anilistDownUntil = Date.now() + DOWN_COOLDOWN_MS
      anilistRateLimited = false
    } else {
      anilistDownUntil = 0
      anilistRateLimited = false
    }
    return available
  } catch {
    anilistDownUntil = Date.now() + DOWN_COOLDOWN_MS
    anilistRateLimited = false
    return false
  }
}

export function wasAnilistDownAtBoot(): boolean {
  return anilistWasDownAtBoot
}

const BURST_CAPACITY = 8
const DEFAULT_REFILL_INTERVAL_MS = 1500
let refillIntervalMs = DEFAULT_REFILL_INTERVAL_MS
let tokens = BURST_CAPACITY
let lastRefill = Date.now()
let anilistCooldownUntil = 0

function refillTokens(): void {
  const now = Date.now()
  if (now < lastRefill) return
  const elapsed = now - lastRefill
  const refillAmount = Math.floor(elapsed / refillIntervalMs)
  if (refillAmount > 0) {
    tokens = Math.min(BURST_CAPACITY, tokens + refillAmount)
    lastRefill += refillAmount * refillIntervalMs
  }
}

export function applyRateLimitHeaders(headers: Headers): void {
  const readHeader = (name: string): number | null => {
    const raw = headers.get(name)
    if (raw === null || raw === '') return null
    const value = Number.parseInt(raw as string, 10)
    return Number.isFinite(value) && value >= 0 ? value : null
  }

  const limit = readHeader('X-RateLimit-Limit')
  const remaining = readHeader('X-RateLimit-Remaining')

  if (limit !== null && limit > 0) {
    const reserve = Math.max(1, Math.round(limit * 0.2))
    const safeRate = Math.max(1, limit - reserve)
    refillIntervalMs = Math.max(300, Math.min(60000, Math.round(60000 / safeRate)))
  }

  if (remaining !== null && remaining <= 2) {
    const reset = readHeader('X-RateLimit-Reset')
    if (reset !== null) {
      const resetMs = reset * 1000
      if (resetMs > Date.now()) {
        anilistCooldownUntil = Math.max(anilistCooldownUntil, resetMs)
      }
    }
  }
}

const anilistMemoryCache = new Map<string, { data: unknown; expiry: number }>()
const ANILIST_MEMORY_TTL = 60 * 60 * 1000
const airedEpisodesCache = new Map<string, { data: unknown; expiry: number }>()
const AIRED_EPISODES_TTL = 60 * 60 * 1000
type AnilistResponse<T> = { data: T | null; errors?: { message: string }[] } | null
const inFlightAnilistRequests = new Map<string, Promise<AnilistResponse<unknown>>>()

export interface AnilistMedia {
  id: number
  idMal: number | null
  title?: { romaji?: string; english?: string; native?: string }
  bannerImage?: string | null
  coverImage?: { extraLarge?: string; large?: string; medium?: string; color?: string }
  description?: string | null
  genres?: string[]
  averageScore?: number | null
  meanScore?: number | null
  format?: string
  status?: string
  episodes?: number | null
  duration?: number | null
  season?: string
  seasonYear?: number | null
  startDate?: { year?: number; month?: number; day?: number }
  endDate?: { year?: number; month?: number; day?: number }
  countryOfOrigin?: string
  isAdult?: boolean
  synonyms?: string[]
  trending?: number
  popularity?: number
  favourites?: number
  tags?: { id: number; name: string; rank: number; isMediaSpoiler: boolean }[]
  studios?: { nodes?: { id: number; name: string }[] }
  nextAiringEpisode?: { episode: number; timeUntilAiring: number; airingAt: number } | null
  trailer?: { id: string; site: string; thumbnail?: string } | null
  rankings?: {
    id: number
    rank: number
    type: string
    format: string
    allTime: boolean
    context: string
  }[]
  siteUrl?: string
}

export type AnilistSort =
  | 'TRENDING_DESC'
  | 'POPULARITY_DESC'
  | 'SCORE_DESC'
  | 'FAVOURITES_DESC'
  | 'ID_DESC'
  | 'START_DATE_DESC'
  | 'END_DATE_DESC'
  | 'EPISODES_DESC'
  | 'UPDATED_AT_DESC'

export function mediaFields(): string {
  return `
    id
    idMal
    title { romaji english native }
    bannerImage
    coverImage { extraLarge large medium color }
    description
    genres
    averageScore
    meanScore
    format
    status
    episodes
    duration
    season
    seasonYear
    startDate { year month day }
    endDate { year month day }
    countryOfOrigin
    isAdult
    synonyms
    trending
    popularity
    favourites
    tags { id name rank isMediaSpoiler }
    studios(isMain: true) { nodes { id name } }
    nextAiringEpisode { episode timeUntilAiring airingAt }
    trailer { id site thumbnail }
    rankings { id rank type format allTime context }
    siteUrl
  `
}

export function mediaFieldsLight(): string {
  return `
    id
    title { romaji english native }
    coverImage { extraLarge large }
    status
    averageScore
    episodes
    seasonYear
    season
    genres
    isAdult
    format
    nextAiringEpisode { episode }
  `
}

export interface BatchedHomeData {
  trending: Show[]
  seasonal: Show[]
  spotlight: Show[]
}

export async function getBatchedHomeData(format?: string): Promise<BatchedHomeData> {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const currentSeason =
    month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL'

  const formatVar = format && format !== 'ALL' ? format.toUpperCase() : undefined
  const formatFilter = formatVar ? `format: $seasonFormat,` : ''

  const query = `
    query ($season: MediaSeason, $seasonYear: Int, $seasonFormat: MediaFormat) {
      trending: Page(perPage: 20) {
        media(sort: TRENDING_DESC, type: ANIME, isAdult: false, status: RELEASING) {
          ${mediaFieldsLight()}
        }
      }
      seasonal: Page(perPage: 14) {
        media(season: $season, seasonYear: $seasonYear, type: ANIME, isAdult: false, ${formatFilter} sort: [POPULARITY_DESC, SCORE_DESC]) {
          ${mediaFieldsLight()}
        }
      }
      spotlight: Page(perPage: 20) {
        media(sort: TRENDING_DESC, type: ANIME, isAdult: false) {
          ${mediaFields()}
        }
      }
    }
  `

  const result = await anilistRequest<{
    trending?: { media?: AnilistMedia[] }
    seasonal?: { media?: AnilistMedia[] }
    spotlight?: { media?: AnilistMedia[] }
  }>(query, { season: currentSeason, seasonYear: year, seasonFormat: formatVar })

  if (!result?.data) {
    return { trending: [], seasonal: [], spotlight: [] }
  }

  return {
    trending: (result.data.trending?.media ?? []).map(fromAnilistMedia),
    seasonal: (result.data.seasonal?.media ?? []).map(fromAnilistMedia),
    spotlight: (result.data.spotlight?.media ?? []).map(fromAnilistMedia),
  }
}

function getAnilistCacheKey(query: string, variables?: Record<string, unknown>): string {
  return `${query}:${JSON.stringify(variables || {})}`
}

function getCachedAnilist<T>(key: string): T | null {
  const entry = anilistMemoryCache.get(key)
  if (entry && Date.now() < entry.expiry) return entry.data as T
  anilistMemoryCache.delete(key)
  return null
}

export function setCachedAnilist(key: string, data: unknown): void {
  anilistMemoryCache.set(key, { data, expiry: Date.now() + ANILIST_MEMORY_TTL })
}

function getCachedAiredEpisodes(
  key: string
): { mediaId: number; episode: number; airingAt: number }[] | null {
  const entry = airedEpisodesCache.get(key)
  if (entry && Date.now() < entry.expiry)
    return entry.data as { mediaId: number; episode: number; airingAt: number }[]
  airedEpisodesCache.delete(key)
  return null
}

function setCachedAiredEpisodes(key: string, data: unknown): void {
  airedEpisodesCache.set(key, { data, expiry: Date.now() + AIRED_EPISODES_TTL })
}

export async function waitForAnilistSlot(): Promise<void> {
  while (true) {
    const now = Date.now()

    if (now < anilistCooldownUntil) {
      await new Promise((resolve) => setTimeout(resolve, anilistCooldownUntil - now))
      continue
    }

    refillTokens()

    if (tokens >= 1) {
      tokens -= 1
      return
    }

    await new Promise((resolve) => setTimeout(resolve, refillIntervalMs))
  }
}

async function performAnilistRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  retryCount = 0
): Promise<AnilistResponse<T>> {
  await waitForAnilistSlot()

  try {
    const response = await fetch(ANILIST_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    })

    applyRateLimitHeaders(response.headers)

    if (response.status === 429) {
      anilistRateLimited = true
      if (retryCount >= 5) {
        return { data: null, errors: [{ message: 'AniList rate limited' }] }
      }
      const retryAfterHeader = Number.parseInt(response.headers.get('Retry-After') || '', 10)
      const retryAfter =
        Number.isFinite(retryAfterHeader) && retryAfterHeader >= 0 ? retryAfterHeader : 5
      const delay = Math.min(retryAfter * 1000, 60000)
      anilistCooldownUntil = Math.max(anilistCooldownUntil, Date.now() + delay)
      refillIntervalMs = Math.min(60000, Math.max(refillIntervalMs, 1500) * 1.15)
      logger.warn({ retryAfter, retryCount }, 'AniList rate limited, retrying')
      return performAnilistRequest(query, variables, retryCount + 1)
    }

    if (response.status === 403 || response.status >= 500) {
      anilistDownUntil = Date.now() + DOWN_COOLDOWN_MS
      anilistRateLimited = false
    } else if (response.status >= 200 && response.status < 300) {
      anilistDownUntil = 0
      anilistRateLimited = false
    }

    const json = (await response.json()) as {
      data?: T | null
      errors?: { message: string }[]
    }

    if (json.errors && !json.data) {
      logger.warn({ status: response.status, errors: json.errors }, 'AniList request failed')
    }

    return { data: json.data ?? null, errors: json.errors }
  } catch (err) {
    anilistDownUntil = Math.max(anilistDownUntil, Date.now() + NETWORK_COOLDOWN_MS)
    logger.error({ err }, 'AniList request error')
    return null
  }
}

export function anilistRequest<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<AnilistResponse<T>> {
  if (anilistUnavailable()) {
    return Promise.resolve({ data: null, errors: [{ message: 'AniList unavailable' }] })
  }
  const cacheKey = getAnilistCacheKey(query, variables)
  const existing = inFlightAnilistRequests.get(cacheKey)
  if (existing) return existing as Promise<AnilistResponse<T>>

  const request = performAnilistRequest<T>(query, variables)
  inFlightAnilistRequests.set(cacheKey, request as Promise<AnilistResponse<unknown>>)
  request.then(
    () => inFlightAnilistRequests.delete(cacheKey),
    () => inFlightAnilistRequests.delete(cacheKey)
  )
  return request
}

function stripHtml(input?: string | null): string {
  if (!input) return ''
  return input
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export function fromAnilistMedia(m: AnilistMedia): Show {
  const id = m.id.toString()
  const title = m.title
  const name = title?.romaji || title?.english || title?.native || 'Unknown'

  const nextEpisodeAirDate =
    m.nextAiringEpisode?.airingAt != null
      ? new Date(m.nextAiringEpisode.airingAt * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : undefined

  return {
    _id: id,
    id,
    anilistId: m.id,
    name,
    englishName: title?.english,
    nativeName: title?.native,
    names: {
      romaji: title?.romaji,
      english: title?.english,
      native: title?.native,
      synonyms: m.synonyms,
    },
    thumbnail: m.coverImage?.extraLarge || m.coverImage?.large || '',
    bannerImage: m.bannerImage || undefined,
    description: stripHtml(m.description),
    genres: (m.genres?.slice(0, 6) || []).map((g) => ({ name: g })),
    score: m.averageScore != null ? Number((m.averageScore / 10).toFixed(1)) : undefined,
    type: m.format,
    status: m.status,
    episodeCount: m.episodes ?? undefined,
    year: m.seasonYear ?? undefined,
    season: m.season
      ? { season: m.season, title: m.season, year: m.seasonYear ?? undefined }
      : undefined,
    nextAiring: m.nextAiringEpisode
      ? {
          episode: m.nextAiringEpisode.episode,
          timeUntilAiring: m.nextAiringEpisode.timeUntilAiring,
        }
      : undefined,
    nextEpisodeAirDate,
    studios: m.studios?.nodes?.map((n) => ({ name: n.name })),
    isAdult: m.isAdult,
    tags: m.tags?.map((t) => ({ name: t.name })),
    averageScore: m.averageScore ?? undefined,
    country: m.countryOfOrigin ?? undefined,
    airedStart: m.startDate
      ? {
          year: m.startDate.year ?? undefined,
          month: m.startDate.month ?? undefined,
          date: m.startDate.day ?? undefined,
        }
      : undefined,
    airedEnd: m.endDate
      ? {
          year: m.endDate.year ?? undefined,
          month: m.endDate.month ?? undefined,
          date: m.endDate.day ?? undefined,
        }
      : undefined,
  }
}

export async function getLatestReleases(
  format: string = 'TV',
  page: number = 1,
  size: number = 12
): Promise<Show[]> {
  if (format === 'ADULT') {
    return getAdultLatest(page, size)
  }

  const now = Math.floor(Date.now() / 1000)
  const thirtyDaysAgo = now - 30 * 86400
  const needed = page * size
  const accumulated: Show[] = []
  const seen = new Set<number>()
  let anilistPage = 1
  let apiFailed = false

  while (accumulated.length < needed && anilistPage <= 10) {
    const query = `
      query ($page: Int, $perPage: Int, $airingAtGt: Int, $airingAtLt: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage }
          airingSchedules(sort: TIME_DESC, airingAt_lesser: $airingAtLt, airingAt_greater: $airingAtGt) {
            id episode airingAt
            media {
              ${mediaFieldsLight()}
            }
          }
        }
      }
    `

    const result = await anilistRequest<{
      Page: {
        pageInfo: { hasNextPage: boolean }
        airingSchedules?: {
          id: number
          episode: number
          airingAt: number
          media?: AnilistMedia
        }[]
      }
    }>(query, { page: anilistPage, perPage: 50, airingAtLt: now, airingAtGt: thirtyDaysAgo })

    if (!result?.data) {
      apiFailed = true
      break
    }

    const schedules = result?.data?.Page?.airingSchedules
    if (!schedules || schedules.length === 0) break

    for (const s of schedules) {
      if (!s.media) continue
      if (format !== 'ALL' && s.media.format !== format) continue
      if (s.media.isAdult) continue
      if (!s.media.id || seen.has(s.media.id)) continue
      seen.add(s.media.id)
      accumulated.push(fromAnilistMedia(s.media))
      if (accumulated.length >= needed) break
    }

    if (!result.data?.Page?.pageInfo?.hasNextPage) break
    anilistPage++
  }

  if (apiFailed) {
    return []
  }

  const start = (page - 1) * size
  return accumulated.slice(start, start + size)
}

async function getAdultLatest(page: number, size: number): Promise<Show[]> {
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { total hasNextPage }
        media(sort: [START_DATE_DESC, ID_DESC], type: ANIME, isAdult: true) {
          ${mediaFieldsLight()}
        }
      }
    }
  `

  const result = await anilistRequest<{
    Page: {
      pageInfo: { total: number; hasNextPage: boolean }
      media?: AnilistMedia[]
    }
  }>(query, { page, perPage: size })

  if (!result?.data) {
    return []
  }

  const media = result?.data?.Page?.media
  if (!media) return []

  return media.map(fromAnilistMedia)
}

export async function getSeasonal(
  page: number = 1,
  size: number = 14,
  format?: string
): Promise<Show[]> {
  if (format === 'ADULT') {
    return getAdultLatest(page, size)
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const currentSeason =
    month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL'

  const query = `
    query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int, $format: MediaFormat) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage total }
        media(season: $season, seasonYear: $seasonYear, type: ANIME, format: $format, isAdult: false, sort: [POPULARITY_DESC, SCORE_DESC]) {
          ${mediaFieldsLight()}
        }
      }
    }
  `

  const formatVar = format && format !== 'ALL' ? format.toUpperCase() : undefined
  const result = await anilistRequest<{
    Page: {
      pageInfo: { hasNextPage: boolean; total: number }
      media?: AnilistMedia[]
    }
  }>(query, { page, perPage: size, season: currentSeason, seasonYear: year, format: formatVar })

  if (!result?.data) {
    if (anilistIsDown()) {
      return (await kitsuSeasonal(currentSeason, year, format, page, size)).map(fromAnilistMedia)
    }
    return []
  }

  const media = result?.data?.Page?.media
  if (!media) return []

  return media.map(fromAnilistMedia)
}

export async function getTrending(
  page: number = 1,
  perPage: number = 20,
  sort: AnilistSort = 'TRENDING_DESC',
  status?: string
): Promise<Show[]> {
  const media = await fetchAnilistMedia(page, perPage, sort, status)
  if (media && media.length > 0) {
    return media.map(fromAnilistMedia)
  }

  if (anilistIsDown()) {
    const kitsuMedia = await kitsuTrending(page, perPage)
    return kitsuMedia.map(fromAnilistMedia)
  }

  return []
}

async function fetchAnilistMedia(
  page: number = 1,
  perPage: number = 20,
  sort: AnilistSort = 'TRENDING_DESC',
  status?: string
): Promise<AnilistMedia[] | null> {
  const statusFilter = status ? `status: ${status},` : ''
  const query = `
    query ($page: Int, $perPage: Int) {
      Page(page: $page, perPage: $perPage) {
        media(sort: ${sort}, type: ANIME, isAdult: false, ${statusFilter}) {
          ${mediaFields()}
        }
      }
    }
  `

  const result = await anilistRequest<{ Page: { media?: AnilistMedia[] } }>(query, {
    page,
    perPage,
  })
  if (!result?.data) return null
  return result?.data?.Page?.media ?? []
}

export async function getSpotlightBanners(page: number = 1, perPage: number = 20): Promise<Show[]> {
  const media = await fetchAnilistMedia(page, perPage)
  const source = media ?? null

  if (!source) {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const currentSeason =
      month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL'
    const kitsuMedia = await kitsuSeasonal(currentSeason, year, 'TV', 1, 20)
    if (!kitsuMedia || kitsuMedia.length === 0) {
      return []
    }
    const shuffled = kitsuMedia.sort(() => Math.random() - 0.5)
    const results: Show[] = []
    for (const m of shuffled) {
      if (results.length >= 6) break
      const tmdbBackdrop = await findTmdbDefaultBackdrop({
        english: m.title?.english,
        romaji: m.title?.romaji,
        native: m.title?.native,
      })
      if (tmdbBackdrop) {
        results.push({
          ...fromAnilistMedia(m),
          bannerImage: tmdbBackdrop,
        })
      }
    }
    return results
  }

  const results: Show[] = []
  for (const m of source) {
    if (results.length >= 6) break
    const tmdbBackdrop = await findTmdbDefaultBackdrop({
      english: m.title?.english,
      romaji: m.title?.romaji,
      native: m.title?.native,
    })
    if (tmdbBackdrop) {
      results.push({
        ...fromAnilistMedia(m),
        bannerImage: tmdbBackdrop,
      })
    }
  }
  return results
}

export async function getShowMetaById(id: string): Promise<Show | null> {
  const numericId = parseInt(id)
  if (isNaN(numericId)) return null

  const fields = mediaFields()
  const cacheKey = `meta:${id}`
  const cached = getCachedAnilist<Show>(cacheKey)
  if (cached) return cached

  const query = `query ($id: Int) { Media(id: $id, type: ANIME) { ${fields} } }`
  const queryMal = `query ($id: Int) { Media(idMal: $id, type: ANIME) { ${fields} } }`

  const byId = await anilistRequest<{ Media?: AnilistMedia | null }>(query, { id: numericId })
  if (byId?.data?.Media) {
    const show = fromAnilistMedia(byId.data.Media)
    setCachedAnilist(cacheKey, show)
    return show
  }

  const byMal = await anilistRequest<{ Media?: AnilistMedia | null }>(queryMal, { id: numericId })
  if (byMal?.data?.Media) {
    const show = fromAnilistMedia(byMal.data.Media)
    setCachedAnilist(cacheKey, show)
    return show
  }

  const apiFailed = !byId?.data && !byMal?.data
  if (apiFailed && anilistIsDown()) {
    const fb = (await kitsuMetaByAnilistId(numericId)) ?? (await kitsuMetaByMalId(numericId))
    if (fb) {
      const show = fromAnilistMedia(fb)
      setCachedAnilist(cacheKey, show)
      return show
    }
  }

  return null
}

export async function batchGetShowStatuses(ids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  if (ids.length === 0) return result

  if (!isAnilistRateLimited()) {
    const BATCH = 10
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH)
      const aliases = batch
        .map((id, idx) => `a${idx}: Media(id: $id${idx}, type: ANIME) { id status }`)
        .join('\n')
      const variables: Record<string, unknown> = {}
      batch.forEach((id, idx) => {
        variables[`id${idx}`] = id
      })

      try {
        const resp = await anilistRequest<Record<string, { id: number; status: string }>>(
          `query (${batch.map((_, idx) => `$id${idx}: Int`).join(', ')}) { ${aliases} }`,
          variables
        )

        for (let j = 0; j < batch.length; j++) {
          const alias = `a${j}`
          const media = resp?.data?.[alias]
          if (media?.status) result.set(media.id, media.status)
        }
      } catch {
        break
      }
    }
    if (result.size === ids.length) return result
  }

  const missing = ids.filter((id) => !result.has(id))
  if (missing.length > 0) {
    try {
      const { kitsuBatchGetStatuses } = await import('./kitsu')
      const kitsuStatuses = await kitsuBatchGetStatuses(missing)
      for (const [id, status] of kitsuStatuses) {
        result.set(id, status)
      }
    } catch {
      // Kitsu fallback failed
    }
  }

  return result
}

export async function getAnilistEpisodes(id: string): Promise<string[]> {
  const numericId = parseInt(id)
  if (isNaN(numericId)) return []

  const cacheKey = `eps:${id}`
  const cached = getCachedAnilist<string[]>(cacheKey)
  if (cached) return cached

  const subquery = `id episodes status nextAiringEpisode { episode airingAt } airingSchedule(perPage: 100) { nodes { episode airingAt } }`
  const query = `query ($id: Int) { Media(id: $id, type: ANIME) { ${subquery} } }`
  const queryMal = `query ($id: Int) { Media(idMal: $id, type: ANIME) { ${subquery} } }`

  const byId = await anilistRequest<{
    Media?: {
      id: number
      episodes?: number | null
      status?: string
      nextAiringEpisode?: { episode: number; airingAt: number } | null
      airingSchedule?: { nodes?: { episode: number; airingAt: number }[] }
    } | null
  }>(query, { id: numericId })
  const media = byId?.data?.Media
  if (!media) {
    const byMal = await anilistRequest<{
      Media?: {
        id: number
        episodes?: number | null
        status?: string
        nextAiringEpisode?: { episode: number; airingAt: number } | null
        airingSchedule?: { nodes?: { episode: number; airingAt: number }[] }
      } | null
    }>(queryMal, { id: numericId })
    if (!byMal?.data) {
      if (anilistIsDown()) {
        const episodes = await kitsuEpisodes(numericId, numericId)
        if (episodes.length > 0) {
          setCachedAnilist(cacheKey, episodes)
          return episodes
        }
      }
      return []
    }
    if (!byMal?.data?.Media) return []
    const episodes = extractEpisodes(byMal.data.Media)
    setCachedAnilist(cacheKey, episodes)
    return episodes
  }
  const episodes = extractEpisodes(media)
  setCachedAnilist(cacheKey, episodes)
  return episodes
}

function extractEpisodes(result: {
  episodes?: number | null
  status?: string
  nextAiringEpisode?: { episode: number; airingAt: number } | null
  airingSchedule?: { nodes?: { episode: number; airingAt: number }[] }
}): string[] {
  const { status, episodes: total, nextAiringEpisode, airingSchedule } = result

  if (status === 'FINISHED' && total) {
    return Array.from({ length: total }, (_, i) => (i + 1).toString())
  }

  if (status === 'RELEASING' && nextAiringEpisode?.episode) {
    const airedCount = nextAiringEpisode.episode - 1
    if (airedCount > 0) {
      return Array.from({ length: airedCount }, (_, i) => (i + 1).toString())
    }
  }

  if (airingSchedule?.nodes) {
    const now = Date.now() / 1000
    const aired = airingSchedule.nodes.filter((n) => n.airingAt < now)
    if (aired.length > 0) {
      const max = Math.max(...aired.map((n) => n.episode))
      return Array.from({ length: max }, (_, i) => (i + 1).toString())
    }
  }

  if (total) {
    return Array.from({ length: total }, (_, i) => (i + 1).toString())
  }

  return []
}

export async function searchAnilistByTitle(
  title: string
): Promise<{ id: number; title: { romaji?: string; english?: string; native?: string } } | null> {
  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 5) {
        media(search: $search, type: ANIME) {
          id
          title { romaji english native }
        }
      }
    }
  `

  const normalizedTitle = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const words = normalizedTitle.split(/\s+/).filter((word) => word.length >= 3)
  const searchTerms = [
    title,
    normalizedTitle,
    normalizedTitle.replace(/:/g, ''),
    words.slice(0, 5).join(' '),
    words.slice(0, 4).join(' '),
    words.slice(0, 3).join(' '),
    words.slice(0, 2).join(' ').replace(/:/g, ''),
    normalizedTitle.replace(/\s*\d+(?:st|nd|rd|th)?\s*Season\s*\d*/gi, '').trim(),
  ].filter((t, i, a) => t && a.indexOf(t) === i)
  let media:
    | { id: number; title: { romaji?: string; english?: string; native?: string } }[]
    | undefined
  let anyFailed = false

  for (const searchTerm of searchTerms) {
    const result = await anilistRequest<{
      Page: {
        media?: { id: number; title: { romaji?: string; english?: string; native?: string } }[]
      }
    }>(query, { search: searchTerm })
    if (!result?.data) {
      anyFailed = true
      break
    }
    media = result?.data?.Page?.media
    if (media?.length) break
  }

  if (!media || media.length === 0) {
    if (anyFailed && anilistIsDown()) {
      const fb = await kitsuSearchAnime({ query: title, page: 1, perPage: 5 })
      if (fb.length > 0) {
        const best = fb[0]
        return { id: Math.abs(best.id), title: best.title ?? {} }
      }
    }
    return null
  }

  const lowerTitle = title.toLowerCase()
  const exactMatch = media.find(
    (m) =>
      m.title?.romaji?.toLowerCase() === lowerTitle ||
      m.title?.english?.toLowerCase() === lowerTitle ||
      m.title?.native === title
  )

  if (exactMatch) {
    return { id: exactMatch.id, title: exactMatch.title }
  }

  const inputWords = new Set(
    normalizedTitle
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2)
  )
  let best = media[0]
  let bestScore = 0
  for (const m of media) {
    const text = (m.title?.romaji || m.title?.english || '').toLowerCase()
    const overlap = text.split(/\s+/).filter((w) => inputWords.has(w)).length
    if (overlap > bestScore) {
      bestScore = overlap
      best = m
    }
  }
  return { id: best.id, title: best.title }
}

export async function getAiredEpisodesForShows(
  ids: number[],
  startDate: Date,
  endDate: Date
): Promise<{ mediaId: number; episode: number; airingAt: number }[]> {
  const dayStart = Math.floor(startDate.getTime() / 1000)
  const dayEnd = Math.floor(endDate.getTime() / 1000)

  const cacheKey = `aired:${dayStart}:${dayEnd}:${Array.from(ids)
    .sort((a, b) => a - b)
    .join(',')}`
  const cached = getCachedAiredEpisodes(cacheKey)
  if (cached) return cached

  try {
    const results = await getAiredEpisodesFromAniScheduleFeed(ids, dayStart, dayEnd)
    setCachedAiredEpisodes(cacheKey, results)
    return results
  } catch (e) {
    logger.warn(
      { err: e },
      'AniSchedule episode feed failed, falling back to AniList aired episodes'
    )
  }

  if (isAnilistRateLimited()) {
    return []
  }

  const now = Math.floor(Date.now() / 1000)
  const results: { mediaId: number; episode: number; airingAt: number }[] = []
  const seen = new Set<string>()
  const BATCH = 5

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH)
    const aliases = batch
      .map(
        (id, idx) =>
          `a${idx}: Media(id: $id${idx}, type: ANIME) { id airingSchedule(perPage: 100) { nodes { episode airingAt } } }`
      )
      .join('\n')

    const variables: Record<string, unknown> = {}
    batch.forEach((id, idx) => {
      variables[`id${idx}`] = id
    })

    const result = await anilistRequest<
      Record<
        string,
        { id: number; airingSchedule?: { nodes?: { episode: number; airingAt: number }[] } }
      >
    >(`query (${batch.map((_, idx) => `$id${idx}: Int`).join(', ')}) { ${aliases} }`, variables)

    for (let j = 0; j < batch.length; j++) {
      const alias = `a${j}`
      const media = result?.data?.[alias]
      if (!media?.airingSchedule?.nodes) continue
      for (const node of media.airingSchedule.nodes) {
        if (node.airingAt >= dayStart && node.airingAt <= dayEnd && node.airingAt <= now) {
          const key = `${media.id}:${node.episode}`
          if (!seen.has(key)) {
            seen.add(key)
            results.push({ mediaId: media.id, episode: node.episode, airingAt: node.airingAt })
          }
        }
      }
    }
  }

  setCachedAiredEpisodes(cacheKey, results)
  return results
}

export async function getAiredEpisodesForShow(
  id: number,
  startDate: Date,
  endDate: Date
): Promise<number[]> {
  const dayStart = Math.floor(startDate.getTime() / 1000)
  const dayEnd = Math.floor(endDate.getTime() / 1000)

  const query = `
    query ($id: Int, $dayStart: Int, $dayEnd: Int) {
      Media(id: $id, type: ANIME) {
        id
        airingSchedule(airingAt_greater: $dayStart, airingAt_lesser: $dayEnd) {
          episode
          airingAt
        }
      }
    }
  `

  const result = await anilistRequest<{
    Media: { airingSchedule?: { episode: number; airingAt: number }[] }
  }>(query, { id, dayStart, dayEnd })

  const schedules = result?.data?.Media?.airingSchedule
  if (!schedules || schedules.length === 0) return []

  const now = Math.floor(Date.now() / 1000)
  return schedules.filter((s) => s.airingAt <= now).map((s) => s.episode)
}

export async function getSchedule(date: Date, format?: string, adult = false): Promise<Show[]> {
  if (format === 'ADULT') {
    adult = true
    format = undefined
  }
  try {
    const result = await getScheduleFromAniSchedule(date, format, adult)
    const shows = result.entries
      .filter((e) => e.show)
      .map((e) => withScheduleFields(e.show as Show, e.episode, e.airingAt))

    if (result.missingMeta.length > 0) {
      for (const entry of result.missingMeta) {
        try {
          const meta = await getShowMetaById(String(entry.id))
          if (!meta) continue
          if (adult ? !meta.isAdult : meta.isAdult) continue
          shows.push(withScheduleFields(meta, entry.episode, entry.airingAt))
        } catch {
          // keep going without this show
        }
      }
    }

    return shows
  } catch (e) {
    logger.warn({ err: e }, 'AniSchedule schedule failed, falling back to AniList')
    if (isAnilistRateLimited()) return []
    return getScheduleFromAnilist(date, format, adult)
  }
}

async function getScheduleFromAnilist(date: Date, format?: string, adult = false): Promise<Show[]> {
  const dayStart = Math.floor(date.getTime() / 1000)
  const dayEnd = dayStart + 86400

  const query = `
    query ($dayStart: Int, $dayEnd: Int) {
      Page(perPage: 50) {
        airingSchedules(airingAt_greater: $dayStart, airingAt_lesser: $dayEnd) {
          episode
          airingAt
          media {
            ${mediaFields()}
          }
        }
      }
    }
  `

  const result = await anilistRequest<{
    Page: {
      airingSchedules?: {
        episode: number
        airingAt: number
        media?: AnilistMedia
      }[]
    }
  }>(query, { dayStart, dayEnd })

  const schedules = result?.data?.Page?.airingSchedules
  if (!schedules || schedules.length === 0) return []

  const seen = new Set<number>()
  const results: Show[] = []
  const now = Math.floor(Date.now() / 1000)
  for (const entry of schedules) {
    const media = entry.media
    if (!media) continue
    if (format && format !== 'ALL' && media.format !== format) continue
    const isAdultShow = !!media.isAdult
    if (adult ? !isAdultShow : isAdultShow) continue
    const key = media.idMal ?? media.id
    if (seen.has(key)) continue
    seen.add(key)
    const show = fromAnilistMedia(media)
    show.episodeNumber = entry.episode
    show.aired = entry.airingAt <= now
    show.nextAiring = {
      episode: entry.episode,
      timeUntilAiring: entry.airingAt - now,
    }
    show.nextEpisodeAirDate = new Date(entry.airingAt * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
    show.airTime = new Date(entry.airingAt * 1000).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
    results.push(show)
  }

  return results
}

export interface AnilistSearchOptions {
  query?: string
  page?: number
  perPage?: number
  format?: string
  status?: string
  season?: string
  seasonYear?: number
  countryOfOrigin?: string
  genre?: string
  genre_not_in?: string[]
  tag_not_in?: string[]
  averageScore_greater?: number
  episodes_greater?: number
  isAdult?: boolean
  sort?: string
}

export async function searchAnilist(options: AnilistSearchOptions = {}): Promise<Show[]> {
  const {
    query,
    page = 1,
    perPage = 14,
    format,
    status,
    season,
    seasonYear,
    countryOfOrigin,
    genre,
    genre_not_in,
    tag_not_in,
    averageScore_greater,
    episodes_greater,
    isAdult,
    sort,
  } = options

  const searchVars: Record<string, unknown> = {
    page,
    perPage,
  }

  if (query) searchVars.search = query
  if (format && format !== 'ALL') {
    if (format === 'ADULT') {
      searchVars.isAdult = true
    } else {
      searchVars.format = format.toUpperCase()
    }
  }
  if (status) searchVars.status = status
  if (season && season !== 'ALL') searchVars.season = season.toUpperCase()
  if (seasonYear) searchVars.seasonYear = seasonYear
  if (countryOfOrigin && countryOfOrigin !== 'ALL') searchVars.countryOfOrigin = countryOfOrigin
  if (genre) searchVars.genre = genre
  if (genre_not_in && genre_not_in.length > 0) searchVars.genre_not_in = genre_not_in
  if (tag_not_in && tag_not_in.length > 0) searchVars.tag_not_in = tag_not_in
  if (averageScore_greater) searchVars.averageScore_greater = averageScore_greater
  if (episodes_greater) searchVars.episodes_greater = episodes_greater
  if (isAdult !== undefined) searchVars.isAdult = isAdult
  if (sort) searchVars.sort = [sort]

  const queryStr = `
    query ($page: Int, $perPage: Int, $search: String, $format: MediaFormat, $status: MediaStatus, $season: MediaSeason, $seasonYear: Int, $countryOfOrigin: CountryCode, $genre: String, $genre_not_in: [String], $tag_not_in: [String], $averageScore_greater: Int, $episodes_greater: Int, $isAdult: Boolean, $sort: [MediaSort]) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage total }
        media(
          search: $search,
          type: ANIME,
          format: $format,
          status: $status,
          season: $season,
          seasonYear: $seasonYear,
          countryOfOrigin: $countryOfOrigin,
          genre: $genre,
          genre_not_in: $genre_not_in,
          tag_not_in: $tag_not_in,
          averageScore_greater: $averageScore_greater,
          episodes_greater: $episodes_greater,
          isAdult: $isAdult,
          sort: $sort
        ) {
          ${mediaFieldsLight()}
        }
      }
    }
  `

  const result = await anilistRequest<{
    Page: {
      pageInfo: { hasNextPage: boolean; total: number }
      media?: AnilistMedia[]
    }
  }>(queryStr, searchVars)

  if (!result?.data) {
    if (anilistIsDown()) {
      const fb = await kitsuSearchAnime({
        query,
        page,
        perPage,
        format: format && format !== 'ALL' && format !== 'ADULT' ? format : undefined,
        status,
        season,
        seasonYear,
        genre,
        genre_not_in,
        averageScore_greater,
        episodes_greater,
        isAdult: format === 'ADULT' ? true : isAdult,
        sort,
      })
      const seen = new Set<number>()
      const results: Show[] = []
      for (const m of fb) {
        if (!m.id || seen.has(m.id)) continue
        seen.add(m.id)
        results.push(fromAnilistMedia(m))
      }
      return results
    }
    return []
  }

  const media = result?.data?.Page?.media
  if (!media || media.length === 0) return []

  const seen = new Set<number>()
  const results: Show[] = []
  for (const m of media) {
    if (!m.id || seen.has(m.id)) continue
    seen.add(m.id)
    results.push(fromAnilistMedia(m))
  }

  return results
}

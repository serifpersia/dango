import type { AnilistMedia } from './anilist'
import logger from '../logger'

const KITSU_BASE = 'https://kitsu.app/api/edge'
const KITSU_HEADERS = { Accept: 'application/vnd.api+json', 'User-Agent': 'ani-web' }
const REQUEST_TIMEOUT_MS = 15000
const MAX_RETRIES = 3

interface KitsuEntry {
  id: string
  type: string
  attributes: Record<string, unknown>
  relationships?: Record<
    string,
    { data?: { id: string; type: string } | { id: string; type: string }[] }
  >
}

interface KitsuResponse {
  data?: KitsuEntry | KitsuEntry[]
  included?: KitsuEntry[]
  meta?: { count?: number }
  errors?: { title?: string; detail?: string }[]
}

async function kitsuFetch(path: string): Promise<KitsuResponse | null> {
  let lastError: string | null = null
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const res = await fetch(`${KITSU_BASE}${path}`, {
          headers: KITSU_HEADERS,
          signal: controller.signal,
        })
        if (res.status === 429 || res.status >= 500) {
          lastError = `kitsu fetch failed with status ${res.status}`
          await new Promise((r) => setTimeout(r, 1000 * attempt))
          continue
        }
        if (!res.ok) {
          logger.warn({ status: res.status, path }, 'Kitsu request failed')
          return null
        }
        return (await res.json()) as KitsuResponse
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, 500 * attempt))
    }
  }
  logger.warn({ lastError }, 'Kitsu request error')
  return null
}

function asArray(data?: KitsuEntry | KitsuEntry[]): KitsuEntry[] {
  if (!data) return []
  return Array.isArray(data) ? data : [data]
}

/** Builds a map of kitsu relationship id -> included resource for a given type. */
function includedMap(
  entry: KitsuEntry,
  included: KitsuEntry[] | undefined,
  type: string
): KitsuEntry[] {
  if (!included || !entry.relationships) return []
  const rel = entry.relationships[type]
  if (!rel?.data) return []
  const ids = new Set<string>()
  for (const item of Array.isArray(rel.data) ? rel.data : [rel.data]) {
    ids.add(item.id)
  }
  return included.filter((i) => i.type === type && ids.has(i.id))
}

/** Kitsu status/subtype/season values are lowercase; map to AniList-style values. */
const STATUS_MAP: Record<string, string> = {
  current: 'RELEASING',
  finished: 'FINISHED',
  upcoming: 'NOT_YET_RELEASED',
  unreleased: 'NOT_YET_RELEASED',
  tba: 'NOT_YET_RELEASED',
}

const SUBTYPE_MAP: Record<string, string> = {
  tv: 'TV',
  ova: 'OVA',
  ona: 'ONA',
  movie: 'MOVIE',
  special: 'SPECIAL',
  music: 'MUSIC',
}

const SEASON_BY_MONTH = [
  'WINTER',
  'WINTER',
  'SPRING',
  'SPRING',
  'SPRING',
  'SUMMER',
  'SUMMER',
  'SUMMER',
  'FALL',
  'FALL',
  'FALL',
  'WINTER',
]

function parseKitsuDate(s: unknown): { year?: number; month?: number; day?: number } | undefined {
  if (typeof s !== 'string' || !s) return undefined
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return undefined
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

function statusToAnilist(status: string | undefined): string | undefined {
  if (!status) return undefined
  return STATUS_MAP[status.toLowerCase()] ?? status.toUpperCase()
}

function formatToAnilist(subtype: string | undefined): string | undefined {
  if (!subtype) return undefined
  return SUBTYPE_MAP[subtype.toLowerCase()] ?? subtype.toUpperCase()
}

function anilistSortToKitsu(sort: string | undefined): string {
  switch (sort) {
    case 'SCORE_DESC':
      return '-averageRating'
    case 'FAVOURITES_DESC':
      return '-favoritesCount'
    case 'START_DATE_DESC':
      return '-startDate'
    case 'END_DATE_DESC':
      return '-endDate'
    case 'EPISODES_DESC':
      return '-episodeCount'
    case 'ID_DESC':
      return '-id'
    case 'UPDATED_AT_DESC':
      return '-updatedAt'
    default:
      return '-userCount'
  }
}

/** Translates an AniList-style status filter to a Kitsu filter value. */
function statusToKitsuFilter(status: string | undefined): string | undefined {
  if (!status) return undefined
  const s = status.toUpperCase()
  if (s === 'RELEASING' || s === 'ONGOING') return 'current'
  if (s === 'FINISHED') return 'finished'
  if (s === 'NOT_YET_RELEASED' || s === 'UPCOMING' || s === 'HIATUS') return 'upcoming'
  return undefined
}

function seasonToKitsu(season: string | undefined): string | undefined {
  if (!season) return undefined
  return season.toLowerCase()
}

/** Kitsu genre-ish taxonomy: `categories`. */
const CATEGORY_ALIASES: Record<string, string> = {
  'Sci-Fi': 'Science Fiction',
  'Sci Fi': 'Science Fiction',
  Shounen: 'Shounen',
}

function normalizeCategory(cat: string): string {
  const c = cat.trim()
  const alias = Object.entries(CATEGORY_ALIASES).find(([k]) => k.toLowerCase() === c.toLowerCase())
  return alias ? alias[1] : c
}

export interface KitsuSearchOptions {
  query?: string
  page?: number
  perPage?: number
  format?: string
  status?: string
  season?: string
  seasonYear?: number
  genre?: string
  genre_not_in?: string[]
  averageScore_greater?: number
  episodes_greater?: number
  isAdult?: boolean
  sort?: string
}

export interface KitsuListOptions extends KitsuSearchOptions {
  sortValue?: string
}

/**
 * Resolves the included anime resource linked by a mapping entry's `item` relationship.
 */
function mappingItem(entry: KitsuEntry, included: KitsuEntry[]): KitsuEntry | undefined {
  const rel = entry.relationships?.item?.data
  if (!rel) return undefined
  if (Array.isArray(rel)) return undefined
  return included.find((i) => i.type === rel.type && i.id === rel.id)
}

/**
 * Fetches a list of anime from Kitsu and normalizes entries to AnilistMedia.
 * `include=mappings,categories` gives AniList/MAL ids + genres in one request.
 */
export async function kitsuSearchAnime(options: KitsuSearchOptions = {}): Promise<AnilistMedia[]> {
  const {
    query,
    page = 1,
    perPage = 14,
    format,
    status,
    season,
    seasonYear,
    genre,
    genre_not_in,
    averageScore_greater,
    episodes_greater,
    isAdult,
    sort,
  } = options

  const filters: string[] = []
  if (query) filters.push(`filter[text]=${encodeURIComponent(query)}`)
  if (format && format !== 'ALL' && format !== 'ADULT') {
    filters.push(`filter[subtype]=${format.toLowerCase()}`)
  }
  const statusFilter = statusToKitsuFilter(status)
  if (statusFilter) filters.push(`filter[status]=${statusFilter}`)
  const seasonFilter = seasonToKitsu(season)
  if (seasonFilter && seasonFilter !== 'all') filters.push(`filter[season]=${seasonFilter}`)
  if (seasonYear) filters.push(`filter[seasonYear]=${seasonYear}`)
  if (genre) filters.push(`filter[categories]=${encodeURIComponent(genre)}`)

  const offset = (page - 1) * perPage
  const path = `/anime?${filters.join('&')}${filters.length ? '&' : ''}sort=${anilistSortToKitsu(
    sort
  )}&page[limit]=${perPage}&page[offset]=${offset}&include=mappings,categories`

  const json = await kitsuFetch(path)
  if (!json) return []
  const entries = asArray(json.data)
  const included = json.included ?? []

  const results: AnilistMedia[] = []
  for (const entry of entries) {
    const media = normalizeKitsuEntry(entry, included)
    if (!media) continue

    if (genre_not_in?.length) {
      const hasExcluded = (media.genres ?? []).some((g) =>
        genre_not_in.some((ng) => ng.toLowerCase() === g.toLowerCase())
      )
      if (hasExcluded) continue
    }
    if (averageScore_greater != null && (media.averageScore ?? 0) < averageScore_greater) continue
    if (episodes_greater != null && (media.episodes ?? 0) < episodes_greater) continue
    if (isAdult === true && !media.isAdult) continue
    if (isAdult === false && media.isAdult) continue

    results.push(media)
  }

  return results
}

/** Deduplicates by the resolved AniList/MAL id (keeps the first occurrence). */
export function dedupeKitsuMedia(list: AnilistMedia[]): AnilistMedia[] {
  const seen = new Set<number>()
  const out: AnilistMedia[] = []
  for (const m of list) {
    const key = m.id > 0 ? m.id : (m.idMal ?? m.id)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(m)
  }
  return out
}

/** Converts a Kitsu entry + included resources into AnilistMedia (id = AniList or MAL id). */
function normalizeKitsuEntry(
  entry: KitsuEntry,
  included: KitsuEntry[],
  knownIds?: { anilistId?: number | null; malId?: number | null }
): AnilistMedia | null {
  const a = entry.attributes
  const mappings = includedMap(entry, included, 'mappings')
  const anilistMapping = mappings.find((m) => m.attributes?.externalSite === 'anilist/anime')
  const malMapping = mappings.find((m) => m.attributes?.externalSite === 'myanimelist/anime')

  const anilistId = anilistMapping
    ? Number(anilistMapping.attributes.externalId)
    : (knownIds?.anilistId ?? null)
  const malId = malMapping ? Number(malMapping.attributes.externalId) : (knownIds?.malId ?? null)
  if (!anilistId && !malId) return null

  const id = anilistId ?? -Math.abs(malId as number)
  const title: { romaji?: string; english?: string; native?: string } = {}
  const titles = (a.titles as Record<string, string> | undefined) ?? {}
  title.romaji =
    titles.en_jp || titles.en || (entry.attributes.canonicalTitle as string | undefined)
  title.english = titles.en || titles.en_us || title.romaji
  title.native = titles.ja_jp || titles.ja || title.romaji

  const startDate = parseKitsuDate(a.startDate)
  const endDate = parseKitsuDate(a.endDate)

  const poster = (a.posterImage as Record<string, string> | undefined) ?? {}
  const cover = (a.coverImage as Record<string, string> | undefined) ?? {}
  const coverUrl = cover.large || cover.original

  const genres = includedMap(entry, included, 'categories')
    .map((c) => c.attributes?.title as string | undefined)
    .filter(Boolean)
    .map((g) => normalizeCategory(g as string))

  const nextAiringAt =
    a.nextRelease != null ? Math.floor(new Date(a.nextRelease as string).getTime() / 1000) : null

  return {
    id,
    idMal: malId,
    title,
    bannerImage: coverUrl || null,
    coverImage: poster.large
      ? { extraLarge: poster.large, large: poster.large, medium: poster.medium || poster.large }
      : undefined,
    description:
      (a.synopsis as string | undefined) || (a.description as string | undefined) || null,
    genres: genres.length > 0 ? genres : undefined,
    averageScore: a.averageRating != null ? Math.round(Number(a.averageRating)) : null,
    format: formatToAnilist(a.subtype as string | undefined),
    status: statusToAnilist(a.status as string | undefined),
    episodes: (a.episodeCount as number | null | undefined) ?? null,
    duration: (a.episodeLength as number | null | undefined) ?? null,
    season: startDate?.month ? SEASON_BY_MONTH[startDate.month - 1] : undefined,
    seasonYear: startDate?.year ?? undefined,
    startDate,
    endDate,
    isAdult: !!a.nsfw,
    synonyms: (a.abbreviatedTitles as string[] | undefined) ?? undefined,
    popularity: (a.userCount as number | undefined) ?? undefined,
    favourites: (a.favoritesCount as number | undefined) ?? undefined,
    nextAiringEpisode:
      nextAiringAt != null
        ? {
            episode: 0,
            timeUntilAiring: nextAiringAt - Math.floor(Date.now() / 1000),
            airingAt: nextAiringAt,
          }
        : null,
  }
}

/**
 * Finds the Kitsu entry id for a given AniList id via the mappings endpoint.
 */
async function kitsuIdByAnilistId(anilistId: number): Promise<string | null> {
  const json = await kitsuFetch(
    `/mappings?filter[externalSite]=anilist%2Fanime&filter[externalId]=${anilistId}&include=item`
  )
  const entries = asArray(json?.data)
  if (entries.length === 0) return null
  return mappingItem(entries[0], json?.included ?? [])?.id ?? null
}

/** Fetches full detail (genres + studios) for a Kitsu anime id. */
async function kitsuDetail(
  kitsuId: string,
  knownIds?: { anilistId?: number | null; malId?: number | null }
): Promise<AnilistMedia | null> {
  const [animeJson, studiosJson] = await Promise.all([
    kitsuFetch(`/anime/${kitsuId}?include=categories`),
    kitsuFetch(`/anime/${kitsuId}/anime-productions?include=producer&page[limit]=10`),
  ])
  if (!animeJson) return null

  const entry = asArray(animeJson.data)[0]
  if (!entry) return null

  const media = normalizeKitsuEntry(entry, animeJson.included ?? [], knownIds)
  if (!media) return null

  const producers = (studiosJson?.included ?? [])
    .filter((i) => i.type === 'producers')
    .map((i) => ({ id: 0, name: (i.attributes?.name as string | undefined) ?? '' }))
    .filter((p) => p.name.length > 0)

  if (producers.length > 0) {
    media.studios = { nodes: producers }
  }

  return media
}

export async function kitsuMetaByAnilistId(anilistId: number): Promise<AnilistMedia | null> {
  const kitsuId = await kitsuIdByAnilistId(anilistId)
  if (!kitsuId) return null
  return kitsuDetail(kitsuId, { anilistId })
}

export async function kitsuMetaByMalId(malId: number): Promise<AnilistMedia | null> {
  const json = await kitsuFetch(
    `/mappings?filter[externalSite]=myanimelist%2Fanime&filter[externalId]=${malId}&include=item`
  )
  const entries = asArray(json?.data)
  if (entries.length === 0) return null
  const item = mappingItem(entries[0], json?.included ?? [])
  if (!item) return null
  return kitsuDetail(item.id, { malId })
}

/** Episode numbers for a show, via the episodes relationship. */
export async function kitsuEpisodes(anilistId: number, idMal: number | null): Promise<string[]> {
  let kitsuId: string | null = null
  if (anilistId > 0) kitsuId = await kitsuIdByAnilistId(anilistId)
  if (!kitsuId && idMal != null) {
    const json = await kitsuFetch(
      `/mappings?filter[externalSite]=myanimelist%2Fanime&filter[externalId]=${idMal}&include=item`
    )
    const entries = asArray(json?.data)
    if (entries.length > 0) {
      kitsuId = mappingItem(entries[0], json?.included ?? [])?.id ?? null
    }
  }
  if (!kitsuId) return []

  const all: number[] = []
  const LIMIT = 20
  let offset = 0
  while (offset < 1000) {
    const json = await kitsuFetch(
      `/anime/${kitsuId}/episodes?page[limit]=${LIMIT}&page[offset]=${offset}&sort=number`
    )
    if (!json) break
    const entries = asArray(json.data)
    if (entries.length === 0) break
    for (const e of entries) {
      const n = e.attributes?.number as number | undefined
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) all.push(n)
    }
    if (entries.length < LIMIT) break
    offset += LIMIT
  }
  if (all.length === 0) return []
  const max = Math.max(...all)
  return Array.from({ length: max }, (_, i) => (i + 1).toString())
}

/** Trending proxy: currently-airing shows sorted by popularity (user count). */
export async function kitsuTrending(
  page: number = 1,
  perPage: number = 20,
  status?: string
): Promise<AnilistMedia[]> {
  const statusFilter = statusToKitsuFilter(status)
  const filters = statusFilter ? `filter[status]=${statusFilter}` : ''
  const offset = (page - 1) * perPage
  const json = await kitsuFetch(
    `/anime?${filters}${filters ? '&' : ''}sort=-userCount&page[limit]=${perPage}&page[offset]=${offset}&include=mappings,categories`
  )
  if (!json) return []
  return dedupeKitsuMedia(
    asArray(json.data)
      .map((e) => normalizeKitsuEntry(e, json.included ?? []))
      .filter((m): m is AnilistMedia => m !== null)
  )
}

/** Spotlight: top popular shows with native Kitsu banners (3360x800). */
export async function kitsuSpotlight(
  page: number = 1,
  perPage: number = 20
): Promise<AnilistMedia[]> {
  const offset = (page - 1) * perPage
  const json = await kitsuFetch(
    `/anime?sort=-userCount&page[limit]=${perPage}&page[offset]=${offset}&include=mappings,categories`
  )
  if (!json) return []
  return dedupeKitsuMedia(
    asArray(json.data)
      .map((e) => normalizeKitsuEntry(e, json.included ?? []))
      .filter((m): m is AnilistMedia => m !== null)
      .filter((m) => !!m.bannerImage)
  )
}

/**
 * Latest releases: currently-airing shows. Kitsu has no reliable episode airdates,
 * so we sort current shows by start date (newest first) and bump shows with a known
 * next episode date to the front (soonest first).
 */
export async function kitsuLatestReleases(
  format: string = 'TV',
  page: number = 1,
  size: number = 12
): Promise<AnilistMedia[]> {
  const needed = page * size
  const formatFilter = format && format !== 'ALL' ? `filter[subtype]=${format.toLowerCase()}` : ''
  const all: AnilistMedia[] = []
  let offset = 0
  const LIMIT = 20
  while (all.length < needed && offset < 500) {
    const json = await kitsuFetch(
      `/anime?filter[status]=current${formatFilter ? `&${formatFilter}` : ''}&sort=-startDate&page[limit]=${LIMIT}&page[offset]=${offset}&include=mappings,categories`
    )
    if (!json) break
    const entries = asArray(json.data)
    if (entries.length === 0) break
    for (const e of entries) {
      const m = normalizeKitsuEntry(e, json.included ?? [])
      if (!m) continue
      all.push(m)
    }
    offset += LIMIT
  }

  all.sort((a, b) => {
    const aNext = a.nextAiringEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER
    const bNext = b.nextAiringEpisode?.airingAt ?? Number.MAX_SAFE_INTEGER
    if (aNext !== bNext) return aNext - bNext
    const aStart = fallbackStartRank(a)
    const bStart = fallbackStartRank(b)
    if (aStart !== bStart) return bStart - aStart
    return (b.popularity ?? 0) - (a.popularity ?? 0)
  })

  const start = (page - 1) * size
  return dedupeKitsuMedia(all.slice(start, start + size))
}

function fallbackStartRank(m: AnilistMedia): number {
  return (
    (m.startDate?.year ?? 0) * 10000 + (m.startDate?.month ?? 0) * 100 + (m.startDate?.day ?? 0)
  )
}

/** Seasonal list for a given season/year, matching AniList's POPULARITY_DESC order. */
export async function kitsuSeasonal(
  season: string,
  year: number,
  format?: string,
  page: number = 1,
  size: number = 14
): Promise<AnilistMedia[]> {
  const filters = [`filter[season]=${seasonToKitsu(season)}`, `filter[seasonYear]=${year}`]
  if (format && format !== 'ALL' && format !== 'ADULT') {
    filters.push(`filter[subtype]=${format.toLowerCase()}`)
  }
  const offset = (page - 1) * size
  const json = await kitsuFetch(
    `/anime?${filters.join('&')}&sort=-userCount&page[limit]=${size}&page[offset]=${offset}&include=mappings,categories`
  )
  if (!json) return []
  return dedupeKitsuMedia(
    asArray(json.data)
      .map((e) => normalizeKitsuEntry(e, json.included ?? []))
      .filter((m): m is AnilistMedia => m !== null)
  )
}

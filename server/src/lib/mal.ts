import type { AnilistMedia, AnilistSearchOptions } from './anilist'
import { kitsuTitlesByMalIds, KitsuTitles } from './kitsu'

export interface MalCacheStore {
  get(key: string): { payload: string; fresh: boolean } | null
  put(key: string, payload: string, ttlSeconds?: number): void
}

export interface DonorEntry {
  malId?: number
  url?: string
  title?: string
  titleEnglish?: string | null
  titleJapanese?: string | null
  imageUrl?: string
  images?: { small?: string; medium?: string; large?: string }
  synopsis?: string | null
  type?: string | null
  episodes?: number | null
  status?: string
  score?: number | null
  rating?: string
  genres?: Array<string | { name?: string }>
}

export interface ScrapedSearchEntry {
  id: number
  idMal: number
  url: string
  title: string
  imageUrl: string | null
  synopsis: string | null
  type: string | null
  episodes: number | null
  score: number | null
}

export interface ScrapedDetail {
  id: number
  idMal: number
  url: string
  title: string
  titleEnglish: string | null
  titleJapanese: string | null
  imageUrl: string | null
  synopsis: string | null
  type: string | null
  episodes: number | null
  status: string | null
  score: number | null
  rating: string | null
  genres: string[]
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MIN_GAP_MS = 1500
const TIMEOUT_MS = 25000
const DEFAULT_TTL_SECONDS = 6 * 3600

let lastFetchAt = 0

async function politeWait(): Promise<void> {
  const wait = MIN_GAP_MS - (Date.now() - lastFetchAt)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastFetchAt = Date.now()
}

async function fetchHtml(url: string): Promise<{ status: number; html: string; url: string }> {
  await politeWait()
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
  })
  const html = await res.text()
  return { status: res.status, html, url: res.url }
}

function decodeHtml(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

function firstImage(chunk: string): string | null {
  const m =
    chunk.match(/\bdata-src=["']([^"']+)["']/i) || chunk.match(/\bsrc=["']((?!data:)[^"']+)["']/i)
  if (!m) return null
  const raw = m[1].replace(/&amp;/g, '&')
  const unwrapped = raw.match(/[?&]src=([^&]+)/i)
  let url = raw
  if (unwrapped) {
    try {
      url = decodeURIComponent(unwrapped[1])
    } catch {
      url = unwrapped[1]
    }
  }
  if (/^https:\/\/cdn\.myanimelist\.net\/r\/\d+x\d+\//i.test(url)) {
    url = url.replace(/\/r\/\d+x\d+\//i, '/').split('?')[0]
  }
  return url
}

function numeric(raw: string | null | undefined): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/,/g, '').trim()
  if (/^(unknown|n\/a|-)$/i.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseSearchCard(chunk: string): ScrapedSearchEntry | null {
  const idMatch = chunk.match(/id="sarea(\d+)"/)
  if (!idMatch) return null
  const malId = Number(idMatch[1])
  const href = chunk.match(
    new RegExp(`href="(https://myanimelist\\.net/anime/${malId}/[^"]*)"`, 'i')
  )?.[1]
  const title = decodeHtml(chunk.match(/<strong>([^<]+)<\/strong>/i)?.[1] ?? '')
  if (!malId || !title) return null
  const synopsisRaw = chunk.match(/class="pt4">([\s\S]*?)<a\s/i)?.[1] ?? null
  const synopsis = synopsisRaw
    ? decodeHtml(synopsisRaw)
        .replace(/\s*read more\.?$/i, '')
        .replace(/\.{3}$/, '')
        .trim() || null
    : null
  const cells = [
    ...chunk.matchAll(/<td class="borderClass ac bgColor\d"[^>]*>\s*([\s\S]*?)\s*<\/td>/gi),
  ].map((m) => decodeHtml(m[1]))
  return {
    id: -malId,
    idMal: malId,
    url: href ?? `https://myanimelist.net/anime/${malId}`,
    title,
    imageUrl: firstImage(chunk),
    synopsis,
    type: cells[0] || null,
    episodes: numeric(cells[1]),
    score: numeric(cells[2]),
  }
}

export function parseSearchResults(html: string): ScrapedSearchEntry[] {
  if (!html.includes('Anime - MyAnimeList.net')) return []
  const out: ScrapedSearchEntry[] = []
  for (const chunk of html.split('<tr>').slice(1)) {
    const entry = parseSearchCard(chunk)
    if (entry && !out.some((e) => e.idMal === entry.idMal)) out.push(entry)
  }
  return out
}

function metaContent(html: string, property: string): string | null {
  const m = html.match(
    new RegExp(`<meta\\s+property=["']${property}["']\\s+content=["']([^"']*)["']`, 'i')
  )
  return m ? decodeHtml(m[1]) : null
}

function infoField(html: string, label: string): string | null {
  const m = html.match(
    new RegExp(`<span class="dark_text">${label}:</span>\\s*([^<]*?)(?:<|$)`, 'i')
  )
  return m ? decodeHtml(m[1]).trim() || null : null
}

export function parseDetail(html: string, malId: number): ScrapedDetail | null {
  const title =
    metaContent(html, 'og:title') || decodeHtml(html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ?? '')
  if (!title) return null
  const genres = [...html.matchAll(/\/anime\/genre\/\d+\/[^"']*"[^>]*>([^<]+)</gi)]
    .map((m) => decodeHtml(m[1]).trim())
    .filter((g, i, a) => g && a.indexOf(g) === i)
    .slice(0, 10)
  return {
    id: -malId,
    idMal: malId,
    url: metaContent(html, 'og:url') || `https://myanimelist.net/anime/${malId}`,
    title,
    titleEnglish: infoField(html, 'English'),
    titleJapanese: infoField(html, 'Japanese'),
    imageUrl: metaContent(html, 'og:image'),
    synopsis: metaContent(html, 'og:description'),
    type: infoField(html, 'Type'),
    episodes: numeric(infoField(html, 'Episodes')),
    status: infoField(html, 'Status'),
    score: numeric(infoField(html, 'Score')),
    rating: infoField(html, 'Rating'),
    genres,
  }
}

export function toSearchEntry(e: DonorEntry): Record<string, unknown> | null {
  if (!e || !e.malId || !e.title) return null
  return {
    id: -e.malId,
    idMal: e.malId,
    url: e.url ?? `https://myanimelist.net/anime/${e.malId}`,
    title: e.title,
    imageUrl: e.imageUrl ?? null,
    synopsis: e.synopsis ?? null,
    type: e.type ?? null,
    episodes: e.episodes ?? null,
    score: e.score ?? null,
  }
}

export function toDetail(e: DonorEntry, malId: number): Record<string, unknown> | null {
  if (!e || !e.title) return null
  const genres = (Array.isArray(e.genres) ? e.genres : [])
    .map((g) => (typeof g === 'string' ? g : g?.name))
    .filter((g): g is string => !!g)
  return {
    id: -malId,
    idMal: malId,
    url: e.url ?? `https://myanimelist.net/anime/${malId}`,
    title: e.title,
    titleEnglish: e.titleEnglish ?? null,
    titleJapanese: e.titleJapanese ?? null,
    imageUrl: e.imageUrl ?? e.images?.medium ?? null,
    synopsis: e.synopsis ?? null,
    type: e.type ?? null,
    episodes: e.episodes ?? null,
    status: e.status ?? null,
    score: e.score ?? null,
    rating: e.rating ?? null,
    genres,
  }
}

function mapMalStatus(status: string | null): string | undefined {
  if (!status) return undefined
  const s = status.toUpperCase().replace(/\s+/g, '_')
  if (s.includes('FINISHED')) return 'FINISHED'
  if (s.includes('CURRENTLY_AIRING') || s === 'AIRING') return 'RELEASING'
  if (s.includes('NOT_YET_AIRED') || s === 'UPCOMING') return 'NOT_YET_RELEASED'
  return s
}

export function toAnilistSearchMedia(e: ScrapedSearchEntry): AnilistMedia {
  return {
    id: e.id,
    idMal: e.idMal,
    title: { romaji: e.title, english: e.title, native: e.title },
    coverImage: e.imageUrl
      ? { extraLarge: e.imageUrl, large: e.imageUrl, medium: e.imageUrl }
      : undefined,
    description: e.synopsis,
    averageScore: e.score != null ? Math.round(e.score * 10) : null,
    format: e.type?.toUpperCase(),
    episodes: e.episodes,
    siteUrl: e.url,
  }
}

export function toAnilistDetailMedia(e: ScrapedDetail): AnilistMedia {
  const rating = e.rating || ''
  return {
    id: e.id,
    idMal: e.idMal,
    title: {
      romaji: e.title,
      english: e.titleEnglish || e.title,
      native: e.titleJapanese || e.title,
    },
    coverImage: e.imageUrl
      ? { extraLarge: e.imageUrl, large: e.imageUrl, medium: e.imageUrl }
      : undefined,
    description: e.synopsis,
    genres: e.genres.length > 0 ? e.genres : undefined,
    averageScore: e.score != null ? Math.round(e.score * 10) : null,
    format: e.type?.toUpperCase(),
    status: mapMalStatus(e.status),
    episodes: e.episodes,
    isAdult: rating.includes('Rx') || rating.includes('R+'),
    siteUrl: e.url,
  }
}

export async function malSearchAnime(
  store: MalCacheStore,
  query: string,
  page = 1
): Promise<{ entries: ScrapedSearchEntry[]; cached: boolean; ms: number }> {
  const key = `mal:search:anime:${query.toLowerCase()}:page:${page}`
  const hit = store.get(key)
  if (hit && hit.fresh) {
    return { entries: JSON.parse(hit.payload) as ScrapedSearchEntry[], cached: true, ms: 0 }
  }
  const t0 = Date.now()
  const show = (page - 1) * 50
  const params = new URLSearchParams({ q: query, cat: 'anime' })
  if (show > 0) params.set('show', String(show))
  const { status, html } = await fetchHtml(`https://myanimelist.net/anime.php?${params.toString()}`)
  const ms = Date.now() - t0
  if (status !== 200) {
    if (hit) return { entries: JSON.parse(hit.payload) as ScrapedSearchEntry[], cached: true, ms }
    throw new Error(`MAL search failed with status ${status}`)
  }
  const entries = parseSearchResults(html)
  store.put(key, JSON.stringify(entries), DEFAULT_TTL_SECONDS)
  return { entries, cached: false, ms }
}

export async function malAnimeDetail(
  store: MalCacheStore,
  malId: number
): Promise<{ detail: ScrapedDetail | null; cached: boolean; ms: number }> {
  const key = `mal:detail:anime:${malId}`
  const hit = store.get(key)
  if (hit && hit.fresh) {
    return { detail: JSON.parse(hit.payload) as ScrapedDetail, cached: true, ms: 0 }
  }
  const t0 = Date.now()
  const { status, html } = await fetchHtml(`https://myanimelist.net/anime/${malId}`)
  const ms = Date.now() - t0
  if (status !== 200) {
    if (hit) return { detail: JSON.parse(hit.payload) as ScrapedDetail, cached: true, ms }
    throw new Error(`MAL detail failed with status ${status}`)
  }
  const detail = parseDetail(html, malId)
  if (detail) store.put(key, JSON.stringify(detail), DEFAULT_TTL_SECONDS)
  return { detail, cached: false, ms }
}

const MAL_TYPE_IDS: Record<string, string> = {
  tv: '1',
  ova: '2',
  movie: '3',
  special: '4',
  ona: '5',
  music: '6',
}

const MAL_STATUS_IDS: Record<string, string | undefined> = {
  airing: '1',
  complete: '2',
  finished: '2',
  upcoming: '3',
  hiatus: '3',
  cancelled: undefined,
  not_yet_released: '3',
}

const MAL_RATING_IDS: Record<string, string> = {
  g: '1',
  pg: '2',
  pg13: '3',
  r17: '4',
  r: '5',
  rx: '6',
}

const MAL_ORDER_IDS: Record<string, string> = {
  start_date: '2',
  score: '3',
  episodes: '4',
  end_date: '5',
  type: '6',
  members: '7',
  rating: '8',
  mal_id: '9',
}

const ORDER_BY_MAP: Record<string, string> = {
  POPULARITY_DESC: 'members',
  SCORE_DESC: 'score',
  TRENDING_DESC: 'members',
  START_DATE_DESC: 'start_date',
  END_DATE_DESC: 'end_date',
  EPISODES_DESC: 'episodes',
  FAVOURITES_DESC: 'members',
  UPDATED_AT_DESC: 'start_date',
}

const SEASON_MONTHS: Record<string, number[]> = {
  WINTER: [1, 2, 3],
  SPRING: [4, 5, 6],
  SUMMER: [7, 8, 9],
  FALL: [10, 11, 12],
}

const SEASON_START_MONTH: Record<string, string> = {
  WINTER: '01',
  SPRING: '04',
  SUMMER: '07',
  FALL: '10',
}

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

const SCHEDULE_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const CARD_TYPE_BY_ID: Record<string, string> = {
  '0': 'Unknown',
  '1': 'TV',
  '2': 'OVA',
  '3': 'Movie',
  '4': 'Special',
  '5': 'ONA',
  '9': 'TV Special',
}

async function resolveGenreIds(store: MalCacheStore, genre: string): Promise<string | null> {
  const cached = store.get('taxonomy:anime:genres')
  let map: Record<string, number>
  if (cached && cached.fresh) {
    map = JSON.parse(cached.payload) as Record<string, number>
  } else {
    const { status, html } = await fetchHtml('https://myanimelist.net/anime.php?cat=genre')
    if (status !== 200) {
      if (cached) {
        map = JSON.parse(cached.payload) as Record<string, number>
      } else {
        return null
      }
    } else {
      map = {}
      for (const m of html.matchAll(/\/anime\/genre\/(\d+)\/[^"']*"[^>]*>([^<]+)</gi)) {
        map[decodeHtml(m[2]).trim().toLowerCase()] = Number(m[1])
      }
      store.put('taxonomy:anime:genres', JSON.stringify(map), 24 * 3600)
    }
  }
  const ids: number[] = []
  for (const part of genre.split(',')) {
    const name = part.trim().toLowerCase()
    if (!name) continue
    if (/^\d+$/.test(name)) {
      ids.push(parseInt(name, 10))
      continue
    }
    const id = map[name]
    if (id == null) return null
    ids.push(id)
  }
  return ids.length > 0 ? [...new Set(ids)].join(',') : null
}

interface SeasonalCard {
  malId: number
  title: string
  imageUrl: string | null
  score: number | null
  type: string | null
  episodes: number | null
  startDate: string | null
  members: number | null
  genreIds: number[]
}

function parseSeasonalCard(chunk: string): SeasonalCard | null {
  const link = chunk.match(
    /<a href="https:\/\/myanimelist\.net\/anime\/(\d+)\/[^"]*" class="link-title">([^<]+)<\/a>/i
  )
  if (!link) return null
  const typeId = chunk.slice(0, 200).match(/js-anime-type-(\d+)/)?.[1]
  return {
    malId: Number(link[1]),
    title: decodeHtml(link[2]),
    imageUrl: firstImage(chunk),
    score: numeric(chunk.match(/class="js-score">([\d.]+)<\/span>/i)?.[1] ?? null),
    type: typeId === undefined ? null : (CARD_TYPE_BY_ID[typeId] ?? null),
    episodes: numeric(chunk.match(/<span>(\d+)\s*eps?<\/span>/i)?.[1] ?? null),
    startDate: chunk.match(/class="js-start_date">(\d+)<\/span>/i)?.[1] ?? null,
    members: numeric(chunk.match(/class="js-members">(\d+)<\/span>/i)?.[1] ?? null),
    genreIds: (chunk.match(/data-genre="([\d,]+)"/i)?.[1] ?? '')
      .split(',')
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n) && n > 0),
  }
}

function parseSeasonalCards(html: string): SeasonalCard[] {
  const out = new Map<number, SeasonalCard>()
  for (const chunk of html.split('js-seasonal-anime').slice(1)) {
    const card = parseSeasonalCard(chunk)
    if (card) out.set(card.malId, card)
  }
  return [...out.values()]
}

function startDateParts(value: string | null): { year?: number; month?: number; day?: number } {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})/)
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
  const t = value?.match(/([A-Za-z]+)\s+(\d{4})/)
  if (t) {
    const month = MONTH_INDEX[t[1].toLowerCase()]
    if (month) return { year: Number(t[2]), month }
  }
  return {}
}

function cardToMedia(c: SeasonalCard): AnilistMedia {
  const startDate = startDateParts(c.startDate)
  const cover = c.imageUrl || undefined
  return {
    id: -c.malId,
    idMal: c.malId,
    title: { romaji: c.title, english: c.title, native: c.title },
    coverImage: cover ? { extraLarge: cover, large: cover, medium: cover } : undefined,
    description: null,
    averageScore: c.score != null ? Math.round(c.score * 10) : null,
    format: c.type?.toUpperCase(),
    episodes: c.episodes,
    seasonYear: startDate.year,
    startDate,
    popularity: c.members ?? undefined,
    isAdult: c.genreIds.includes(12),
  }
}

function cachedFetch(
  store: MalCacheStore,
  key: string,
  url: string
): Promise<{ html: string; cached: boolean }> {
  const hit = store.get(key)
  if (hit && hit.fresh) return Promise.resolve({ html: hit.payload, cached: true })
  return fetchHtml(url).then(({ status, html }) => {
    if (status !== 200) {
      if (hit) return { html: hit.payload, cached: true }
      throw new Error(`MAL fetch failed with status ${status} for ${url}`)
    }
    store.put(key, html, DEFAULT_TTL_SECONDS)
    return { html, cached: false }
  })
}

const TITLE_TTL_SECONDS = 7 * 24 * 3600

export async function enrichCardTitles(
  store: MalCacheStore,
  items: AnilistMedia[]
): Promise<AnilistMedia[]> {
  const cached = new Map<number, KitsuTitles>()
  const missing: number[] = []
  for (const m of items) {
    if (!m.idMal) continue
    const hit = store.get(`mal:title:${m.idMal}`)
    if (hit) {
      try {
        cached.set(m.idMal, JSON.parse(hit.payload) as KitsuTitles)
        continue
      } catch {
        // ignore
      }
    }
    missing.push(m.idMal)
  }
  let fetched = new Map<number, KitsuTitles>()
  if (missing.length > 0) {
    try {
      fetched = await kitsuTitlesByMalIds(missing)
    } catch {
      // ignore
    }
    for (const [id, t] of fetched) {
      store.put(`mal:title:${id}`, JSON.stringify(t), TITLE_TTL_SECONDS)
    }
  }
  for (const m of items) {
    if (!m.idMal) continue
    const t = cached.get(m.idMal) ?? fetched.get(m.idMal)
    if (t?.english || t?.native) {
      m.title = {
        romaji: m.title?.romaji,
        english: t.english ?? m.title?.english,
        native: t.native ?? m.title?.native,
      }
    }
  }
  return items
}

export async function malSearchMedia(
  store: MalCacheStore,
  options: AnilistSearchOptions = {},
  enrichTitles = true
): Promise<AnilistMedia[]> {
  const {
    query,
    page = 1,
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

  const params = new URLSearchParams()
  const hasQuery = !!query?.trim()
  if (hasQuery) params.set('q', query!.trim())
  params.set('cat', 'anime')
  if (page > 1) params.set('show', String((page - 1) * 50))
  const clientFormat = isAdult ? format : undefined
  if (format && format !== 'ALL' && format !== 'ADULT' && !isAdult) {
    const typeId = MAL_TYPE_IDS[format.toLowerCase()]
    if (typeId) params.set('type', typeId)
  }
  if (status) {
    const statusId = MAL_STATUS_IDS[status.toLowerCase()]
    if (statusId) params.set('status', statusId)
  }
  if (genre) {
    const ids = await resolveGenreIds(store, genre)
    if (!ids) return []
    for (const id of ids.split(',')) params.append('genre[]', id)
  }
  if (seasonYear) {
    const month =
      season && season !== 'ALL' ? (SEASON_START_MONTH[season.toUpperCase()] ?? '01') : '01'
    params.set('sm', String(Number(month)))
    params.set('sd', '1')
    params.set('sy', String(seasonYear))
  }
  if (averageScore_greater) params.set('score', String(averageScore_greater))
  if (isAdult) {
    params.set('r', '6')
    params.append('genre[]', '12')
  }

  const wantOrder = sort ? ORDER_BY_MAP[sort] || 'members' : undefined
  const wantDir = sort && sort.includes('ASC') ? '2' : '1'
  if (wantOrder) {
    params.set('o', MAL_ORDER_IDS[wantOrder])
    params.set('w', wantDir)
  }

  const url = `https://myanimelist.net/anime.php?${params.toString()}`
  const key = `mal:search:${params.toString()}:page:${page}`
  const parseHtml = (html: string): AnilistMedia[] =>
    parseSearchResults(html).map(toAnilistSearchMedia)
  const finish = (list: AnilistMedia[]): Promise<AnilistMedia[]> =>
    enrichTitles ? enrichCardTitles(store, list) : Promise.resolve(list)
  let serverSorted = false
  let html: string
  try {
    const hit = store.get(key)
    if (hit && hit.fresh) {
      return finish(
        filterMalSearch(parseSearchResults(hit.payload).map(toAnilistSearchMedia), {
          genre_not_in,
          episodes_greater,
          format: clientFormat,
          seasonYear,
          season,
          sort: serverSorted ? undefined : sort,
          hasQuery,
        })
      )
    }
    const res = await fetchHtml(url)
    if (res.status !== 200) {
      if (hit) {
        return finish(
          filterMalSearch(parseSearchResults(hit.payload).map(toAnilistSearchMedia), {
            genre_not_in,
            episodes_greater,
            format: clientFormat,
            seasonYear,
            season: undefined,
            sort: undefined,
            hasQuery,
          })
        )
      }
      throw new Error(`MAL search failed with status ${res.status}`)
    }
    const detailMatch = res.url.match(/myanimelist\.net\/anime\/(\d+)/i)
    if (detailMatch && !res.html.includes('Search Anime - MyAnimeList.net')) {
      const detail = parseDetail(res.html, Number(detailMatch[1]))
      const list = detail ? [toAnilistDetailMedia(detail)] : []
      store.put(key, JSON.stringify(list.map((m) => m.idMal)))
      return list
    }
    serverSorted = !!wantOrder
    store.put(key, res.html, DEFAULT_TTL_SECONDS)
    html = res.html
  } catch {
    const hit = store.get(key)
    if (hit) {
      try {
        const cached = JSON.parse(hit.payload) as unknown
        if (Array.isArray(cached) && cached.every((e) => typeof e === 'number')) {
          return []
        }
      } catch {
        // ignore
      }
      return finish(
        filterMalSearch(parseSearchResults(hit.payload).map(toAnilistSearchMedia), {
          genre_not_in,
          episodes_greater,
          format: clientFormat,
          seasonYear,
          season: undefined,
          sort: undefined,
          hasQuery,
        })
      )
    }
    return []
  }
  return finish(
    filterMalSearch(parseSearchResults(html).map(toAnilistSearchMedia), {
      genre_not_in,
      episodes_greater,
      format: clientFormat,
      seasonYear,
      season,
      sort: serverSorted ? undefined : sort,
      hasQuery,
    })
  )
}

function filterMalSearch(
  results: AnilistMedia[],
  opts: {
    genre_not_in?: string[]
    episodes_greater?: number
    format?: string
    seasonYear?: number
    season?: string
    sort?: string
    hasQuery: boolean
  }
): AnilistMedia[] {
  let out = results
  if (opts.format && opts.format !== 'ALL' && opts.format !== 'ADULT') {
    const f = opts.format.toUpperCase()
    out = out.filter((m) => (m.format ?? '').toUpperCase() === f)
  }
  if (opts.episodes_greater != null) {
    out = out.filter((m) => (m.episodes ?? 0) > (opts.episodes_greater as number))
  }
  if (opts.seasonYear && !opts.hasQuery) {
    out = out.filter((m) => m.startDate?.year === opts.seasonYear)
  }
  if (opts.season && opts.season !== 'ALL' && !opts.hasQuery) {
    const months = SEASON_MONTHS[opts.season.toUpperCase()] ?? []
    out = out.filter((m) => m.startDate?.month != null && months.includes(m.startDate.month))
  }
  if (
    opts.sort &&
    !opts.sort.startsWith('POPULARITY_') &&
    !opts.sort.startsWith('TRENDING_') &&
    !opts.sort.startsWith('FAVOURITES_') &&
    !opts.sort.startsWith('START_DATE_') &&
    !opts.sort.startsWith('END_DATE_')
  ) {
    const desc = !opts.sort.includes('ASC')
    const dir = desc ? -1 : 1
    if (opts.sort.startsWith('SCORE_')) {
      const scoreOf = (m: AnilistMedia): number => m.averageScore ?? m.meanScore ?? -1
      out = [...out].sort((a, b) => (scoreOf(a) - scoreOf(b)) * dir)
    } else if (opts.sort.startsWith('EPISODES_')) {
      out = [...out].sort((a, b) => ((a.episodes ?? -1) - (b.episodes ?? -1)) * dir)
    }
  }
  return out
}

export async function malSearchTitle(store: MalCacheStore, title: string): Promise<string | null> {
  const results = await malSearchMedia(store, { query: title, page: 1, perPage: 5 }, false)
  const first = results[0]
  if (!first?.idMal) return null
  return `mal-${first.idMal}`
}

export async function malTop(
  store: MalCacheStore,
  filter: 'airing' | 'bypopularity' | null,
  page = 1
): Promise<AnilistMedia[]> {
  const limit = (page - 1) * 50
  const params = new URLSearchParams()
  if (filter) params.set('type', filter)
  if (limit > 0) params.set('limit', String(limit))
  const query = params.toString()
  const url = query
    ? `https://myanimelist.net/topanime.php?${query}`
    : 'https://myanimelist.net/topanime.php'
  const key = `mal:top:${filter ?? 'all'}:page:${page}`
  const { html } = await cachedFetch(store, key, url)
  const out: AnilistMedia[] = []
  for (const match of html.matchAll(/<tr class="ranking-list">([\s\S]*?)<\/tr>/gi)) {
    const row = match[1]
    const malId = Number(row.match(/href="https:\/\/myanimelist\.net\/anime\/(\d+)\//i)?.[1])
    if (!malId) continue
    const imgTag = row.match(/<img[^>]*alt="Anime: ([^"]+)"[^>]*>/i)
    const title = imgTag ? decodeHtml(imgTag[1]) : ''
    if (!title) continue
    const info = row.match(/<div class="information[^"]*">([\s\S]*?)<\/div>/i)?.[1] ?? ''
    const segments = info.split(/<br\s*\/?>/i).map((s) => decodeHtml(s))
    const typeEpisodes = segments[0] ?? ''
    const dateText = segments[1] ?? ''
    const membersText = segments[2] ?? ''
    const dateMatch = dateText.match(/([A-Za-z]+)\s+(\d{4})/)
    const month = dateMatch ? MONTH_INDEX[dateMatch[1].toLowerCase()] : undefined
    const score = numeric(
      row.match(/class="text on score-label[^"]*">([\d.]+)<\/span>/i)?.[1] ?? null
    )
    out.push({
      id: -malId,
      idMal: malId,
      title: { romaji: title, english: title, native: title },
      coverImage: undefined,
      description: null,
      averageScore: score != null ? Math.round(score * 10) : null,
      format: typeEpisodes.match(/^(\S+)/)?.[1]?.toUpperCase(),
      episodes: (() => {
        const m = typeEpisodes.match(/\((\d+)/)
        return m ? Number(m[1]) : null
      })(),
      startDate: month != null && dateMatch ? { year: Number(dateMatch[2]), month } : undefined,
      popularity: numeric(membersText.match(/([\d,]+)/)?.[1] ?? null) ?? undefined,
    })
    const img = row.match(/<img[^>]*>/i)?.[0] ?? ''
    const imageUrl = firstImage(img)
    if (imageUrl) {
      const last = out[out.length - 1]
      last.coverImage = { extraLarge: imageUrl, large: imageUrl, medium: imageUrl }
    }
  }
  return enrichCardTitles(store, out)
}

export async function malSeasonal(
  store: MalCacheStore,
  season: string,
  year: number,
  format?: string,
  page = 1,
  size = 14
): Promise<AnilistMedia[]> {
  const key = `mal:season:${year}:${season.toLowerCase()}`
  const { html } = await cachedFetch(
    store,
    key,
    `https://myanimelist.net/anime/season/${year}/${season.toLowerCase()}`
  )
  let all = parseSeasonalCards(html).map(cardToMedia)
  if (format && format !== 'ALL' && format !== 'ADULT') {
    const f = format.toUpperCase()
    all = all.filter((m) => (m.format ?? '').toUpperCase() === f)
  }
  all = [...all].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
  const offset = (page - 1) * size
  return enrichCardTitles(store, all.slice(offset, offset + size))
}

export async function malScheduleWeek(
  store: MalCacheStore
): Promise<Record<string, AnilistMedia[]>> {
  const key = 'mal:schedule:week'
  const { html } = await cachedFetch(store, key, 'https://myanimelist.net/anime/season/schedule')
  const out: Record<string, AnilistMedia[]> = {}
  for (const section of html.split('class="anime-header">').slice(1)) {
    const day = section
      .slice(0, 40)
      .match(/^([A-Za-z]+)</)?.[1]
      ?.toLowerCase()
    if (!day || !SCHEDULE_DAYS.includes(day)) continue
    out[day] = parseSeasonalCards(section).map(cardToMedia)
  }
  return out
}

export async function malLatestReleases(
  store: MalCacheStore,
  format: string = 'TV',
  page = 1,
  size = 12
): Promise<AnilistMedia[]> {
  const week = await malScheduleWeek(store)
  const seen = new Map<number, AnilistMedia>()
  for (const day of SCHEDULE_DAYS) {
    for (const m of week[day] ?? []) {
      if (!seen.has(m.id)) seen.set(m.id, m)
    }
  }
  let all = [...seen.values()]
  if (format && format !== 'ALL') {
    const f = format.toUpperCase()
    all = all.filter((m) => (m.format ?? '').toUpperCase() === f)
  }
  const rank = (m: AnilistMedia): number =>
    (m.startDate?.year ?? 0) * 10000 + (m.startDate?.month ?? 0) * 100 + (m.startDate?.day ?? 0)
  all.sort((a, b) => rank(b) - rank(a) || (b.popularity ?? 0) - (a.popularity ?? 0))
  const offset = (page - 1) * size
  return enrichCardTitles(store, all.slice(offset, offset + size))
}

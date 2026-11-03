import { fetchWithRetry, parseJsonBody } from '../utils/http.utils.js'

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE = 'https://image.tmdb.org/t/p'

const FALLBACK_TMDB_KEY = '9e7096a7575623aa30c66e9cc987e411'

const TMDB_KEYS = [
  'fb7bb23f03b6994dafc674c074d01761',
  'e55425032d3d0f371fc776f302e7c09b',
  '8301a21598f8b45668d5711a814f01f6',
  '8cf43ad9c085135b9479ad5cf6bbcbda',
  'da63548086e399ffc910fbc08526df05',
  '13e53ff644a8bd4ba37b3e1044ad24f3',
  '269890f657dddf4635473cf4cf456576',
  'a2f888b27315e62e471b2d587048f32e',
  '8476a7ab80ad76f0936744df0430e67c',
  '5622cafbfe8f8cfe358a29c53e19bba0',
  'ae4bd1b6fce2a5648671bfc171d15ba4',
  '257654f35e3dff105574f97fb4b97035',
  '2f4038e83265214a0dcd6ec2eb3276f5',
  '9e43f45f94705cc8e1d5a0400d19a7b7',
  'af6887753365e14160254ac7f4345dd2',
  '06f10fc8741a672af455421c239a1ffc',
  '09ad8ace66eec34302943272db0e8d2c',
]

let cachedKey: string | null = null

export { TMDB_BASE, TMDB_IMAGE }

export async function getTmdbKey(): Promise<string> {
  if (!cachedKey) {
    cachedKey =
      process.env.TMDB_API_KEY ||
      TMDB_KEYS[Math.floor(Math.random() * TMDB_KEYS.length)] ||
      FALLBACK_TMDB_KEY
  }
  return cachedKey
}

interface TmdbSearchResult {
  media_type?: string
  id: number
  vote_count: number
  overview?: string
  backdrop_path?: string | null
}

interface TmdbTvDetails {
  backdrop_path: string | null
  overview?: string
}

export async function tmdbSearch(query: string): Promise<TmdbSearchResult[] | null> {
  const key = await getTmdbKey()
  const url = `${TMDB_BASE}/search/multi?api_key=${key}&query=${encodeURIComponent(query)}&include_adult=false`
  const res = await fetchWithRetry(url, {}, { timeoutMs: 10000 })
  if (!res.ok) return null
  const json = await parseJsonBody<{ results?: TmdbSearchResult[] }>(res)
  return json.results ?? null
}

export async function tmdbTvDetails(tmdbId: number): Promise<TmdbTvDetails | null> {
  const key = await getTmdbKey()
  const url = `${TMDB_BASE}/tv/${tmdbId}?api_key=${key}`
  const res = await fetchWithRetry(url, {}, { timeoutMs: 10000 })
  if (!res.ok) return null
  const json = await parseJsonBody<TmdbTvDetails | null>(res)
  return json
}

export interface TmdbArtwork {
  backdrop: string
  overview?: string
}

export interface TmdbSearchItem {
  id: number
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  media_type?: string
  poster_path?: string | null
  vote_average?: number
  adult?: boolean
  overview?: string
  genre_ids?: number[]
  backdrop_path?: string | null
}

export interface TmdbSeason {
  season_number: number
  episode_count: number
}

export interface TmdbEpisode {
  episode_number: number
  name?: string
  vote_average?: number
  overview?: string
  still_path?: string | null
}

export interface TmdbMetaBody {
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  imdb_id?: string | null
  external_ids?: { imdb_id?: string | null }
  number_of_seasons?: number
}

export interface TmdbDetailsBody extends TmdbMetaBody {
  id: number
  vote_average?: number
  overview?: string
  poster_path?: string | null
  backdrop_path?: string | null
  adult?: boolean
  status?: string
  seasons?: TmdbSeason[]
}

export interface TmdbListResponse {
  results?: TmdbSearchItem[]
  total_results?: number
  total_pages?: number
  page?: number
}

async function tmdbGet<T>(url: string, label: string, timeoutMs = 10000): Promise<T> {
  const res = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, { timeoutMs })
  if (!res.ok) throw new Error(label)
  return parseJsonBody<T>(res)
}

export async function tmdbSearchMedia(options: {
  query: string
  page: number
  type: string
  genre?: string
  year?: string
  sortBy?: string
}): Promise<TmdbListResponse> {
  const key = await getTmdbKey()
  if (!key) throw new Error('No TMDB API key available')
  const { query, page, type, genre = '', year = '', sortBy = 'popularity.desc' } = options
  const trimmed = query.trim()
  let url: string
  if (type === 'tv' || type === 'movie') {
    if (!trimmed) {
      const params = new URLSearchParams({
        api_key: key,
        page: String(page),
        sort_by: sortBy,
      })
      if (genre) params.set('with_genres', genre)
      if (year) {
        if (type === 'tv') params.set('first_air_date_year', year)
        else params.set('primary_release_year', year)
      }
      url = `${TMDB_BASE}/discover/${type}?${params.toString()}`
    } else {
      const params = new URLSearchParams({
        api_key: key,
        query: encodeURIComponent(trimmed),
        page: String(page),
        include_adult: 'true',
      })
      url = `${TMDB_BASE}/search/${type}?${params.toString()}`
    }
  } else if (!trimmed) {
    const params = new URLSearchParams({
      api_key: key,
      page: String(page),
      sort_by: sortBy,
    })
    if (genre) params.set('with_genres', genre)
    if (year) params.set('first_air_date_year', year)
    url = `${TMDB_BASE}/discover/tv?${params.toString()}`
  } else {
    const params = new URLSearchParams({
      api_key: key,
      query: encodeURIComponent(trimmed),
      page: String(page),
      include_adult: 'true',
    })
    url = `${TMDB_BASE}/search/multi?${params.toString()}`
  }
  return tmdbGet<TmdbListResponse>(url, 'TMDB search failed')
}

export async function tmdbTrendingMedia(
  mediaType: string,
  timeWindow: string,
  page: number
): Promise<TmdbListResponse> {
  const key = await getTmdbKey()
  if (!key) throw new Error('No TMDB API key available')
  const url = `${TMDB_BASE}/trending/${mediaType}/${timeWindow}?api_key=${key}&page=${page}`
  return tmdbGet<TmdbListResponse>(url, 'TMDB trending failed')
}

export async function tmdbMediaDetails(type: string, id: string): Promise<TmdbDetailsBody> {
  const key = await getTmdbKey()
  if (!key) throw new Error('No TMDB API key available')
  const url = `${TMDB_BASE}/${type}/${id}?api_key=${key}&append_to_response=external_ids`
  return tmdbGet<TmdbDetailsBody>(url, 'TMDB details failed')
}

export async function tmdbSeasonEpisodes(id: string, season: string): Promise<TmdbEpisode[]> {
  const key = await getTmdbKey()
  if (!key) throw new Error('No TMDB API key available')
  const url = `${TMDB_BASE}/tv/${id}/season/${season}?api_key=${key}`
  const d = await tmdbGet<{ episodes?: TmdbEpisode[] }>(url, 'TMDB episodes failed')
  return d.episodes || []
}

export async function tmdbMediaMeta(
  mediaType: 'movie' | 'tv',
  numericTmdbId: number
): Promise<TmdbMetaBody | null> {
  try {
    const key = await getTmdbKey()
    if (!key) return null
    const url = `${TMDB_BASE}/${mediaType}/${numericTmdbId}?api_key=${key}&append_to_response=external_ids`
    return await tmdbGet<TmdbMetaBody>(url, 'TMDB meta failed', 4000)
  } catch {
    // ignore
  }
  return null
}

export async function findTmdbDefaultBackdrop(titleParts: {
  english?: string
  romaji?: string
  native?: string
}): Promise<TmdbArtwork | null> {
  const searchNames = [titleParts.english, titleParts.romaji, titleParts.native].filter(
    Boolean
  ) as string[]

  for (const name of searchNames) {
    const results = await tmdbSearch(name)
    if (!results) continue
    const tvResults = results.filter((r) => r.media_type === 'tv')
    if (tvResults.length === 0) continue

    const bestMatch = tvResults.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))[0]
    const details = await tmdbTvDetails(bestMatch.id)
    if (!details?.backdrop_path) continue

    return {
      backdrop: `${TMDB_IMAGE}/original${details.backdrop_path}`,
      overview: details.overview || bestMatch.overview || undefined,
    }
  }

  return null
}

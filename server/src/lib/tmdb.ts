import freekeys from 'freekeys'

const TMDB_BASE = 'https://api.themoviedb.org/3'
const TMDB_IMAGE = 'https://image.tmdb.org/t/p'

let cachedKey: string | null = null

export { TMDB_BASE, TMDB_IMAGE }

export async function getTmdbKey(): Promise<string> {
  if (cachedKey) return cachedKey
  try {
    const keys = await freekeys.getKeys()
    const tmdbKey = keys.tmdb_key
    if (tmdbKey) cachedKey = tmdbKey
  } catch {
    // silently ignore freekeys failure and use fallback key
  }
  if (!cachedKey) {
    cachedKey = '9e7096a7575623aa30c66e9cc987e411'
  }
  return cachedKey
}

interface TmdbSearchResult {
  media_type?: string
  id: number
  vote_count: number
}

interface TmdbTvDetails {
  backdrop_path: string
}

export async function tmdbSearch(query: string): Promise<TmdbSearchResult[] | null> {
  const key = await getTmdbKey()
  const url = `${TMDB_BASE}/search/multi?api_key=${key}&query=${encodeURIComponent(query)}&include_adult=false`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as { results?: TmdbSearchResult[] }
  return json.results ?? null
}

export async function tmdbTvDetails(tmdbId: number): Promise<TmdbTvDetails | null> {
  const key = await getTmdbKey()
  const url = `${TMDB_BASE}/tv/${tmdbId}?api_key=${key}`
  const res = await fetch(url)
  if (!res.ok) return null
  const json = (await res.json()) as TmdbTvDetails | null
  return json
}

export async function findTmdbDefaultBackdrop(titleParts: {
  english?: string
  romaji?: string
  native?: string
}): Promise<string | null> {
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

    return `${TMDB_IMAGE}/original${details.backdrop_path}`
  }

  return null
}

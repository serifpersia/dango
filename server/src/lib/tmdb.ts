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

export interface TmdbArtwork {
  backdrop: string
  overview?: string
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

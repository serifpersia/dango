import {
  Provider,
  Show,
  VideoSource,
  EpisodeDetails,
  SearchOptions,
  VideoLink,
} from './provider.interface'
import logger from '../logger'
import { buildQueryVariants, pickBestMatch } from './mature-matching'

const BASE_URL = 'https://hentaini.com'
const API_URL = 'https://admin.hentaini.com/api'
const CDN_URL = 'https://admin.hentaini.com/uploads'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: BASE_URL + '/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      headers: {
        'User-Agent': UA,
        Referer: BASE_URL + '/',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function imageUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return `${CDN_URL}/${path}`
}

interface NuxtEntry {
  id?: number
  episode_number?: number
  players?: string
  downloads?: string
  serie?: { url?: string }
}

function parseNuxtData(html: string): NuxtEntry | null {
  const match = html.match(/__NUXT_DATA__">\s*(\[.*?\])\s*<\//s)
  if (!match) return null

  let raw: unknown[]
  try {
    raw = JSON.parse(match[1])
  } catch {
    return null
  }

  if (!Array.isArray(raw)) return null

  const visited = new Set<number>()

  function resolve(v: unknown): unknown {
    if (typeof v === 'number' && v >= 0 && v < raw!.length && Number.isInteger(v)) {
      if (visited.has(v)) return v
      visited.add(v)
      const result = resolve(raw![v])
      visited.delete(v)
      return result
    }
    if (Array.isArray(v)) {
      const wrapper = v[0]
      if (
        typeof wrapper === 'string' &&
        (wrapper === 'ShallowReactive' || wrapper === 'ShallowRef' || wrapper === 'EmptyRef')
      ) {
        return resolve(v[1])
      }
      return v.map(resolve)
    }
    if (v && typeof v === 'object') {
      const obj: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        obj[k] = resolve(val)
      }
      return obj
    }
    return v
  }

  const resolved = resolve(raw) as Record<string, unknown> | unknown[]

  const extractEpisode = (obj: unknown): NuxtEntry | null => {
    if (!obj || typeof obj !== 'object') return null
    const root = obj as Record<string, unknown>

    const entries = Array.isArray(root.data)
      ? root.data
      : root.data && typeof root.data === 'object'
        ? (root.data as Record<string, unknown>).data
        : null

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (entry && typeof entry === 'object') {
          const e = entry as Record<string, unknown>
          if (typeof e.id === 'number' && typeof e.episode_number === 'number') {
            return e as unknown as NuxtEntry
          }
        }
      }
    }

    for (const val of Object.values(root)) {
      const result = extractEpisode(val)
      if (result) return result
    }

    return null
  }

  return extractEpisode(resolved)
}

export class HnProvider implements Provider {
  name = 'HN'

  private bestMatch(
    results: { title: string; slug: string; poster: string }[],
    query: string
  ): { title: string; slug: string; poster: string; score: number } | null {
    if (!results.length) return null

    const q = query.toLowerCase().trim()
    let best = results[0]
    let bestScore = -1

    for (const item of results) {
      const title = item.title.toLowerCase()
      let score = 0
      if (title === q) score = 3
      else if (title.startsWith(q)) score = 2
      else if (title.includes(q)) score = 1
      if (score > bestScore) {
        bestScore = score
        best = item
        if (score === 3) break
      }
    }
    return { ...best, score: bestScore }
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []

      const res = await fetchApi<{
        data: {
          id: number
          title: string
          title_english: string
          url: string
          visits: number
          images?: { path: string; image_type?: { name: string } }[]
        }[]
      }>(`/series?filters[title][$containsi]=${encodeURIComponent(query)}&pagination[limit]=10`)

      const apiResults = (res?.data || []).map((item) => ({
        title: item.title,
        slug: item.url,
        poster: imageUrl(item.images?.find((i) => i.image_type?.name === 'cover')?.path || ''),
        score: 0,
      }))

      if (apiResults.length === 0) return []

      const matched = this.bestMatch(apiResults, query) || apiResults[0]

      return [
        {
          _id: matched.slug,
          id: matched.slug,
          name: matched.title,
          englishName: matched.title,
          thumbnail: matched.poster,
          type: 'TV',
          year: null,
          availableEpisodesDetail: { sub: [], dub: [] },
        },
      ]
    } catch (error) {
      logger.error({ error }, '[HN] Search failed')
      return []
    }
  }

  async resolveShowId(title: string, romaji?: string): Promise<string | null> {
    const query = (romaji || title).trim()
    if (!query) return null

    const targets = [title, romaji].filter((t): t is string => !!t)
    for (const variant of buildQueryVariants(title, romaji)) {
      const res = await fetchApi<{
        data: { id: number; title: string; title_english: string; url: string }[]
      }>(`/series?filters[title][$containsi]=${encodeURIComponent(variant)}&pagination[limit]=10`)

      const items = (res?.data || []).map((item) => ({
        title: item.title || item.title_english,
        slug: item.url,
        poster: '',
      }))

      if (items.length === 0) continue

      const matchResult = pickBestMatch(items, targets)
      if (matchResult) {
        return matchResult.item.slug
      }
    }
    return null
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      if (!showId) return null

      const html = await fetchText(`${BASE_URL}/h/${showId}`)
      const episodeRe = new RegExp(`/h/${showId}/(\\d+)`, 'g')
      const numbers = new Set<string>()
      let m: RegExpExecArray | null
      while ((m = episodeRe.exec(html)) !== null) {
        numbers.add(m[1])
      }

      const episodes = [...numbers].sort((a, b) => Number(a) - Number(b))
      return { episodes, description: '' }
    } catch (error) {
      logger.error({ error, showId }, '[HN] getEpisodes failed')
      return null
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    _mode: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      const episodeUrl = `${BASE_URL}/h/${showId}/${episodeNumber}`
      const html = await fetchText(episodeUrl)

      const m3u8Match = html.match(/https?:\/\/[^"' ]+\.m3u8[^"' ]*/i)
      if (!m3u8Match) return null

      const streamUrl = m3u8Match[0]

      const links: VideoLink[] = [
        {
          resolutionStr: 'Auto',
          link: streamUrl,
          hls: true,
          headers: {
            Referer: BASE_URL + '/',
            Origin: BASE_URL,
            'User-Agent': UA,
          },
        },
      ]

      const result: VideoSource[] = [
        {
          sourceName: 'HN (Direct)',
          links,
          type: 'player',
          actualEpisodeNumber: episodeNumber,
        },
      ]

      const nuxtEntry = parseNuxtData(html)
      if (nuxtEntry && nuxtEntry.players) {
        try {
          const players = JSON.parse(nuxtEntry.players)
          if (Array.isArray(players)) {
            for (const p of players) {
              if (p.name === 'HLS' || !p.url) continue
              result.push({
                sourceName: `HN (${p.name})`,
                links: [{ resolutionStr: 'Auto', link: p.url, hls: false }],
                type: 'iframe',
                actualEpisodeNumber: episodeNumber,
              })
            }
          }
        } catch {
          // fall through
        }
      }

      return result
    } catch (error) {
      logger.error({ error, showId, episodeNumber }, '[HN] getStreamUrls failed')
      return null
    }
  }
}

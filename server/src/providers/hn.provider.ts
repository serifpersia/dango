import {
  Provider,
  Show,
  VideoSource,
  EpisodeDetails,
  SearchOptions,
  VideoLink,
} from './provider.interface'
import logger from '../logger'
import NodeCache from 'node-cache'
import { buildQueryVariants, pickBestMatch } from './title-matching'

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

interface HnImage {
  path: string
  image_type?: { name: string }
}

interface HnSeriesItem {
  id: number
  title: string
  title_english: string
  url: string
  visits: number
  images?: HnImage[]
}

function pickPoster(images?: HnImage[]): string {
  if (!images || images.length === 0) return ''
  const named = (n: string) =>
    images.find((i) => (i.image_type?.name || '').toLowerCase() === n)?.path || ''
  return imageUrl(
    named('cover') ||
      named('poster') ||
      named('thumbnail') ||
      named('backdrop') ||
      images[0].path ||
      ''
  )
}

function extractSeriesCover(html: string): string {
  const imgs = html.match(/<img[^>]+>/g) || []
  for (const img of imgs) {
    if (/aspect-\[2\/3\]/.test(img)) {
      const src = img.match(/src="([^"]+)"/)?.[1] || ''
      if (src.startsWith('http')) return src
    }
  }
  const cover = html.match(/https?:\/\/[^"'\s]*uploads\/[^"'\s]*cover[^"'\s]*/i)?.[0]
  if (cover) return cover
  const anyUpload = html.match(/https?:\/\/[^"'\s]*uploads\/[^"'\s]*\.(?:jpe?g|png|webp)/i)?.[0]
  return anyUpload || ''
}

interface HnGenre {
  slug: string
  name: string
}

interface HnLandingSeries {
  url: string
  title: string
  titleEnglish: string
  visits: number
  poster: string
  genres: HnGenre[]
}

function resolveNuxtRefs(raw: unknown[]): unknown {
  const visited = new Set<number>()
  function resolve(v: unknown): unknown {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < raw.length) {
      if (visited.has(v)) return v
      visited.add(v)
      const result = resolve(raw[v])
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
  return resolve(raw)
}

function collectLandingSeries(resolved: unknown): HnLandingSeries[] {
  const out: HnLandingSeries[] = []
  const seen = new Set<string>()
  const walk = (o: unknown, depth: number): void => {
    if (depth > 12 || !o || typeof o !== 'object') return
    if (Array.isArray(o)) {
      for (const x of o) walk(x, depth + 1)
      return
    }
    const r = o as Record<string, unknown>
    if (typeof r.url === 'string' && typeof r.title === 'string' && Array.isArray(r.images)) {
      const url = r.url
      if (url && !seen.has(url)) {
        seen.add(url)
        const images = r.images as HnImage[]
        const genreList = (Array.isArray(r.genreList) ? r.genreList : []) as {
          url?: string
          name?: string
        }[]
        out.push({
          url,
          title: r.title,
          titleEnglish: typeof r.title_english === 'string' ? r.title_english : r.title,
          visits: Number(r.visits) || 0,
          poster: pickPoster(images),
          genres: genreList
            .filter((g) => g && (g.url || g.name))
            .map((g) => ({ slug: String(g.url || ''), name: String(g.name || g.url || '') })),
        })
      }
      return
    }
    for (const val of Object.values(r)) walk(val, depth + 1)
  }
  walk(resolved, 0)
  return out
}

export class HnProvider implements Provider {
  name = 'HN'

  private posterCache: Map<string, string> = new Map()
  private landingCache = new NodeCache({ stdTTL: 1800 })

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

  private async resolvePoster(slug: string, apiPoster: string): Promise<string> {
    if (apiPoster) return apiPoster
    const cached = this.posterCache.get(slug)
    if (cached !== undefined) return cached
    try {
      const html = await fetchText(`${BASE_URL}/h/${slug}`)
      const poster = extractSeriesCover(html)
      this.posterCache.set(slug, poster)
      return poster
    } catch {
      this.posterCache.set(slug, '')
      return ''
    }
  }

  async browse(options: {
    query?: string
    page?: number
    pageSize?: number
    sort?: string
    genre?: string
  }): Promise<{ shows: Show[]; hasMore: boolean; genres: HnGenre[] }> {
    try {
      const query = (options.query || '').trim()
      const genre = (options.genre || '').trim().toLowerCase()
      const sort = options.sort || ''

      if (!query) {
        const cacheKey = 'hn_landing'
        let landing = this.landingCache.get<HnLandingSeries[]>(cacheKey)
        if (!landing) {
          const html = await fetchText(`${BASE_URL}/`)
          const match = html.match(/__NUXT_DATA__">\s*(\[.*?\])\s*<\//s)
          if (!match) return { shows: [], hasMore: false, genres: [] }
          const raw = JSON.parse(match[1]) as unknown[]
          landing = collectLandingSeries(resolveNuxtRefs(raw))
          this.landingCache.set(cacheKey, landing, 1800)
        }
        const genreSet = new Map<string, string>()
        for (const s of landing) {
          for (const g of s.genres) {
            if (g.slug && !genreSet.has(g.slug)) genreSet.set(g.slug, g.name)
          }
        }
        const genres = Array.from(genreSet.entries()).map(([slug, name]) => ({ slug, name }))
        let filtered = landing
        if (genre) {
          filtered = landing.filter((s) => s.genres.some((g) => g.slug.toLowerCase() === genre))
        }
        if (sort === 'visits:desc') {
          filtered = [...filtered].sort((a, b) => b.visits - a.visits)
        } else if (sort === 'title:asc') {
          filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title))
        }
        const shows: Show[] = await Promise.all(
          filtered.map(async (s) => ({
            _id: s.url,
            id: s.url,
            name: s.title,
            englishName: s.titleEnglish,
            thumbnail: await this.resolvePoster(s.url, s.poster),
            type: 'TV',
            year: null,
            isAdult: true,
            availableEpisodesDetail: { sub: [], dub: [] },
          }))
        )
        return { shows, hasMore: false, genres }
      }

      const page = Math.max(1, options.page || 1)
      const pageSize = Math.min(20, Math.max(1, options.pageSize || 14))

      const params = new URLSearchParams()
      params.set('filters[title][$containsi]', query)
      params.set('pagination[page]', String(page))
      params.set('pagination[pageSize]', String(pageSize))
      if (sort) params.set('sort', sort)

      const fetchBrowse = () =>
        fetchApi<{
          data: HnSeriesItem[]
          meta?: { pagination?: { page?: number; pageCount?: number; total?: number } }
        }>(`/series?${params.toString()}`)

      let res = await fetchBrowse()
      if (!res?.data && sort) {
        params.delete('sort')
        res = await fetchApi(`/series?${params.toString()}`)
      }

      const items = res?.data || []
      const shows: Show[] = await Promise.all(
        items.map(async (item) => ({
          _id: item.url,
          id: item.url,
          name: item.title,
          englishName: item.title_english || item.title,
          thumbnail: await this.resolvePoster(item.url, pickPoster(item.images)),
          type: 'TV',
          year: null,
          isAdult: true,
          availableEpisodesDetail: { sub: [], dub: [] },
        }))
      )

      const pageCount = res?.meta?.pagination?.pageCount
      const hasMore = typeof pageCount === 'number' ? page < pageCount : shows.length >= pageSize
      return { shows, hasMore, genres: [] }
    } catch (error) {
      logger.error({ error }, '[HN] Browse failed')
      return { shows: [], hasMore: false, genres: [] }
    }
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []

      const res = await fetchApi<{
        data: HnSeriesItem[]
      }>(`/series?filters[title][$containsi]=${encodeURIComponent(query)}&pagination[limit]=10`)

      const apiResults = (res?.data || []).map((item) => ({
        title: item.title,
        slug: item.url,
        poster: pickPoster(item.images),
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
          thumbnail: await this.resolvePoster(matched.slug, matched.poster),
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

      let streamUrl = m3u8Match[0].replace(/\\+$/g, '').trim()
      streamUrl = streamUrl.replace(/\\"/g, '"').replace(/"$/g, '').replace(/\\\//g, '/')

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

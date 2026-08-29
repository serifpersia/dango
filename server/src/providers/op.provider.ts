import NodeCache from 'node-cache'
import { Provider, Show, VideoSource, EpisodeDetails, SearchOptions } from './provider.interface'
import logger from '../logger'

const BASE_URL = 'https://oppai.stream'
const SEARCH_URL = `${BASE_URL}/actions/search.php`
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: `${BASE_URL}/`,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  })
  const text = await res.text()
  const isRedirect =
    res.status === 301 || res.status === 302 || res.status === 307 || res.status === 308
  if (!res.ok && !isRedirect) throw new Error(`HTTP ${res.status}: ${url}`)
  return text
}

interface SearchEntry {
  id: string
  idgt: string
  folder: string
  ep: string
  name: string
  desc: string
  watchUrl: string
}

function parseSearchResults(html: string): SearchEntry[] {
  const entries: SearchEntry[] = []
  const re =
    /<div\s+class='in-grid episode-shown'\s+id='([^']+)'[^>]*idgt='([^']+)'[^>]*folder='([^']+)'[^>]*ep='([^']+)'[^>]*name='([^']+)'[^>]*desc='([^']*)'[^>]*>[\s\S]*?<a\s+href='(https?:\/\/oppai\.stream\/watch\?e=[^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    entries.push({
      id: m[1],
      idgt: m[2],
      folder: m[3],
      ep: m[4],
      name: m[5],
      desc: m[6],
      watchUrl: m[7],
    })
  }
  return entries
}

function folderToTitleSlug(folder: string): string {
  return folder
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function titleSlugToFolder(slug: string): string {
  return slug.replace(/-/g, ' ')
}

function buildSeriesMap(entries: SearchEntry[]): Map<string, SearchEntry[]> {
  const map = new Map<string, SearchEntry[]>()
  for (const e of entries) {
    const key = e.folder.toLowerCase()
    const existing = map.get(key) || []
    existing.push(e)
    map.set(key, existing)
  }
  return map
}

function bestMatch(
  series: { title: string; key: string }[],
  query: string
): { title: string; key: string; score: number } | null {
  if (!series.length) return null
  const q = query.toLowerCase().trim()
  let best = series[0]
  let bestScore = -1

  for (const item of series) {
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

export class OpProvider implements Provider {
  name = 'OP'

  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []

      const cacheKey = `op_search_${query}`
      const cached = this.cache.get<Show[]>(cacheKey)
      if (cached) return cached

      const url = `${SEARCH_URL}?text=${encodeURIComponent(query)}&order=recent&page=1&limit=23&genres=&blacklist=&studio=&ibt=0&swa=1`
      const html = await fetchText(url)
      const entries = parseSearchResults(html)
      if (entries.length === 0) return []

      const seriesMap = buildSeriesMap(entries)
      const uniqueSeries = Array.from(seriesMap.entries()).map(([key, eps]) => ({
        title: eps[0].name,
        key,
      }))

      const match = bestMatch(uniqueSeries, query) || uniqueSeries[0]
      const episodes = seriesMap.get(match.key) || []
      const first = episodes[0]

      const sortedEps = episodes
        .sort((a, b) => parseFloat(a.ep) - parseFloat(b.ep))
        .map((e) => e.ep)

      const thumbnailUrl = `https://myspacecat.pictures/${encodeURIComponent(first.folder)}/thumbnail_${first.ep}.png`

      const result: Show[] = [
        {
          _id: match.key,
          id: match.key,
          name: first.name,
          englishName: first.name,
          thumbnail: thumbnailUrl,
          type: 'TV',
          year: null,
          availableEpisodesDetail: {
            sub: sortedEps,
            dub: [],
          },
        },
      ]

      this.cache.set(cacheKey, result, 300)
      return result
    } catch (error) {
      logger.error({ error }, '[OP] Search failed')
      return []
    }
  }

  async resolveShowId(title: string, romaji?: string): Promise<string | null> {
    const query = (romaji || title).trim()
    if (!query) return null

    const words = query.split(/\s+/).filter(Boolean)
    const variants = [
      query,
      query
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      words.slice(0, 3).join(' '),
      words.slice(0, 2).join(' '),
      words[0] || '',
    ].filter(Boolean)

    for (const variant of variants) {
      const url = `${SEARCH_URL}?text=${encodeURIComponent(variant)}&order=recent&page=1&limit=23&genres=&blacklist=&studio=&ibt=0&swa=1`
      const html = await fetchText(url)
      const entries = parseSearchResults(html)
      if (entries.length === 0) continue

      const seriesMap = buildSeriesMap(entries)
      const uniqueSeries = Array.from(seriesMap.entries()).map(([key, eps]) => ({
        title: eps[0].name,
        key,
      }))

      const match = bestMatch(uniqueSeries, variant)
      if (match && match.score >= 1) {
        return match.key
      }
    }

    return null
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      if (!showId) return null

      const cacheKey = `op_eps_${showId}`
      const cached = this.cache.get<EpisodeDetails>(cacheKey)
      if (cached) return cached

      const folder = titleSlugToFolder(showId)
      const url = `${SEARCH_URL}?text=${encodeURIComponent(folder)}&order=recent&page=1&limit=50&genres=&blacklist=&studio=&ibt=0&swa=1`
      const html = await fetchText(url)
      const entries = parseSearchResults(html)

      const episodes = entries
        .filter((e) => e.folder.toLowerCase() === folder.toLowerCase())
        .sort((a, b) => parseFloat(a.ep) - parseFloat(b.ep))
        .map((e) => e.ep)

      if (episodes.length === 0) return null

      const desc = entries.find((e) => e.folder.toLowerCase() === folder.toLowerCase())?.desc || ''
      const result: EpisodeDetails = { episodes, description: desc }
      this.cache.set(cacheKey, result, 300)
      return result
    } catch (error) {
      logger.error({ error, showId }, '[OP] getEpisodes failed')
      return null
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    _mode: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      const cacheKey = `op_stream_${showId}_${episodeNumber}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const folder = titleSlugToFolder(showId)
      const url = `${BASE_URL}/watch?e=${encodeURIComponent(folderToTitleSlug(folder))}-${episodeNumber}`
      const html = await fetchText(url)

      // Parse availableres JS object: {"1080":"https://...webm","4k":"https://...webm","720":"https://...mp4"}
      const availResMatch = html.match(/var\s+availableres\s*=\s*(\{[^;]+\})/)
      const links: { resolutionStr: string; link: string; hls: boolean }[] = []

      if (availResMatch) {
        try {
          const raw = availResMatch[1].replace(/\\\//g, '/')
          const availRes: Record<string, string> = JSON.parse(raw)
          const qualityMap: Record<string, string> = {
            '720': '720p',
            '1080': '1080p',
            '4k': '4K',
          }
          for (const [key, videoUrl] of Object.entries(availRes)) {
            if (!videoUrl || !key) continue
            const label = qualityMap[key] || key
            links.push({ resolutionStr: label, link: videoUrl, hls: false })
          }
          const resOrder: Record<string, number> = { '720p': 1, '1080p': 2, '4K': 3 }
          links.sort(
            (a, b) => (resOrder[a.resolutionStr] || 99) - (resOrder[b.resolutionStr] || 99)
          )
        } catch {
          // fall through to fallback
        }
      }

      // Fallback: try <source> tags
      if (links.length === 0) {
        const sourceRe = /src="(https?:\/\/[^"]+\.(mp4|webm)[^"]*)"/gi
        let sourceMatch: RegExpExecArray | null
        while ((sourceMatch = sourceRe.exec(html)) !== null) {
          const ext = sourceMatch[2].toLowerCase()
          links.push({
            resolutionStr: ext === 'mp4' ? '720p' : '1080p',
            link: sourceMatch[1],
            hls: false,
          })
        }
      }

      if (links.length === 0) return null

      const subtitles: { language: string; label: string; url: string }[] = []
      const subRe = /src='(https?:\/\/[^']+\.vtt[^']*)'[^>]*kind='subtitles'[^>]*srclang='([^']+)'/g
      let subMatch: RegExpExecArray | null
      while ((subMatch = subRe.exec(html)) !== null) {
        subtitles.push({
          language: subMatch[2],
          label: subMatch[2].toUpperCase(),
          url: subMatch[1],
        })
      }

      const result: VideoSource[] = [
        {
          sourceName: 'OP (Direct)',
          links,
          subtitles: subtitles.length > 0 ? subtitles : undefined,
          type: 'player',
          actualEpisodeNumber: episodeNumber,
        },
      ]

      this.cache.set(cacheKey, result, 3600)
      return result
    } catch (error) {
      logger.error({ error, showId, episodeNumber }, '[OP] getStreamUrls failed')
      return null
    }
  }
}

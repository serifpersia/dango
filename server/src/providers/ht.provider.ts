import NodeCache from 'node-cache'
import { Provider, Show, VideoSource, EpisodeDetails, SearchOptions } from './provider.interface'
import logger from '../logger'
import { buildQueryVariants, pickBestMatch } from './title-matching'

const BASE_URL = 'https://hentai.tv'
const API_URL = 'https://hentai.tv/api/search'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

interface HtVideo {
  id: string
  slug: string
  title: string
  titleSlug: string
  titleId: string
  ep: number
  views: number
  likes: number
  dislikes: number
  rating: number
  censored: boolean
  brand: string
  quality: string
  year: number
  language: string
  duration: string
  tags: string[]
  cover: string
  thumb: string
  backdrop: string | null
  featureImage: string
  embedUrl: string | null
  description: string
  grad: string[]
  releasedAt: string
}

function imageUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith('http')) return path
  return `${BASE_URL}${path}`
}

async function searchApi(query: string, limit = 40): Promise<HtVideo[]> {
  const url = `${API_URL}?q=${encodeURIComponent(query)}&limit=${limit}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: `${BASE_URL}/`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) return []
  const data = await res.json()
  return data?.videos || []
}

function groupBySeries(videos: HtVideo[]): Map<string, HtVideo[]> {
  const map = new Map<string, HtVideo[]>()
  for (const v of videos) {
    const existing = map.get(v.titleSlug) || []
    existing.push(v)
    map.set(v.titleSlug, existing)
  }
  return map
}

function bestMatch(
  series: { title: string; titleSlug: string }[],
  query: string
): { title: string; titleSlug: string; score: number } | null {
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

export class HtProvider implements Provider {
  name = 'HT'

  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []

      const cacheKey = `ht_search_${query}`
      const cached = this.cache.get<Show[]>(cacheKey)
      if (cached) return cached

      const videos = await searchApi(query, 40)
      if (videos.length === 0) return []

      const seriesMap = groupBySeries(videos)
      const uniqueSeries = Array.from(seriesMap.entries()).map(([slug, eps]) => ({
        title: eps[0].title,
        titleSlug: slug,
      }))

      const match = bestMatch(uniqueSeries, query) || uniqueSeries[0]
      const episodes = seriesMap.get(match.titleSlug) || []
      const first = episodes[0]

      const result: Show[] = [
        {
          _id: match.titleSlug,
          id: match.titleSlug,
          name: first.title,
          englishName: first.title,
          thumbnail: imageUrl(first.cover || first.thumb),
          type: 'TV',
          year: first.year || null,
          availableEpisodesDetail: {
            sub: episodes.map((e) => String(e.ep)),
            dub: [],
          },
        },
      ]

      this.cache.set(cacheKey, result, 300)
      return result
    } catch (error) {
      logger.error({ error }, '[HT] Search failed')
      return []
    }
  }

  async resolveShowId(title: string, romaji?: string): Promise<string | null> {
    const query = (romaji || title).trim()
    if (!query) return null

    const targets = [title, romaji].filter((t): t is string => !!t)
    for (const variant of buildQueryVariants(title, romaji)) {
      const videos = await searchApi(variant, 20)
      if (videos.length === 0) continue

      const seriesMap = groupBySeries(videos)
      const uniqueSeries = Array.from(seriesMap.entries()).map(([slug, eps]) => ({
        title: eps[0].title,
        titleSlug: slug,
      }))

      const match = pickBestMatch(uniqueSeries, targets)
      if (match) {
        return match.item.titleSlug
      }
    }

    return null
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      if (!showId) return null

      const cacheKey = `ht_eps_${showId}`
      const cached = this.cache.get<EpisodeDetails>(cacheKey)
      if (cached) return cached

      const videos = await searchApi(showId, 40)
      const episodes = videos
        .filter((v) => v.titleSlug === showId)
        .sort((a, b) => a.ep - b.ep)
        .map((v) => String(v.ep))

      if (episodes.length === 0) {
        const fallback = videos
          .filter((v) => v.title.toLowerCase().includes(showId.replace(/-/g, ' ').toLowerCase()))
          .sort((a, b) => a.ep - b.ep)
          .map((v) => String(v.ep))

        if (fallback.length > 0) {
          const desc = videos[0]?.description || ''
          const result: EpisodeDetails = { episodes: fallback, description: desc }
          this.cache.set(cacheKey, result, 300)
          return result
        }

        return null
      }

      const desc = videos.find((v) => v.titleSlug === showId)?.description || ''
      const result: EpisodeDetails = { episodes, description: desc }
      this.cache.set(cacheKey, result, 300)
      return result
    } catch (error) {
      logger.error({ error, showId }, '[HT] getEpisodes failed')
      return null
    }
  }

  private async getEmbedUrl(showId: string, episodeNumber: string): Promise<string | null> {
    const cacheKey = `ht_ep_${showId}_${episodeNumber}`
    const cached = this.cache.get<string>(cacheKey)
    if (cached) return cached

    const videos = await searchApi(showId, 40)
    const match = videos.find(
      (v) => v.titleSlug === showId && String(v.ep) === String(episodeNumber)
    )

    if (match?.embedUrl) {
      this.cache.set(cacheKey, match.embedUrl, 3600)
      return match.embedUrl
    }

    const fuzzy = videos.find(
      (v) => v.titleSlug === showId && Math.abs(v.ep - parseFloat(episodeNumber)) < 0.01
    )
    if (fuzzy?.embedUrl) {
      this.cache.set(cacheKey, fuzzy.embedUrl, 3600)
      return fuzzy.embedUrl
    }

    return null
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    _mode: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      let targetEpisode = episodeNumber
      if (episodeNumber === '0') targetEpisode = '1'

      const embedUrl = await this.getEmbedUrl(showId, targetEpisode)
      if (!embedUrl) {
        logger.warn({ showId, episodeNumber }, '[HT] Could not resolve embed URL')
        return null
      }

      const cacheKey = `ht_stream_${showId}_${targetEpisode}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const result: VideoSource[] = [
        {
          sourceName: 'HT',
          links: [{ resolutionStr: 'Auto', link: embedUrl, hls: false }],
          type: 'iframe',
          actualEpisodeNumber: targetEpisode,
        },
      ]

      this.cache.set(cacheKey, result, 3600)
      return result
    } catch (error) {
      logger.error({ error, showId, episodeNumber }, '[HT] getStreamUrls failed')
      return null
    }
  }
}

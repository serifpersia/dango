import NodeCache from 'node-cache'
import { Provider, Show, VideoSource, EpisodeDetails, SearchOptions } from './provider.interface'
import logger from '../logger'
import { buildQueryVariants, pickBestMatch } from './title-matching'

interface ApiAnime {
  id?: string
  title: string
  japanese_title?: string
  thumbnail?: string
  image?: string
  poster?: string
  type?: string
  episode?: number | string
}

interface ApiStreamData {
  success: boolean
  data?: {
    streaming_link?: string
    stream?: string
    url?: string
  }
  error?: string
}

const BASE_URL = 'https://shirayuki-scrapper-api.onrender.com'

export class _123AnimeProvider implements Provider {
  name = '123Anime'

  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  private normalizeSlugForSearch(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/['"]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  /**
   * Picks the best-matching show from a list of search results by comparing
   * how closely each result's title / id matches the query.
   * Scoring (highest wins):
   *   3 – id/slug exact match
   *   2 – title exact match (case-insensitive)
   *   1 – title starts with query
   *   0 – title contains query word (partial)
   *  -1 – no match (but still returned as last resort)
   */
  private bestMatch(results: Show[], query: string): Show {
    const q = query.toLowerCase().trim()
    const qSlug = this.normalizeSlugForSearch(q)

    let best = results[0]
    let bestScore = -1

    for (const s of results) {
      const id = (s.id || s._id || '').toLowerCase()
      const title = (s.name || '').toLowerCase()
      let score = -1

      if (id === qSlug || id === q) {
        score = 3
      } else if (title === q) {
        score = 2
      } else if (title.startsWith(q)) {
        score = 1
      } else if (title.includes(q) || id.startsWith(qSlug)) {
        score = 0
      }

      if (score > bestScore) {
        bestScore = score
        best = s
        if (score === 3) break // can't do better
      }
    }

    return best
  }

  private extractSlugFromUrl(url?: string): string | null {
    if (!url) return null
    try {
      const parts = url.split('/')
      const lastPart = parts[parts.length - 1]
      if (lastPart) {
        return lastPart.replace(/\.(jpg|jpeg|png|webp|gif)$/i, '')
      }
    } catch (e) {
      // ignore
    }
    return null
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const rawQuery = options.query || ''
      const query = rawQuery
        .replace(/["",':]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      const performSearch = async (q: string): Promise<ApiAnime[]> => {
        const url = `${BASE_URL}/search?keyword=${encodeURIComponent(q)}`
        const response = await fetch(url)
        if (!response.ok) return []
        const data = (await response.json()) as { success: boolean; data?: ApiAnime[] }
        if (!data.success || !data.data) return []

        return data.data.filter((anime) => anime.title !== 'Dogge')
      }

      let results = await performSearch(query)

      if (results.length === 0) {
        const words = query.split(/\s+/).filter((w) => w.length >= 3)
        if (words.length > 1) {
          const mid = Math.max(1, Math.floor(words.length / 2))
          const half = words.slice(0, mid).join(' ')
          results = await performSearch(half)
        }
        if (results.length === 0 && words.length > 2) {
          const firstThree = words.slice(0, 3).join(' ')
          results = await performSearch(firstThree)
        }
      }

      const mapped = results.map((anime: ApiAnime) => {
        const imageUrl = anime.thumbnail || anime.image || anime.poster
        const slugFromUrl = this.extractSlugFromUrl(imageUrl)
        const titleForSlug = anime.japanese_title || anime.title
        const id = anime.id || slugFromUrl || this.normalizeSlugForSearch(titleForSlug)

        return {
          _id: id,
          id: id,
          name: anime.title,
          englishName: anime.title,
          thumbnail: imageUrl,
          type: anime.type,
          availableEpisodesDetail: {
            sub: Array.from({ length: Number(anime.episode) || 0 }, (_, i) => (i + 1).toString()),
            dub: [],
          },
        }
      })

      return mapped
    } catch (error) {
      logger.error({ err: error }, '123Anime search failed')
      return []
    }
  }

  async resolveShowId(
    title: string,
    romaji?: string,
    mode?: 'sub' | 'dub'
  ): Promise<string | null> {
    const targets = [title, romaji].filter((t): t is string => !!t && t.trim().length > 0)
    if (targets.length === 0) return null

    for (const variant of buildQueryVariants(title, romaji)) {
      const results = await this.search({ query: variant })
      if (results.length === 0) continue

      const candidates = results.map((r) => ({
        title: r.name || r.englishName || '',
        id: r._id ?? r.id ?? '',
        type: (r.type || '').toLowerCase(),
      }))

      let pool = candidates
      if (mode) {
        const modeMatched = candidates.filter((c) => c.type === mode)
        if (modeMatched.length > 0) {
          pool = modeMatched
        }
      }

      const matchResult = pickBestMatch(
        pool.map((c) => ({ title: c.title, id: c.id })),
        targets
      )
      if (matchResult) {
        return matchResult.item.id
      }
    }

    return null
  }

  async getEpisodes(showId: string, mode?: 'sub' | 'dub'): Promise<EpisodeDetails | null> {
    try {
      const cacheKey = `123anime_eps_${showId}_${mode || 'any'}`
      const cached = this.cache.get<EpisodeDetails>(cacheKey)
      if (cached) {
        return cached
      }

      const results = await this.search({ query: showId.replace(/ /g, '-') })

      const show =
        results.find((s) => s.id === showId || s._id === showId) ||
        (results.length > 0 ? this.bestMatch(results, showId) : undefined)

      if (!show || !show.availableEpisodesDetail) {
        logger.warn(
          { showId, mode, matchedShow: show },
          '123Anime getEpisodes no show or episodes detail found'
        )
        return null
      }

      const episodes =
        mode === 'dub'
          ? show.availableEpisodesDetail.dub || []
          : show.availableEpisodesDetail.sub || []

      const result: EpisodeDetails = {
        episodes,
        description: '',
      }

      this.cache.set(cacheKey, result, 3600)
      return result
    } catch (error) {
      logger.error({ err: error, showId, mode }, '123Anime getEpisodes failed')
      return null
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode?: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      const query = showId.replace(/ /g, '-')
      const searchResults = await this.search({ query })

      if (!searchResults || searchResults.length === 0) {
        return null
      }

      const exactMatch = searchResults.find((s) => s.id === showId || s._id === showId) || undefined

      const modeMatch = mode
        ? searchResults.find((s) => (s.id || s._id) === showId && s.type === mode) ||
          searchResults.find((s) => s.type === mode) ||
          undefined
        : undefined

      const match = modeMatch || exactMatch || this.bestMatch(searchResults, showId)
      const animeId = match.id || match._id

      const url = `${BASE_URL}/episode-stream?id=${animeId}&ep=${episodeNumber}`

      const response = await fetch(url)

      if (!response.ok) {
        logger.warn({ url, status: response.status }, '123Anime stream request failed')
        return null
      }

      const data = (await response.json()) as ApiStreamData

      if (!data.success || !data.data) {
        return null
      }

      const streamingLink = data.data['streaming_link'] || data.data['stream'] || data.data['url']
      if (!streamingLink) {
        logger.warn({ data }, '123Anime No streaming link found in response data')
        return null
      }

      const separator = streamingLink.includes('?') ? '&' : '?'
      const finalUrl = `${streamingLink}${separator}autoplay=1`

      return [
        {
          sourceName: '123Anime',
          links: [
            {
              resolutionStr: 'auto',
              link: finalUrl,
              hls: false,
            },
          ],
          type: 'iframe',
        },
      ]
    } catch (error) {
      logger.error({ err: error, showId, episodeNumber, mode }, '123Anime getStreamUrls failed')
      return null
    }
  }
}

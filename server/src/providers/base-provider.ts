import NodeCache from 'node-cache'
import { Provider, Show, VideoSource, EpisodeDetails, SearchOptions } from './provider.interface'
import { buildQueryVariants, pickBestMatch } from './title-matching'
import logger from '../logger'

/**
 * Shared base for every scraping provider.
 *
 * Provides:
 *   - `NodeCache` lifecycle
 *   - Shared `resolveShowId` implementation (buildQueryVariants → search → pickBestMatch)
 *
 * Subclasses implement `name`, `search`, `getEpisodes`, `getStreamUrls`,
 * and any other provider-specific methods.
 */
export abstract class BaseProvider implements Provider {
  abstract name: string

  protected cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  abstract search(options: SearchOptions): Promise<Show[]>

  abstract getEpisodes(
    showId: string,
    mode?: 'sub' | 'dub',
    ua?: string,
    cookie?: string
  ): Promise<EpisodeDetails | null>

  abstract getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode?: 'sub' | 'dub'
  ): Promise<VideoSource[] | null>

  async resolveShowId(title: string, romaji?: string): Promise<string | null> {
    const targets = [title, romaji].filter((t): t is string => !!t && t.trim().length > 0)
    if (targets.length === 0) return null

    for (const variant of buildQueryVariants(title, romaji)) {
      let results: Show[]
      try {
        results = await this.search({ query: variant })
      } catch {
        continue
      }
      if (results.length === 0) continue

      const candidates = results.map((r) => ({
        title: r.name || r.englishName || '',
        id: r.id || r._id || '',
      }))

      const matchResult = pickBestMatch(candidates, targets)
      if (matchResult) return matchResult.item.id
    }

    return null
  }
}

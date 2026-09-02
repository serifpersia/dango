import NodeCache from 'node-cache'
import { gotScraping } from 'got-scraping'
import { Provider, Show, VideoSource, EpisodeDetails, SearchOptions } from './provider.interface'
import logger from '../logger'
import { buildQueryVariants, pickBestMatch } from './title-matching'

const BASE = 'https://anidb.app'
const REFERRER = 'https://anidb.app/'
const PROVIDER = 'anidb'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

interface AnidbSearchEntry {
  id: string
  slug: string
  title: string
  thumbnail: string
}

interface AnidbEpisode {
  id: number
  number: number
}

interface AnidbLanguage {
  code: string
  name: string
  embed_url: string
}

const ENTITY_MAP: Record<string, string> = {
  '&#039;': "'",
  '&amp;': '&',
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
}

function decodeEntities(value: string): string {
  return value.replace(/&#039;|&amp;|&quot;|&lt;|&gt;/g, (m) => ENTITY_MAP[m] ?? m)
}

async function gotGet(
  url: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; body: string } | null> {
  try {
    const resp = await gotScraping({
      url,
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        ...extraHeaders,
      },
      responseType: 'text',
      timeout: { request: 30000 },
      followRedirect: true,
      throwHttpErrors: false,
    })
    return { status: resp.statusCode, body: resp.body }
  } catch (error) {
    logger.warn({ error }, '[AniDB] request failed')
    return null
  }
}

async function searchBrowse(query: string): Promise<AnidbSearchEntry[]> {
  const resp = await gotGet(`${BASE}/browse?q=${encodeURIComponent(query)}`)
  if (!resp || resp.status !== 200 || resp.body.includes('Just a moment')) return []

  const entries: AnidbSearchEntry[] = []
  const regex =
    /<a href="[^"]*?anime\/([a-z0-9-]+)-([0-9]+)"[^>]*>[\s\S]*?<img src="([^"]*)" alt="([^"]*)"/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(resp.body)) !== null) {
    entries.push({
      slug: match[1],
      id: match[2],
      thumbnail: match[3],
      title: decodeEntities(match[4]),
    })
  }
  return entries
}

function parseShowId(id: string): { animeId: number | null; slug: string | null } {
  if (id.startsWith('ad:')) {
    const rest = id.slice(3)
    const colonIdx = rest.indexOf(':')
    if (colonIdx > 0) {
      const animeId = Number(rest.slice(0, colonIdx))
      return {
        animeId: Number.isFinite(animeId) && animeId > 0 ? animeId : null,
        slug: rest.slice(colonIdx + 1) || null,
      }
    }
    const animeId = Number(rest)
    if (Number.isFinite(animeId) && animeId > 0) {
      return { animeId, slug: null }
    }
  }
  if (id && id.length > 3) {
    return { animeId: null, slug: id }
  }
  return { animeId: null, slug: null }
}

function buildShowId(entry: AnidbSearchEntry): string {
  return `ad:${entry.id}:${entry.slug}`
}

function baseSlug(slug: string): string {
  return slug
    .replace(/-season-\d+$/, '')
    .replace(/-part-\d+$/, '')
    .replace(/-cour-\d+$/, '')
}

function mapSearchEntry(entry: AnidbSearchEntry): Show {
  const showId = buildShowId(entry)
  return {
    _id: showId,
    id: showId,
    name: entry.title,
    englishName: entry.title,
    thumbnail: entry.thumbnail || undefined,
    type: 'TV',
    availableEpisodesDetail: { sub: [], dub: [] },
  }
}

export class AnidbProvider implements Provider {
  name = 'anidb'

  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  private getEpisodesCacheKey(animeId: number): string {
    return `anidb_episodes_${animeId}`
  }

  private async fetchEpisodes(animeId: number): Promise<AnidbEpisode[] | null> {
    const cacheKey = this.getEpisodesCacheKey(animeId)
    const cached = this.cache.get<AnidbEpisode[]>(cacheKey)
    if (cached) return cached

    const resp = await gotGet(`${BASE}/api/frontend/anime/${animeId}/episodes`, {
      Accept: 'application/json',
    })
    if (!resp || resp.status !== 200 || resp.body.includes('Just a moment')) return null

    try {
      const parsed = JSON.parse(resp.body) as { episodes?: AnidbEpisode[] }
      const episodes = (parsed.episodes || []).filter(
        (e) => e && typeof e.number === 'number' && typeof e.id === 'number'
      )
      if (episodes.length) {
        this.cache.set(cacheKey, episodes, 300)
      }
      return episodes
    } catch {
      return null
    }
  }

  // AniDB continues episode numbering across seasons (Slime S1 = 1-24, S4 = 73-88),
  // while the player numbers episodes relative to the AniList entry (1..N).
  // 1. direct hit on the requested number
  // 2. otherwise offset the request by the entry's first episode number
  private resolveEpisode(episodes: AnidbEpisode[], requested: number): AnidbEpisode | null {
    const direct = episodes.find((e) => e.number === requested)
    if (direct) return direct

    const sorted = [...episodes].sort((a, b) => a.number - b.number)
    const first = sorted[0]?.number ?? 0
    const absolute = first + (requested - 1)
    if (absolute !== requested) {
      const viaOffset = episodes.find((e) => e.number === absolute)
      if (viaOffset) return viaOffset
    }
    return null
  }

  // Fallback for combined AniList shows (e.g. One Piece): the requested absolute
  // number lives in a sibling season entry. Re-search by the base slug and look
  // for an entry whose episode list contains the requested number.
  private async findSiblingEpisode(
    slug: string,
    animeId: number,
    requested: number
  ): Promise<AnidbEpisode | null> {
    const base = baseSlug(slug)
    if (!base) return null

    const entries = await searchBrowse(base)
    for (const entry of entries) {
      const entryId = Number(entry.id)
      if (!Number.isFinite(entryId) || entryId === animeId) continue
      if (!entry.slug.startsWith(base)) continue

      const episodes = await this.fetchEpisodes(entryId)
      if (!episodes) continue
      const match = episodes.find((e) => e.number === requested)
      if (match) return match
    }
    return null
  }

  private parseMasterPlaylist(
    content: string,
    baseUrl: string
  ): { resolutionStr: string; link: string; hls: boolean }[] {
    const links: { resolutionStr: string; link: string; hls: boolean }[] = []
    const lines = content.split('\n')
    const base = new URL(baseUrl)

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line.startsWith('#EXT-X-STREAM-INF')) continue
      const resMatch = line.match(/RESOLUTION=\d+x(\d+)/)
      const nextLine = (lines[i + 1] || '').trim()
      if (!nextLine || nextLine.startsWith('#')) continue

      const variantUrl = new URL(nextLine, base).href
      const resLabel = resMatch ? `${resMatch[1]}p` : 'HD'
      links.push({
        resolutionStr: resLabel,
        link: `/api/proxy?url=${encodeURIComponent(variantUrl)}&referer=${encodeURIComponent(REFERRER)}`,
        hls: true,
      })
    }

    return links.sort((a, b) => parseInt(a.resolutionStr, 10) - parseInt(b.resolutionStr, 10))
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []

      const entries = await searchBrowse(query)
      if (!entries.length) return []

      const seen = new Set<string>()
      const results: Show[] = []
      for (const entry of entries) {
        if (seen.has(entry.id)) continue
        seen.add(entry.id)
        results.push(mapSearchEntry(entry))
      }
      return results
    } catch (error) {
      logger.error({ error }, '[AniDB] Search failed')
      return []
    }
  }

  async resolveShowId(title: string, romaji?: string): Promise<string | null> {
    const targets = [title, romaji].filter((t): t is string => !!t && t.trim().length > 0)
    if (targets.length === 0) return null

    for (const variant of buildQueryVariants(title, romaji)) {
      const entries = await searchBrowse(variant)
      if (!entries.length) continue

      const candidates = entries.map((entry) => ({
        title: entry.title,
        id: buildShowId(entry),
      }))

      const matchResult = pickBestMatch(candidates, targets)
      if (matchResult) {
        return matchResult.item.id
      }
    }

    return null
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      const { animeId } = parseShowId(showId)
      if (!animeId) return null

      const episodes = await this.fetchEpisodes(animeId)
      if (!episodes) return { episodes: [], description: '' }

      // anidb numbers episodes across the whole franchise (Slime S4 = 73-88),
      // but the player expects numbering relative to this entry (1..N), which
      // getStreamUrls maps back via resolveEpisode's first-number offset.
      const sorted = [...episodes].sort((a, b) => a.number - b.number)
      const first = sorted[0]?.number ?? 0
      const numbers = sorted.map((e) => String(e.number - first + 1))
      return { episodes: numbers, description: '' }
    } catch (error) {
      logger.error({ error, showId }, '[AniDB] getEpisodes failed')
      return null
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      const { animeId, slug } = parseShowId(showId)
      if (!animeId || !slug) return null

      const requested = Number(episodeNumber)
      if (!Number.isFinite(requested)) return null

      const episodes = await this.fetchEpisodes(animeId)
      if (!episodes) return null

      let episode = this.resolveEpisode(episodes, requested)
      if (!episode) {
        episode = await this.findSiblingEpisode(slug, animeId, requested)
      }
      if (!episode) return null

      const langCode = mode === 'dub' ? 'eng' : 'jpn'
      const resp = await gotGet(`${BASE}/api/frontend/episode/${episode.id}/languages`, {
        Accept: 'application/json',
      })
      if (!resp || resp.status !== 200 || resp.body.includes('Just a moment')) return null

      let parsed: { languages?: AnidbLanguage[] } | null = null
      try {
        parsed = JSON.parse(resp.body) as { languages?: AnidbLanguage[] }
      } catch {
        return null
      }
      const embedUrl = (parsed?.languages || []).find((l) => l.code === langCode)?.embed_url
      if (!embedUrl) return null

      const embed = await gotGet(embedUrl.replace(/\\\//g, '/'), { Referer: REFERRER })
      if (!embed || embed.status !== 200) return null

      const m3u8Match = embed.body.match(/file: '([^']*)'/)
      if (!m3u8Match?.[1]) return null
      const masterUrl = m3u8Match[1]

      const master = await gotGet(masterUrl, { Referer: REFERRER })
      if (!master || master.status !== 200 || !master.body.includes('#EXT-X-STREAM-INF')) {
        return null
      }

      const links = this.parseMasterPlaylist(master.body, masterUrl)
      if (!links.length) return null

      return [
        {
          sourceName: PROVIDER,
          links,
          type: 'player',
          actualEpisodeNumber: String(requested),
        },
      ]
    } catch (error) {
      logger.error({ error, showId, episodeNumber }, '[AniDB] getStreamUrls failed')
      return null
    }
  }
}

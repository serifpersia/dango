import NodeCache from 'node-cache'
import {
  Provider,
  Show,
  VideoSource,
  VideoLink,
  EpisodeDetails,
  SearchOptions,
} from './provider.interface'
import logger from '../logger'
import { anilistRequest } from '../lib/anilist'

interface AniListTitle {
  romaji?: string
  english?: string
  native?: string
}

interface AniListMedia {
  id: number
  title?: AniListTitle
  coverImage?: { large?: string }
  format?: string
  seasonYear?: number | null
  episodes?: number | null
  description?: string | null
  status?: string
  genres?: string[]
  averageScore?: number | null
}

interface GgEpisode {
  number: number
  title: string
  epSlug: string
  hasSub: boolean
  hasDub: boolean
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export class AnimeGgProvider implements Provider {
  name = 'AnimeGG'
  private base = 'https://www.animegg.org'
  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  private stripHtml(input?: string | null): string {
    if (!input) return ''
    return input
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .trim()
  }

  private stripTags(input?: string | null): string {
    return this.stripHtml(input)
  }

  private attr(tag: string, name: string): string {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return tag.match(new RegExp(`\\b${escaped}=["']([^"']*)["']`, 'i'))?.[1] ?? ''
  }

  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private scoreCandidate(slug: string, text: string, query: string): number {
    const q = this.normalizeTitle(query)
    const t = this.normalizeTitle(text)
    const s = this.normalizeTitle(slug.replace(/-/g, ' '))
    if (!q) return -1
    let score = -1
    for (const cand of [t, s]) {
      if (!cand) continue
      if (cand === q) score = Math.max(score, 3)
      else if (cand.startsWith(q) || q.startsWith(cand)) score = Math.max(score, 2)
      else if (cand.includes(q) || q.includes(cand)) score = Math.max(score, 1)
    }
    return score
  }

  private toShow(media: AniListMedia): Show {
    const id = media.id.toString()
    const title = media.title
    const name = title?.romaji || title?.english || title?.native || 'Unknown'
    return {
      _id: id,
      id,
      name,
      englishName: title?.english,
      nativeName: title?.native,
      names: { romaji: title?.romaji, english: title?.english, native: title?.native },
      thumbnail: media.coverImage?.large,
      type: media.format,
      year: media.seasonYear ?? null,
      episodeCount: media.episodes ?? null,
      description: this.stripHtml(media.description),
      status: media.status,
      genres: media.genres?.map((g) => ({ name: g })),
      score: media.averageScore ?? null,
    }
  }

  private mediaFields = `
    id
    title { romaji english native }
    coverImage { large }
    format
    seasonYear
    episodes
    description
    status
    genres
    averageScore
  `

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').replace(/\s+/g, ' ').trim()
      if (!query) return []
      const gql = `query ($q: String, $page: Int, $perPage: Int) {
        Page (page: $page, perPage: $perPage) {
          media (search: $q, type: ANIME) {
            ${this.mediaFields}
          }
        }
      }`
      const data = await anilistRequest<{ Page: { media: AniListMedia[] } }>(gql, {
        q: query,
        page: 1,
        perPage: 20,
      })
      return (data?.data?.Page?.media ?? []).map((m) => this.toShow(m))
    } catch (error) {
      logger.error({ error }, 'AnimeGG search failed')
      return []
    }
  }

  private async fetchHtml(url: string, referer?: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,*/*',
          Referer: referer || `${this.base}/`,
        },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) return null
      return await res.text()
    } catch {
      return null
    }
  }

  private async searchSlugs(query: string): Promise<{ slug: string; text: string }[]> {
    const cacheKey = `animegg_search_${this.normalizeTitle(query)}`
    const cached = this.cache.get<{ slug: string; text: string }[]>(cacheKey)
    if (cached) return cached
    const html = await this.fetchHtml(`${this.base}/search/?q=${encodeURIComponent(query)}`)
    const results: { slug: string; text: string }[] = []
    if (html) {
      for (const m of html.matchAll(
        /<a\b[^>]*class=["'][^"']*\bmse\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi
      )) {
        const tag = m[0].match(/<a\b[^>]*>/i)?.[0] ?? ''
        const href = this.attr(tag, 'href')
        const slug = href.match(/^\/series\/([^/?#]+)/)?.[1]
        if (!slug) continue
        const strong = m[0].match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1]
        results.push({ slug, text: strong ? this.stripTags(strong) : slug.replace(/-/g, ' ') })
      }
    }
    this.cache.set(cacheKey, results, 86400)
    return results
  }

  async resolveShowId(title: string): Promise<string | null> {
    try {
      const candidates = await this.searchSlugs(title)
      if (candidates.length === 0) return null
      let best = candidates[0]
      let bestScore = -1
      for (const c of candidates) {
        const score = this.scoreCandidate(c.slug, c.text, title)
        if (score > bestScore) {
          bestScore = score
          best = c
        }
      }
      return bestScore >= 0 ? best.slug : null
    } catch {
      return null
    }
  }

  private async scrapeSeries(slug: string): Promise<GgEpisode[]> {
    const cacheKey = `animegg_series_${slug}`
    const cached = this.cache.get<GgEpisode[]>(cacheKey)
    if (cached) return cached
    const html = await this.fetchHtml(`${this.base}/series/${slug}`)
    const episodes: GgEpisode[] = []
    if (html) {
      for (const m of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const block = m[1]
        if (!/\banm_det_pop\b/.test(block)) continue
        const link = block.match(/<a\b[^>]*class=["'][^"']*anm_det_pop[^"']*["'][^>]*>/i)?.[0] ?? ''
        const href = this.attr(link, 'href').replace(/#.*$/, '').replace(/^\//, '')
        const strong = this.stripTags(block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '')
        const numMatch = strong.match(/(\d+)-(\d+)\s*$/) || strong.match(/(\d+)\s*$/)
        if (!numMatch || !href) continue
        const number = parseInt(numMatch[1], 10)
        const title =
          this.stripTags(
            block.match(/<i\b[^>]*class=["'][^"']*anititle[^"']*["'][^>]*>([\s\S]*?)<\/i>/i)?.[1] ??
              ''
          ) || strong
        episodes.push({
          number,
          title,
          epSlug: href,
          hasSub: /\bbtn-subbed\b/.test(block),
          hasDub: /\bbtn-dubbed\b/.test(block),
        })
      }
    }
    episodes.sort((a, b) => a.number - b.number)
    const seen = new Set<number>()
    const unique = episodes.filter((e) => (seen.has(e.number) ? false : (seen.add(e.number), true)))
    this.cache.set(cacheKey, unique, 3600)
    return unique
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      if (!showId || /^\d+$/.test(showId)) return null
      const episodes = await this.scrapeSeries(showId)
      if (episodes.length === 0) return null
      return { episodes: episodes.map((e) => String(e.number)), description: '' }
    } catch (error) {
      logger.error({ error, showId }, 'AnimeGG getEpisodes failed')
      return null
    }
  }

  private async scrapeEmbed(embedId: string): Promise<{ quality: string; url: string }[]> {
    const html = await this.fetchHtml(`${this.base}/embed/${embedId}`, this.base)
    if (!html) return []
    const m = html.match(/var\s+videoSources\s*=\s*(\[[\s\S]*?\]);/)
    if (!m) return []
    try {
      const asJson = m[1]
        .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
        .replace(/:\s*'([^']*)'/g, ': "$1"')
      const parsed = JSON.parse(asJson) as { label?: string; file?: string }[]
      return parsed
        .filter((s) => s.file)
        .map((s) => ({
          quality: s.label || 'unknown',
          url: (s.file as string).startsWith('http') ? (s.file as string) : `${this.base}${s.file}`,
        }))
    } catch {
      return []
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode: 'sub' | 'dub' = 'sub'
  ): Promise<VideoSource[] | null> {
    if (!showId || /^\d+$/.test(showId)) return null
    const targetEpisode = episodeNumber === '0' ? '1' : episodeNumber
    try {
      const cacheKey = `animegg_stream_${showId}_${targetEpisode}_${mode}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const episodes = await this.scrapeSeries(showId)
      const ep = episodes.find((e) => e.number === Number(targetEpisode))
      if (!ep || (mode === 'sub' ? !ep.hasSub : !ep.hasDub)) return null

      const html = await this.fetchHtml(`${this.base}/${ep.epSlug}`, this.base)
      if (!html) return null
      const tabs: { embedId: string; server: string; normalized: string }[] = []
      for (const m of html.matchAll(/<a\b[^>]*data-toggle=["']tab["'][^>]*>/gi)) {
        const tag = m[0]
        const embedId = this.attr(tag, 'data-id')
        if (!embedId) continue
        const server = this.attr(tag, 'data-mirror') || 'AnimeGG'
        const version = this.attr(tag, 'data-version') || 'subbed'
        const normalized = version.startsWith('dub') ? 'dub' : 'sub'
        if (normalized === mode) tabs.push({ embedId, server, normalized })
      }
      if (tabs.length === 0) return null

      const links: VideoLink[] = []
      const iframeLinks: VideoLink[] = []
      for (const tab of tabs) {
        const embedUrl = `${this.base}/embed/${tab.embedId}`
        const sources = await this.scrapeEmbed(tab.embedId)
        if (sources.length === 0) {
          iframeLinks.push({
            link: embedUrl,
            resolutionStr: 'Auto',
            hls: false,
            headers: { Referer: `${this.base}/` },
          })
          continue
        }
        for (const s of sources) {
          links.push({
            resolutionStr: s.quality,
            link: s.url,
            hls: s.url.includes('.m3u8'),
            headers: { Referer: `${this.base}/`, 'User-Agent': UA },
          })
        }
        iframeLinks.push({
          link: embedUrl,
          resolutionStr: 'Auto',
          hls: false,
          headers: { Referer: `${this.base}/` },
        })
      }

      const sources: VideoSource[] = []
      if (links.length > 0) {
        sources.push({
          sourceName: `AnimeGG (${mode.toUpperCase()})`,
          links,
          subtitles: [],
          type: 'player',
          actualEpisodeNumber: targetEpisode,
        })
      }
      if (iframeLinks.length > 0) {
        sources.push({
          sourceName: `AnimeGG (${mode.toUpperCase()}) [Fallback]`,
          links: iframeLinks,
          subtitles: [],
          type: 'iframe',
          actualEpisodeNumber: targetEpisode,
        })
      }
      if (sources.length === 0) return null
      this.cache.set(cacheKey, sources, 600)
      return sources
    } catch (error) {
      logger.error({ error, showId, episodeNumber, mode }, '[AnimeGG] getStreamUrls failed')
      return null
    }
  }
}

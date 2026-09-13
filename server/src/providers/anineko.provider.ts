import NodeCache from 'node-cache'
import { gotScraping } from 'got-scraping'
import {
  Provider,
  Show,
  VideoSource,
  VideoLink,
  SubtitleTrack,
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

interface NekoEpisode {
  number: number
  title: string
  epSlug: string
  hasSub: boolean
  hasDub: boolean
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

export class AniNekoProvider implements Provider {
  name = 'AniNeko'
  private base = 'https://anineko.to'
  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  private stripHtml(input?: string | null): string {
    if (!input) return ''
    return decodeEntities(
      input
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .trim()
    )
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
      logger.error({ error }, 'AniNeko search failed')
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
    const cacheKey = `anineko_search_${this.normalizeTitle(query)}`
    const cached = this.cache.get<{ slug: string; text: string }[]>(cacheKey)
    if (cached) return cached
    const html = await this.fetchHtml(`${this.base}/browser?keyword=${encodeURIComponent(query)}`)
    const results: { slug: string; text: string }[] = []
    if (html) {
      for (const m of html.matchAll(
        /<a\b[^>]*class=["'][^"']*nv-anime-thumb[^"']*["'][^>]*>[\s\S]*?<\/a>/gi
      )) {
        const tag = m[0].match(/<a\b[^>]*>/i)?.[0] ?? ''
        const slug = this.attr(tag, 'href').match(/\/watch\/([^/?#]+)/)?.[1]
        if (!slug) continue
        const titleMatch = m[0].match(
          /<(?:h3|[^>]+class=["'][^"']*nv-anime-title[^"']*["'][^>]*)>([\s\S]*?)<\/(?:h3|[^>]+)>/i
        )
        results.push({
          slug,
          text: titleMatch ? this.stripHtml(titleMatch[1]) : slug.replace(/-/g, ' '),
        })
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

  private async scrapeSeries(slug: string): Promise<NekoEpisode[]> {
    const cacheKey = `anineko_series_${slug}`
    const cached = this.cache.get<NekoEpisode[]>(cacheKey)
    if (cached) return cached
    const html = await this.fetchHtml(`${this.base}/watch/${slug}`)
    const episodes: NekoEpisode[] = []
    if (html) {
      for (const m of html.matchAll(
        /<article\b[^>]*class=["'][^"']*nv-info-episode-item[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi
      )) {
        const block = m[1]
        const link =
          block.match(/<a\b[^>]*class=["'][^"']*nv-info-episode-main[^"']*["'][^>]*>/i)?.[0] ?? ''
        const href = this.attr(link, 'href')
        const num = Number(href.match(/\/ep-(\d+)/)?.[1])
        if (!Number.isFinite(num)) continue
        const title =
          this.stripHtml(
            block.match(
              /<a\b[^>]*class=["'][^"']*nv-info-episode-main[^"']*["'][^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i
            )?.[1] ?? ''
          ) || `Episode ${num}`
        const badges = [...block.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map((b) =>
          this.stripHtml(b[1]).toLowerCase()
        )
        episodes.push({
          number: num,
          title,
          epSlug: `ep-${num}`,
          hasSub: badges.includes('sub'),
          hasDub: badges.includes('dub'),
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
      logger.error({ error, showId }, 'AniNeko getEpisodes failed')
      return null
    }
  }

  private extractHls(embedHtml: string): string | null {
    const patterns = [
      /const\s+src\s*=\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /file\s*:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
      /["'](https?:\/\/[^"']+\/master\.m3u8[^"']*)["']/i,
      /["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/i,
    ]
    for (const pattern of patterns) {
      const m = embedHtml.match(pattern)
      if (m) return decodeEntities(m[1])
    }
    return null
  }

  private extractSubtitles(embedUrl: string, server: string): SubtitleTrack[] {
    const tracks: SubtitleTrack[] = []
    try {
      const parsed = new URL(embedUrl)
      const seen = new Set<string>()
      const add = (url: string | null, label: string) => {
        if (!url || seen.has(url)) return
        seen.add(url)
        tracks.push({ language: label, label, url })
      }
      add(parsed.searchParams.get('sub'), server || 'Subtitles')
      let i = 1
      while (parsed.searchParams.has(`caption_${i}`)) {
        add(parsed.searchParams.get(`caption_${i}`), `${server || 'Subtitles'} ${i}`)
        i++
      }
    } catch {
      // ignore
    }
    return tracks
  }

  private async isPlaylistReachable(url: string, referer: string): Promise<boolean> {
    try {
      const res = await gotScraping({
        url,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
          Referer: referer,
        },
        responseType: 'text',
        timeout: { request: 15000 },
        followRedirect: true,
        throwHttpErrors: false,
      })
      if (res.statusCode !== 200 || !String(res.body ?? '').includes('#EXTM3U')) return false
      return await this.isFirstSegmentReachable(String(res.body), res.url || url, referer)
    } catch {
      return false
    }
  }

  private firstMediaUri(playlist: string, base: string, variantsOnly: boolean): string | null {
    const lines = playlist.split('\n').map((l) => l.trim())
    let wantUri = !variantsOnly
    for (const line of lines) {
      if (!line) continue
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        wantUri = true
        continue
      }
      if (line.startsWith('#')) continue
      if (wantUri) {
        try {
          return new URL(line, base).href
        } catch {
          return null
        }
      }
    }
    return null
  }

  private async isFirstSegmentReachable(
    masterBody: string,
    masterUrl: string,
    referer: string
  ): Promise<boolean> {
    try {
      const variantUrl = this.firstMediaUri(masterBody, masterUrl, true)
      if (!variantUrl) {
        const segmentUrl = this.firstMediaUri(masterBody, masterUrl, false)
        if (!segmentUrl) return false
        return await this.fetchSegmentHead(segmentUrl, referer)
      }
      const variantRes = await gotScraping({
        url: variantUrl,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
          Referer: referer,
        },
        responseType: 'text',
        timeout: { request: 15000 },
        followRedirect: true,
        throwHttpErrors: false,
      })
      if (variantRes.statusCode !== 200 || !String(variantRes.body ?? '').includes('#EXTINF')) {
        return false
      }
      const segmentUrl = this.firstMediaUri(
        String(variantRes.body),
        variantRes.url || variantUrl,
        false
      )
      if (!segmentUrl) return false
      return await this.fetchSegmentHead(segmentUrl, referer)
    } catch {
      return false
    }
  }

  private async fetchSegmentHead(url: string, referer: string): Promise<boolean> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
          Referer: referer,
          Range: 'bytes=0-1023',
        },
        signal: AbortSignal.timeout(15000),
      })
      if (res.status !== 200 && res.status !== 206) return false
      const buf = await res.arrayBuffer().catch(() => null)
      return !!buf && buf.byteLength > 0
    } catch {
      return false
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
      const cacheKey = `anineko_stream_${showId}_${targetEpisode}_${mode}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const episodes = await this.scrapeSeries(showId)
      const hasEp = episodes.some((e) => e.number === Number(targetEpisode))
      if (!hasEp) return null

      const html = await this.fetchHtml(
        `${this.base}/watch/${showId}/ep-${targetEpisode}`,
        `${this.base}/watch/${showId}`
      )
      if (!html) return null
      const embeds: { url: string; audio: string }[] = []
      for (const panel of html.matchAll(
        /<div\b[^>]*class=["'][^"']*nv-server-grid[^"']*["'][^>]*data-id=["']([^"']+)["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["'][^"']*nv-server-grid|$)/gi
      )) {
        const panelAudio = panel[1].toLowerCase().includes('dub') ? 'dub' : 'sub'
        if (panelAudio !== mode) continue
        for (const btn of panel[2].matchAll(/data-video=["']([^"']+)["']/gi)) {
          embeds.push({ url: decodeEntities(btn[1]), audio: panelAudio })
        }
      }
      if (embeds.length === 0) return null

      const candidates: { hls: string; origin: string }[] = []
      const subtitles: SubtitleTrack[] = []
      const iframeLinks: VideoLink[] = []
      for (const embed of embeds) {
        let origin = `${this.base}/`
        try {
          origin = `${new URL(embed.url).origin}/`
        } catch {
          // ignore
        }
        const embedHtml = await this.fetchHtml(embed.url, `${this.base}/`)
        const hls = embedHtml ? this.extractHls(embedHtml) : null
        const subs = this.extractSubtitles(embed.url, 'AniNeko')
        for (const s of subs) {
          if (!subtitles.some((t) => t.url === s.url)) subtitles.push(s)
        }
        if (hls) {
          candidates.push({ hls, origin })
        } else {
          iframeLinks.push({
            link: embed.url,
            resolutionStr: 'Auto',
            hls: false,
            headers: { Referer: origin },
          })
        }
      }

      const seenMasters = new Set<string>()
      const uniqueCandidates = candidates.filter((c) =>
        seenMasters.has(c.hls) ? false : (seenMasters.add(c.hls), true)
      )
      const verified = await Promise.all(
        uniqueCandidates.map(async (c) =>
          (await this.isPlaylistReachable(c.hls, c.origin)) ? c : null
        )
      )
      const links: VideoLink[] = []
      for (const c of verified) {
        if (!c) continue
        links.push({
          resolutionStr: 'Auto',
          link: c.hls,
          hls: true,
          headers: { Referer: c.origin, 'User-Agent': UA },
        })
      }

      const sources: VideoSource[] = []
      if (links.length > 0) {
        sources.push({
          sourceName: `AniNeko (${mode.toUpperCase()})`,
          links,
          subtitles,
          type: 'player',
          actualEpisodeNumber: targetEpisode,
        })
      }
      if (iframeLinks.length > 0) {
        sources.push({
          sourceName: `AniNeko (${mode.toUpperCase()}) [Fallback]`,
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
      logger.error({ error, showId, episodeNumber, mode }, '[AniNeko] getStreamUrls failed')
      return null
    }
  }
}

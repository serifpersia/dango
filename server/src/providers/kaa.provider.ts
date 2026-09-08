import {
  Show,
  VideoSource,
  VideoLink,
  SubtitleTrack,
  EpisodeDetails,
  SearchOptions,
} from './provider.interface'
import logger from '../logger'
import { BaseProvider } from './base-provider'

const KAA_BASE = 'https://kaa.lt'
const KAA_HLS_BASE = 'https://hls.krussdomi.com/manifest'
const KAA_REFERER = 'https://krussdomi.com/'
const KAA_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const KAA_HEADERS = {
  'User-Agent': KAA_UA,
  Accept: 'application/json',
}

interface KaaSearchItem {
  slug: string
  title?: string
  title_en?: string
  type?: string
  year?: number
  episode_count?: number
  locales?: string[]
}

interface KaaShowInfo {
  slug: string
  title?: string
  title_en?: string
  type?: string
  locales?: string[]
  watch_uri?: string | null
}

interface KaaEpisodeItem {
  slug: string
  episode_number: number
  episode_string?: string
  title?: string
  duration_ms?: number
}

interface KaaEpisodesPage {
  number: number
  from?: string
  to?: string
  eps?: number[]
}

interface KaaEpisodesResponse {
  current_page?: number
  pages?: KaaEpisodesPage[]
  result?: KaaEpisodeItem[]
}

interface KaaServer {
  name?: string
  shortName?: string
  src?: string
}

interface KaaEpisodeServers {
  servers?: KaaServer[]
  language?: string
}

export class KaaProvider extends BaseProvider {
  name = 'kaa'

  private stripSlug(showId: string): string | null {
    if (!showId) return null
    const s = showId.trim()
    if (/^\d+$/.test(s)) return null
    if (s.startsWith('kaa:')) {
      const rest = s.slice(4)
      return rest || null
    }
    if (s.length < 3) return null
    return s
  }

  private async kaaSearch(query: string): Promise<KaaSearchItem[]> {
    const res = await fetch(`${KAA_BASE}/api/fsearch`, {
      method: 'POST',
      headers: { ...KAA_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 1, query }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`KAA fsearch HTTP ${res.status} for "${query}"`)
    const data = (await res.json()) as { result?: KaaSearchItem[] }
    return Array.isArray(data?.result) ? data.result : []
  }

  private async kaaShowInfo(slug: string): Promise<KaaShowInfo> {
    const res = await fetch(`${KAA_BASE}/api/show/${encodeURIComponent(slug)}`, {
      headers: KAA_HEADERS,
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) throw new Error(`KAA show HTTP ${res.status}: ${slug}`)
    return (await res.json()) as KaaShowInfo
  }

  private async kaaEpisodePage(
    slug: string,
    ep: number,
    lang: string
  ): Promise<KaaEpisodesResponse> {
    const res = await fetch(
      `${KAA_BASE}/api/show/${encodeURIComponent(slug)}/episodes?ep=${ep}&lang=${encodeURIComponent(lang)}`,
      { headers: KAA_HEADERS, signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) throw new Error(`KAA episodes HTTP ${res.status}: ${slug}`)
    return (await res.json()) as KaaEpisodesResponse
  }

  private async kaaAllEpisodes(slug: string, lang: string): Promise<KaaEpisodeItem[]> {
    const first = await this.kaaEpisodePage(slug, 1, lang)
    const pages = Array.isArray(first.pages) ? first.pages : []
    const all = Array.isArray(first.result) ? [...first.result] : []
    if (pages.length > 1) {
      const rest = await Promise.all(
        pages.slice(1).map(async (pg) => {
          const startEp = pg.eps?.[0]
          if (startEp == null) return []
          try {
            const d = await this.kaaEpisodePage(slug, startEp, lang)
            return Array.isArray(d.result) ? d.result : []
          } catch {
            return []
          }
        })
      )
      for (const batch of rest) all.push(...batch)
    }
    return all
  }

  private async kaaEpisodeServers(slug: string, fullEpSlug: string): Promise<KaaEpisodeServers> {
    const res = await fetch(
      `${KAA_BASE}/api/show/${encodeURIComponent(slug)}/episode/${encodeURIComponent(fullEpSlug)}`,
      { headers: KAA_HEADERS, signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) throw new Error(`KAA episode servers HTTP ${res.status}: ${fullEpSlug}`)
    return (await res.json()) as KaaEpisodeServers
  }

  private langFor(mode?: 'sub' | 'dub'): string {
    return mode === 'dub' ? 'en-US' : 'ja-JP'
  }

  private toShow(item: KaaSearchItem): Show {
    const name = item.title_en || item.title || 'Unknown'
    return {
      _id: item.slug,
      id: item.slug,
      name,
      englishName: item.title_en || item.title,
      names: {
        english: item.title_en,
      },
      type: item.type,
      year: item.year ?? null,
      episodeCount: item.episode_count ?? null,
    }
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []
      const results = await this.kaaSearch(query)
      return results.filter((r) => r.slug).map((r) => this.toShow(r))
    } catch (error) {
      logger.error({ error }, '[KAA] Search failed')
      return []
    }
  }

  private async buildEpMap(
    slug: string,
    show: KaaShowInfo,
    lang: string
  ): Promise<{ number: number; fullSlug: string }[]> {
    const episodes = await this.kaaAllEpisodes(slug, lang)
    const map = episodes
      .filter((e) => Number.isInteger(e.episode_number) && e.episode_number >= 1 && e.slug)
      .map((e) => ({
        number: e.episode_number,
        fullSlug: `ep-${e.episode_number}-${e.slug}`,
      }))

    if (map.length > 0) return map

    if (show?.type === 'movie' && show?.watch_uri) {
      const m = show.watch_uri.match(/\/(ep-(\d+)-([a-f0-9]+))$/i)
      if (m) return [{ number: 1, fullSlug: m[1] }]
    }
    return []
  }

  async getEpisodes(showId: string, mode?: 'sub' | 'dub'): Promise<EpisodeDetails | null> {
    try {
      const slug = this.stripSlug(showId)
      if (!slug) return null

      const cacheKey = `kaa_eps_${slug}_${mode || 'sub'}`
      const cached = this.cache.get<EpisodeDetails>(cacheKey)
      if (cached) return cached

      const show = await this.kaaShowInfo(slug)
      const locales = Array.isArray(show.locales) ? show.locales : []
      if (mode === 'dub' && !locales.includes('en-US')) return null

      const epMap = await this.buildEpMap(slug, show, this.langFor(mode))
      if (!epMap.length) return null

      const episodes = epMap.map((e) => String(e.number))
      const result: EpisodeDetails = { episodes, description: '' }
      this.cache.set(cacheKey, result, 3600)
      return result
    } catch (error) {
      logger.error({ error, showId, mode }, '[KAA] getEpisodes failed')
      return null
    }
  }

  private proxyUrl(rawUrl: string): string {
    return `/api/proxy?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(KAA_REFERER)}`
  }

  private parsePlayerSubtitles(html: string): SubtitleTrack[] {
    const seen = new Set<string>()
    const tracks: SubtitleTrack[] = []
    const objRe = /\[0,\{([^}]*)\}\]/g
    let obj: RegExpExecArray | null
    while ((obj = objRe.exec(html)) !== null) {
      const block = obj[1]
      const langM = block.match(/"language"\s*:\s*\[0\s*,\s*"([^"]+)"/)
      const nameM = block.match(/"name"\s*:\s*\[0\s*,\s*"([^"]+)"/)
      const srcM = block.match(/"src"\s*:\s*\[0\s*,\s*"(https?:\/\/[^"]+\.(?:srt|vtt)[^"]*)"/)
      if (!srcM) continue
      const url = srcM[1].replace(/^https:\/\/\//, 'https://')
      if (seen.has(url)) continue
      seen.add(url)
      tracks.push({
        language: langM?.[1] || 'en',
        label: nameM?.[1] || langM?.[1] || 'English',
        url,
      })
    }
    return tracks
  }

  private async fetchCatStreamData(playerSrc: string): Promise<{
    masterUrl: string | null
    subtitles: SubtitleTrack[]
  }> {
    let masterUrl: string | null = null
    const subtitles: SubtitleTrack[] = []
    try {
      const res = await fetch(playerSrc, {
        headers: {
          'User-Agent': KAA_UA,
          Referer: 'https://kaa.lt/',
          Origin: 'https://kaa.lt',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return { masterUrl, subtitles }
      const html = (await res.text()).replace(/&quot;/g, '"')

      const manifestMatch = html.match(/"manifest"\s*:\s*\[0\s*,\s*"(\/\/[^"]+\.m3u8[^"]*)"\]/)
      if (manifestMatch) masterUrl = manifestMatch[1].replace(/^\/\//, 'https://')

      subtitles.push(...this.parsePlayerSubtitles(html))
    } catch {
      // ignore
    }
    return { masterUrl, subtitles }
  }

  private async getMasterLevels(masterUrl: string): Promise<{ index: number; label: string }[]> {
    try {
      const res = await fetch(masterUrl, {
        headers: { Referer: KAA_REFERER, Origin: 'https://krussdomi.com', 'User-Agent': KAA_UA },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) return []
      const text = await res.text()
      if (!text.includes('#EXT-X-MEDIA') || !text.includes('TYPE=AUDIO')) {
        logger.warn('[KAA] master playlist has no audio group')
      }
      const levels: { index: number; label: string }[] = []
      const lines = text.split('\n')
      let index = 0
      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('#EXT-X-STREAM-INF')) continue
        const nameMatch = line.match(/NAME="([^"]+)"/) || line.match(/RESOLUTION=\d+x(\d+)/)
        let label = nameMatch ? nameMatch[1] : 'HD'
        label = label.endsWith('p') ? label : `${label}p`
        levels.push({ index: index++, label })
      }
      return levels
    } catch {
      return []
    }
  }

  private async fetchSubtitles(playerSrc: string): Promise<SubtitleTrack[]> {
    try {
      const res = await fetch(playerSrc, {
        headers: {
          'User-Agent': KAA_UA,
          Referer: 'https://kaa.lt/',
          Origin: 'https://kaa.lt',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) return []
      const html = (await res.text()).replace(/&quot;/g, '"')
      return this.parsePlayerSubtitles(html)
    } catch {
      return []
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode?: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      const slug = this.stripSlug(showId)
      if (!slug) return null
      const epNum = Number(episodeNumber)
      if (!Number.isInteger(epNum) || epNum < 1) return null

      const cacheKey = `kaa_stream_${slug}_${epNum}_${mode || 'sub'}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const show = await this.kaaShowInfo(slug)
      const locales = Array.isArray(show.locales) ? show.locales : []
      if (mode === 'dub' && !locales.includes('en-US')) return null

      const epMap = await this.buildEpMap(slug, show, this.langFor(mode))
      const ep = epMap.find((e) => e.number === epNum)
      if (!ep) return null

      const episodeData = await this.kaaEpisodeServers(slug, ep.fullSlug)
      const servers = Array.isArray(episodeData.servers) ? episodeData.servers : []
      if (!servers.length) return null

      const sources: VideoSource[] = []
      let playerSrc = ''
      let catStreamData: { masterUrl: string | null; subtitles: SubtitleTrack[] } | null = null
      for (const s of servers) {
        const src = s.src || ''
        const isVidstream = src.includes('source=vidstream')
        const isCatstream = src.includes('source=catstream')
        if (!isVidstream && !isCatstream) continue
        const m = src.match(/[?&]id=([^&]+)/)
        if (!m) continue
        if (!playerSrc) playerSrc = src

        if (isCatstream) {
          if (!catStreamData) catStreamData = await this.fetchCatStreamData(src)
          if (!catStreamData?.masterUrl) continue
          const masterUrl = catStreamData.masterUrl
          const linkHeaders = { Referer: KAA_REFERER }
          const links: VideoLink[] = []
          for (const level of await this.getMasterLevels(masterUrl)) {
            links.push({
              resolutionStr: level.label,
              link:
                `/api/proxy?url=${encodeURIComponent(masterUrl)}` +
                `&referer=${encodeURIComponent(KAA_REFERER)}&variant=${level.index}`,
              hls: true,
              headers: linkHeaders,
            })
          }
          links.push({
            resolutionStr: 'Auto',
            link: this.proxyUrl(masterUrl),
            hls: true,
            headers: linkHeaders,
          })
          sources.push({
            sourceName: s.name ? `KAA ${s.name}` : 'KAA',
            links,
            type: 'player',
            actualEpisodeNumber: String(epNum),
          })
          continue
        }

        const masterUrl = `${KAA_HLS_BASE}/${m[1]}/master.m3u8`
        const linkHeaders = { Referer: KAA_REFERER }
        const links: VideoLink[] = []
        for (const level of await this.getMasterLevels(masterUrl)) {
          links.push({
            resolutionStr: level.label,
            link:
              `/api/proxy?url=${encodeURIComponent(masterUrl)}` +
              `&referer=${encodeURIComponent(KAA_REFERER)}&variant=${level.index}`,
            hls: true,
            headers: linkHeaders,
          })
        }
        links.push({
          resolutionStr: 'Auto',
          link: this.proxyUrl(masterUrl),
          hls: true,
          headers: linkHeaders,
        })
        sources.push({
          sourceName: s.name ? `KAA ${s.name}` : 'KAA',
          links,
          type: 'player',
          actualEpisodeNumber: String(epNum),
        })
      }

      if (!sources.length) return null

      const subtitles: SubtitleTrack[] = []
      const seen = new Set<string>()
      const push = (list?: SubtitleTrack[]) => {
        for (const t of list || []) {
          if (seen.has(t.url)) continue
          seen.add(t.url)
          subtitles.push(t)
        }
      }
      push(catStreamData?.subtitles)
      if (!subtitles.length && playerSrc) {
        push(await this.fetchSubtitles(playerSrc))
      }
      if (subtitles.length) {
        for (const src of sources) src.subtitles = subtitles
      }

      this.cache.set(cacheKey, sources, 3600)
      return sources
    } catch (error) {
      logger.error({ error, showId, episodeNumber, mode }, '[KAA] getStreamUrls failed')
      return null
    }
  }
}

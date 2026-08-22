import NodeCache from 'node-cache'
import { Provider, Show, VideoSource, EpisodeDetails, SearchOptions } from './provider.interface'
import logger from '../logger'
import { execFileSync } from 'node:child_process'

const ANILIGHT_API = 'https://api.anilight.live/api'
const SITE_BASE = 'https://anilight.live'

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function curlGetJSON<T>(url: string): T | null {
  const args = [
    '-sSL',
    '-A',
    BROWSER_UA,
    '-H',
    'Referer: https://anilight.live/',
    '-H',
    'Origin: https://anilight.live',
    '-H',
    'Accept: application/json,text/plain,*/*;q=0.8',
    '-H',
    'Accept-Language: en-US,en;q=0.9',
    '-H',
    'Sec-Ch-Ua: "Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    '-H',
    'Sec-Ch-Ua-Mobile: ?0',
    '-H',
    'Sec-Ch-Ua-Platform: "Windows"',
    '-H',
    'Sec-Fetch-Dest: empty',
    '-H',
    'Sec-Fetch-Mode: cors',
    '-H',
    'Sec-Fetch-Site: cross-site',
    '--max-time',
    '15',
    '-w',
    '\n__HTTP_STATUS__%{http_code}',
    url,
  ]
  let out: string
  try {
    out = execFileSync('curl', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch {
    return null
  }
  const m = out.match(/__HTTP_STATUS__(\d+)\s*$/)
  const status = m ? parseInt(m[1], 10) : 0
  const body = m ? out.slice(0, m.index!) : out
  if (status !== 200) return null
  try {
    return JSON.parse(body) as T
  } catch {
    return null
  }
}

function curlGetText(url: string): string | null {
  const args = [
    '-sSL',
    '-A',
    BROWSER_UA,
    '-H',
    'Referer: https://anilight.live/',
    '-H',
    'Origin: https://anilight.live',
    '--max-time',
    '15',
    '-w',
    '\n__HTTP_STATUS__%{http_code}',
    url,
  ]
  let out: string
  try {
    out = execFileSync('curl', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
  } catch {
    return null
  }
  const m = out.match(/__HTTP_STATUS__(\d+)\s*$/)
  const status = m ? parseInt(m[1], 10) : 0
  const body = m ? out.slice(0, m.index!) : out
  if (status !== 200) return null
  return body
}

function toAbsolute(url: string): string {
  if (!url) return url
  if (url.startsWith('http')) return url
  return `${SITE_BASE}${url}`
}

interface AnilightAnime {
  id?: number
  slug?: string
  anilistId?: number
  idMal?: number
  title?: { romaji?: string; english?: string; native?: string }
  coverImage?: { large?: string; extraLarge?: string }
  bannerImage?: string
  description?: string
  genres?: string[]
  averageScore?: number
  popularity?: number
  episodes?: number
  duration?: number | string
  status?: string
  source?: string
  season?: string
  seasonYear?: number
  startDate?: { year?: number; month?: number; day?: number }
  format?: string
  trailer?: { id?: string; site?: string }
  studios?: { nodes?: { name?: string }[] }
  tmdb?: { id?: number; title?: string; poster?: string; backdrop?: string }
  nextAiringEpisode?: { episode?: number; airingAt?: number }
}

interface AnilightWatchEpisode {
  number?: number
  title?: string
  jp_title?: string
  description?: string
  img?: string
  isFiller?: boolean
  airedAt?: string
  duration?: number
  embed_url?: {
    sub?: string
    dub?: string
  }
}

interface AnilightWatchResponse {
  id?: number
  episodes: AnilightWatchEpisode[]
  servers?: {
    subProviders?: Array<{ id: string; tip?: string; default?: boolean }>
    dubProviders?: Array<{ id: string; tip?: string; default?: boolean }>
  }
  nextAiringEpisode?: { episode?: number; airingAt?: number }
}

interface SourcesResponse {
  audio: unknown | null
  tracks: Array<{
    id?: string
    file?: string
    url?: string
    kind: 'captions' | 'subtitles'
    lang: string
    label: string
    default: boolean
  }>
  sources: Array<{
    url: string
    quality: string
    server?: string
  }>
  chapters: Array<{
    start: number
    end: number
    title: string
  }>
}

const slugByAnilistId = new Map<number, string>()

function parseShowId(id: string): { anilistId: number | null; slug: string | null } {
  if (id.startsWith('al:')) {
    const rest = id.slice(3)
    const colonIdx = rest.indexOf(':')
    if (colonIdx > 0) {
      const anilistId = Number(rest.slice(0, colonIdx))
      const slug = rest.slice(colonIdx + 1)
      return {
        anilistId: Number.isFinite(anilistId) && anilistId > 0 ? anilistId : null,
        slug: slug || null,
      }
    }
    const anilistId = Number(rest)
    if (Number.isFinite(anilistId) && anilistId > 0) {
      return { anilistId, slug: slugByAnilistId.get(anilistId) ?? null }
    }
  }
  if (id && id.length > 3) {
    return { anilistId: null, slug: id }
  }
  return { anilistId: null, slug: null }
}

function mapAnimeToShow(item: AnilightAnime): Show {
  if (item.anilistId && item.slug) {
    slugByAnilistId.set(item.anilistId, item.slug)
  }
  const title = item.title || {}
  return {
    _id: `al:${item.anilistId || ''}:${item.slug || ''}`,
    id: `al:${item.anilistId || ''}:${item.slug || ''}`,
    name: title.english || title.romaji || title.native || 'Unknown',
    englishName: title.english || title.romaji || title.native || 'Unknown',
    nativeName: title.native,
    names: {
      romaji: title.romaji,
      english: title.english,
      native: title.native,
    },
    thumbnail: toAbsolute(item.coverImage?.large || item.coverImage?.extraLarge || ''),
    bannerImage: toAbsolute(item.bannerImage || ''),
    description: item.description || '',
    type: item.format || 'TV',
    year: item.seasonYear || item.startDate?.year || null,
    episodeCount: item.episodes ?? null,
    episodeDuration: item.duration ? Number(item.duration) : null,
    averageScore: item.averageScore ?? null,
    score: item.popularity ?? null,
    status: item.status || '',
    season: item.season ? { season: item.season } : null,
    genres: (item.genres || []).map((g) => ({ name: g })),
    studios: (item.studios?.nodes || []).map((s) => ({ name: s.name || '' })),
    availableEpisodesDetail: { sub: [], dub: [] },
    nextAiring: item.nextAiringEpisode
      ? {
          episode: item.nextAiringEpisode.episode || 0,
          timeUntilAiring: item.nextAiringEpisode.airingAt || 0,
        }
      : undefined,
  }
}

export class AnilightProvider implements Provider {
  name = 'anilight'

  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  private getWatchCacheKey(slug: string): string {
    return `anilight_watch_${slug}`
  }

  private async getWatchDocument(slug: string): Promise<AnilightWatchResponse | null> {
    const cacheKey = this.getWatchCacheKey(slug)
    const cached = this.cache.get<AnilightWatchResponse>(cacheKey)
    if (cached) return cached

    const data = await curlGetJSON<AnilightWatchResponse>(
      `${ANILIGHT_API}/watch/${encodeURIComponent(slug)}`
    )
    if (data) {
      this.cache.set(cacheKey, data, 300)
    }
    return data
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []

      const data = await curlGetJSON<AnilightAnime[]>(
        `${ANILIGHT_API}/search?q=${encodeURIComponent(query)}`
      )

      const results = Array.isArray(data) ? data : []
      if (!results.length) return []

      return results.map(mapAnimeToShow)
    } catch (error) {
      logger.error({ error }, '[Anilight] Search failed')
      return []
    }
  }

  async resolveShowId(title: string, _romaji?: string): Promise<string | null> {
    const results = await this.search({ query: title })
    if (!results.length) return null
    return results[0].id || null
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      const { slug } = parseShowId(showId)
      if (!slug) return null

      const data = await this.getWatchDocument(slug)

      const episodes = data?.episodes || []
      if (!episodes.length) {
        return { episodes: [], description: '' }
      }

      const episodeNumbers = episodes.map((ep) => String(ep.number)).filter(Boolean)
      return { episodes: episodeNumbers, description: '' }
    } catch (error) {
      logger.error({ error, showId }, '[Anilight] getEpisodes failed')
      return null
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      const { slug } = parseShowId(showId)
      if (!slug) return null

      const watch = await this.getWatchDocument(slug)
      if (!watch) return null

      const providers =
        (mode === 'sub' ? watch.servers?.subProviders : watch.servers?.dubProviders) ?? []
      const sources: VideoSource[] = []

      for (const provider of providers) {
        const data = await curlGetJSON<SourcesResponse>(
          `${ANILIGHT_API}/sources?id=${watch.id}\u0026epNum=${episodeNumber}\u0026type=${mode}\u0026providerId=${provider.id}`
        )
        if (!data?.sources) continue

        const links: { resolutionStr: string; link: string; hls: boolean }[] = []

        for (const source of data.sources) {
          let rawUrl = source.url || ''
          if (!rawUrl) continue
          if (rawUrl.includes('vibeplayer.site')) {
            rawUrl = rawUrl.replace('vibeplayer.site', 'vivibebe.site')
          }
          if (rawUrl.includes('24stream.xyz')) {
            rawUrl = rawUrl.replace('24stream.xyz', 'aniwatchtv.site')
          }
          const isHls = rawUrl.includes('.m3u8') || source.quality === 'auto'
          let proxyUrl = `/api/proxy?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent('https://anilight.live/')}`
          if (provider.id === 'misa') {
            proxyUrl = `${ANILIGHT_API}/lb/misa/proxy?url=${encodeURIComponent(rawUrl)}`
          }
          if (provider.id === 'mello') {
            proxyUrl = `${ANILIGHT_API}/lb/mello/proxy?url=${encodeURIComponent(rawUrl)}`
          }
          if (provider.id === 'misora') {
            proxyUrl = `${ANILIGHT_API}/proxy?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent('https://anilight.live/')}`
          }
          if (provider.id === 'ryu') {
            proxyUrl = `${ANILIGHT_API}/proxy/ryu?url=${encodeURIComponent(rawUrl)}`
          }

          const qualityLabel =
            source.quality && source.quality !== 'auto'
              ? source.quality.endsWith('p')
                ? source.quality
                : `${source.quality}p`
              : 'Auto'

          links.push({ resolutionStr: qualityLabel, link: proxyUrl, hls: isHls })

          if (isHls && rawUrl.endsWith('master.m3u8')) {
            try {
              const masterContent = curlGetText(rawUrl)
              if (
                typeof masterContent === 'string' &&
                masterContent.includes('#EXT-X-STREAM-INF')
              ) {
                const lines = masterContent.split('\n')
                const baseUrl = new URL(rawUrl)
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i].trim()
                  if (line.startsWith('#EXT-X-STREAM-INF')) {
                    const nameMatch =
                      line.match(/NAME="([^"]+)"/) || line.match(/RESOLUTION=\d+x(\d+)/)
                    const resLabel = nameMatch
                      ? nameMatch[1].endsWith('p')
                        ? nameMatch[1]
                        : `${nameMatch[1]}p`
                      : 'HD'
                    const nextLine = (lines[i + 1] || '').trim()
                    if (nextLine && !nextLine.startsWith('#')) {
                      const subUrl = new URL(nextLine, baseUrl).href
                      const subProxyUrl = `/api/proxy?url=${encodeURIComponent(subUrl)}&referer=${encodeURIComponent('https://anilight.live/')}`
                      links.push({ resolutionStr: resLabel, link: subProxyUrl, hls: true })
                    }
                  }
                }
              }
            } catch (e) {
              logger.warn({ rawUrl }, '[Anilight] Master playlist resolution parsing failed')
            }
          }
        }

        if (links.length === 0) continue

        const subtitles = (data.tracks || [])
          .filter((t) => t.file || t.url)
          .map((t) => {
            const raw = t.file || t.url || ''
            return {
              language: t.lang || t.label || 'en',
              label: t.label || t.lang || 'English',
              url:
                provider.id === 'misa' || provider.id === 'misora'
                  ? `${ANILIGHT_API}/proxy/captions?url=${encodeURIComponent(raw)}`
                  : raw,
            }
          })

        if (provider.id === 'misora' || provider.id === 'misa') {
          const m3u8Subs = subtitles
            .map((s, i) => ({ ...s, i }))
            .filter((s) => s.url.includes('.m3u8'))
          for (const sub of m3u8Subs) {
            let vttUrl: string | null = null
            try {
              const base = sub.url.replace(/\/[^/]*\.m3u8$/, '/')
              const candidate = `${base}sub.vtt`
              const vttResp = curlGetText(candidate)
              if (vttResp && vttResp.includes('WEBVTT')) {
                vttUrl = candidate
              }
            } catch {
              // ignore
            }
            if (!vttUrl) {
              try {
                const hashMatch = sub.url.match(/\/cachesub\/([^/]+)\//)
                if (hashMatch?.[1]) {
                  const candidate = `https://ani10.nukitashi.top/${hashMatch[1]}/sub.vtt`
                  const vttResp = curlGetText(candidate)
                  if (vttResp && vttResp.includes('WEBVTT')) {
                    vttUrl = candidate
                  }
                }
              } catch {
                // ignore
              }
            }
            if (vttUrl) {
              subtitles[sub.i] = {
                language: sub.language,
                label: sub.label,
                url: vttUrl,
              }
            }
          }
        }

        sources.push({
          sourceName: provider.id,
          links,
          subtitles: subtitles.length ? subtitles : undefined,
          type: 'player',
          actualEpisodeNumber: episodeNumber,
        })
      }

      return sources.length ? sources : null
    } catch (error) {
      logger.error({ error, showId, episodeNumber }, '[Anilight] getStreamUrls failed')
      return null
    }
  }
}

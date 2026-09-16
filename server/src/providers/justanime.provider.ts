import {
  Show,
  VideoSource,
  EpisodeDetails,
  EpisodeDetail,
  SearchOptions,
  SubtitleTrack,
} from './provider.interface.js'
import logger from '../logger.js'
import { BaseProvider } from './base-provider.js'

interface JustAnimeTitle {
  english?: string | null
  romaji?: string | null
}

interface JustAnimeCard {
  id: number
  title?: JustAnimeTitle
  cover?: string
  type?: string
  format?: string
  year?: number | null
  seasonYear?: number | null
}

interface JustAnimeEpisode {
  number: number
  title?: string
}

interface JustAnimeSource {
  url: string
  quality?: string
  isM3U8?: boolean
  headers?: Record<string, string>
}

interface JustAnimeSubtitle {
  file: string
  label?: string
  kind?: string
}

interface JustAnimeStreamTrack {
  sources?: JustAnimeSource[]
  subtitles?: JustAnimeSubtitle[]
  tracks?: JustAnimeSubtitle[]
  headers?: { Referer?: string }
}

interface JustAnimeStreamData {
  sub?: JustAnimeStreamTrack | null
  dub?: JustAnimeStreamTrack | null
}

const STREAM_SERVERS = ['megaplay', 'zokoanime', 'animegg']

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const SITE_BASE = 'https://justanime.to'
const DEFAULT_API_BASE = 'https://core.justanime.to/api'

export class JustAnimeProvider extends BaseProvider {
  name = 'JustAnime'

  isDirectId(showId: string): boolean {
    return /^\d+$/.test(showId.trim())
  }

  private apiBase(): string {
    return (process.env.JUSTANIME_API_BASE || DEFAULT_API_BASE).trim().replace(/\/+$/, '')
  }

  private async getApi<T>(path: string): Promise<T> {
    const url = new URL(path.replace(/^\/+/, ''), `${this.apiBase()}/`)
    const res = await fetch(url.href, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json, text/plain, */*',
        Origin: SITE_BASE,
        Referer: `${SITE_BASE}/`,
      },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`Status ${res.status}`)
    const value = (await res.json()) as T & { error?: { message?: string } | string }
    if (value?.error) {
      throw new Error(typeof value.error === 'string' ? value.error : value.error.message)
    }
    return value
  }

  private toShow(card: JustAnimeCard): Show | null {
    if (!card || card.id == null) return null
    const title = card.title?.english || card.title?.romaji || ''
    if (!title) return null
    return {
      _id: String(card.id),
      id: String(card.id),
      anilistId: card.id,
      name: title,
      englishName: card.title?.english || undefined,
      names: {
        english: card.title?.english || undefined,
        romaji: card.title?.romaji || undefined,
      },
      thumbnail: card.cover,
      type: card.format || card.type,
      year: card.seasonYear ?? card.year ?? null,
    }
  }

  private qualityNum(value?: string): number {
    const m = String(value || '').match(/(360|480|720|1080|2160)/)
    return m ? parseInt(m[1], 10) : 0
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []
      const data = await this.getApi<{ results?: JustAnimeCard[] }>(
        `/search?query=${encodeURIComponent(query)}&page=${options.page && options.page > 0 ? options.page : 1}`
      )
      return (data.results || []).map((c) => this.toShow(c)).filter((s): s is Show => s !== null)
    } catch (e) {
      logger.error({ err: e }, 'JustAnime search failed')
      return []
    }
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      const id = showId.trim()
      if (!/^\d+$/.test(id)) return null
      const cacheKey = `justanime_eps_${id}`
      const cached = this.cache.get<EpisodeDetails>(cacheKey)
      if (cached) return cached

      const first = await this.getApi<{
        episodes?: JustAnimeEpisode[]
        totalPages?: number
      }>(`/anime/${encodeURIComponent(id)}/episodes?page=1`)
      const totalPages = Math.max(1, Number(first.totalPages) || 1)
      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, i) =>
          this.getApi<{ episodes?: JustAnimeEpisode[] }>(
            `/anime/${encodeURIComponent(id)}/episodes?page=${i + 2}`
          )
        )
      )
      const seen = new Map<string, EpisodeDetail>()
      for (const page of [first, ...rest]) {
        for (const ep of page.episodes || []) {
          const n = String(ep.number)
          if (!n || seen.has(n)) continue
          seen.set(n, {
            number: n,
            title: ep.title && !/^episode\s+[\d.]+$/i.test(ep.title) ? ep.title : undefined,
          })
        }
      }
      const details = [...seen.values()].sort((a, b) => Number(a.number) - Number(b.number))
      if (details.length === 0) return null
      const result: EpisodeDetails = {
        episodes: details.map((d) => d.number),
        availableEpisodesDetail: details,
        description: '',
      }
      this.cache.set(cacheKey, result, 3600)
      return result
    } catch (e) {
      logger.error({ err: e, showId }, 'JustAnime getEpisodes failed')
      return null
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode: 'sub' | 'dub' = 'sub'
  ): Promise<VideoSource[] | null> {
    try {
      const id = showId.trim()
      if (!/^\d+$/.test(id)) return null
      const ep = episodeNumber.trim()
      if (!ep) return null
      const cacheKey = `justanime_stream_${id}_${ep}_${mode}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const settled = await Promise.allSettled(
        STREAM_SERVERS.map((server) =>
          this.getApi<JustAnimeStreamData>(
            `/watch/${encodeURIComponent(id)}/episode/${encodeURIComponent(ep)}/${server}`
          ).then((data) => ({ server, data }))
        )
      )
      const result: VideoSource[] = []
      for (const entry of settled) {
        if (entry.status !== 'fulfilled') continue
        const { server, data } = entry.value
        const track = mode === 'dub' ? data.dub : data.sub
        const sources = track?.sources || []
        const links = sources
          .filter((s) => s && s.url)
          .map((s) => {
            const q = this.qualityNum(s.quality)
            const hls = s.isM3U8 === true || /\.m3u8(?:[?#]|$)/i.test(s.url)
            return {
              resolutionStr: q ? `${q}p` : 'Auto',
              quality: q,
              link: s.url,
              hls,
              referer: s.headers?.Referer || track?.headers?.Referer || 'https://www.animegg.org/',
            }
          })
          .sort((a, b) => b.quality - a.quality)
          .map(({ resolutionStr, link, hls, referer }) => ({
            resolutionStr,
            link,
            hls,
            headers: { Referer: referer },
          }))
        if (links.length === 0) continue
        const subtitles: SubtitleTrack[] = [...(track?.subtitles || []), ...(track?.tracks || [])]
          .filter((s) => s && s.file)
          .map((s) => ({
            language: s.label && /english/i.test(s.label) ? 'en' : s.label || 'en',
            label: s.label || 'English',
            url: s.file,
          }))
        const seen = new Set<string>()
        const uniqueSubtitles = subtitles.filter((s) =>
          seen.has(s.url) ? false : (seen.add(s.url), true)
        )
        result.push({
          sourceName: `JustAnime · ${server} (${mode.toUpperCase()})`,
          links,
          subtitles: uniqueSubtitles.length > 0 ? uniqueSubtitles : undefined,
          type: 'player',
          actualEpisodeNumber: ep,
        })
      }
      if (result.length === 0) return null
      this.cache.set(cacheKey, result, 1800)
      return result
    } catch (e) {
      logger.error({ err: e, showId, episodeNumber }, 'JustAnime getStreamUrls failed')
      return null
    }
  }
}

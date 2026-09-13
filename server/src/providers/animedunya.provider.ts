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
import { anilistRequest, parseMalId, searchAnilistByTitle } from '../lib/anilist'
import { kitsuMetaByAnilistId } from '../lib/kitsu'

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

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

export class AnimeDunyaProvider implements Provider {
  name = 'AnimeDunya'
  private base = 'https://anime-dunya.com'
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
      logger.error({ error }, 'AnimeDunya search failed')
      return []
    }
  }

  private async getMalId(anilistId: string): Promise<string | null> {
    const cacheKey = `animedunya_malid_${anilistId}`
    const cached = this.cache.get<string>(cacheKey)
    if (cached !== undefined) return cached || null
    try {
      const data = await anilistRequest<{ Media: { idMal?: number | null } }>(
        `query ($id: Int) { Media (id: $id, type: ANIME) { idMal } }`,
        { id: Number(anilistId) }
      )
      const idMal = data?.data?.Media?.idMal
      if (idMal) {
        const result = String(idMal)
        this.cache.set(cacheKey, result, 86400)
        return result
      }
    } catch {
      // ignore
    }
    try {
      const fb = await kitsuMetaByAnilistId(Number(anilistId))
      if (fb?.idMal) {
        const result = String(fb.idMal)
        this.cache.set(cacheKey, result, 86400)
        return result
      }
    } catch {
      // ignore
    }
    this.cache.set(cacheKey, '', 3600)
    return null
  }

  async resolveShowId(title: string): Promise<string | null> {
    try {
      const hit = await searchAnilistByTitle(title)
      if (!hit) return null
      const malId = await this.getMalId(String(hit.id))
      return malId ? `mal-${malId}` : null
    } catch {
      return null
    }
  }

  private async resolveMalId(showId: string): Promise<string | null> {
    const direct = parseMalId(showId)
    if (direct !== null) return String(direct)
    if (/^\d+$/.test(showId)) return this.getMalId(showId)
    return null
  }

  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const res = await gotScraping({
        url,
        headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
        responseType: 'text',
        timeout: { request: 25000 },
        followRedirect: true,
        throwHttpErrors: false,
      })
      if (res.statusCode !== 200) return null
      return String(res.body ?? '')
    } catch {
      return null
    }
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      const malId = await this.resolveMalId(showId)
      if (!malId) return null
      const cacheKey = `animedunya_eps_${malId}`
      const cached = this.cache.get<EpisodeDetails>(cacheKey)
      if (cached) return cached
      const html = await this.fetchHtml(`${this.base}/en/anime/${malId}`)
      if (!html) return null
      const numbers = new Set<string>()
      for (const m of html.matchAll(/\\"episodeNumber\\":(\d+)/g)) {
        numbers.add(String(Number(m[1])))
      }
      if (numbers.size === 0) return null
      const result: EpisodeDetails = {
        episodes: [...numbers].sort((a, b) => Number(a) - Number(b)),
        description: '',
      }
      this.cache.set(cacheKey, result, 86400)
      return result
    } catch (error) {
      logger.error({ error, showId }, 'AnimeDunya getEpisodes failed')
      return null
    }
  }

  private extractSubtitles(unescapedHtml: string): SubtitleTrack[] {
    const tracks: SubtitleTrack[] = []
    try {
      const arrayMatch = unescapedHtml.match(/"subtitles"\s*:\s*\[/)
      if (arrayMatch?.index === undefined) return tracks
      let depth = 0
      let end = -1
      for (let i = arrayMatch.index + arrayMatch[0].length - 1; i < unescapedHtml.length; i++) {
        const char = unescapedHtml[i]
        if (char === '[') depth++
        else if (char === ']') {
          depth--
          if (depth === 0) {
            end = i
            break
          }
        }
      }
      if (end < 0) return tracks
      const parsed = JSON.parse(
        unescapedHtml.slice(arrayMatch.index + arrayMatch[0].length - 1, end + 1)
      ) as { src?: string; srclang?: string; label?: string }[]
      if (!Array.isArray(parsed)) return tracks
      for (const item of parsed) {
        if (!item?.src) continue
        const label = item.label || item.srclang || 'Unknown'
        tracks.push({ language: label, label, url: item.src })
      }
    } catch {
      // ignore — video plays fine without subtitles
    }
    return tracks
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode: 'sub' | 'dub' = 'sub'
  ): Promise<VideoSource[] | null> {
    if (mode === 'dub') return null
    const targetEpisode = episodeNumber === '0' ? '1' : episodeNumber
    try {
      const malId = await this.resolveMalId(showId)
      if (!malId) return null
      const cacheKey = `animedunya_stream_${malId}_${targetEpisode}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const html = await this.fetchHtml(`${this.base}/en/play/${malId}/${targetEpisode}`)
      if (!html) return null
      const unescaped = html
        .replace(/\\u0026/g, '&')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
      const source =
        unescaped.match(/"contentUrl"\s*:\s*"([^"]+\.m3u8[^"]*)"/)?.[1] ||
        unescaped.match(/"source"\s*:\s*"([^"]+)"/)?.[1]
      if (!source) return null

      const links: VideoLink[] = [
        {
          resolutionStr: 'Auto',
          link: source,
          hls: true,
          headers: { Referer: `${this.base}/`, 'User-Agent': UA },
        },
      ]
      const subtitles: SubtitleTrack[] = this.extractSubtitles(unescaped)
      const result: VideoSource[] = [
        {
          sourceName: 'AnimeDunya (SUB)',
          links,
          subtitles,
          type: 'player',
          actualEpisodeNumber: targetEpisode,
        },
      ]
      this.cache.set(cacheKey, result, 600)
      return result
    } catch (error) {
      logger.error({ error, showId, episodeNumber, mode }, '[AnimeDunya] getStreamUrls failed')
      return null
    }
  }
}

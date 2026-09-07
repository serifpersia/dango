import NodeCache from 'node-cache'
import { createDecipheriv } from 'node:crypto'
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
  idMal?: number | null
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

export class MegaPlayProvider implements Provider {
  name = 'MegaPlay'
  private megaPlayBase = 'https://megaplay.buzz/stream/ani'
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
      names: {
        romaji: title?.romaji,
        english: title?.english,
        native: title?.native,
      },
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

  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private bestMatch(results: AniListMedia[], query: string): AniListMedia {
    const q = this.normalizeTitle(query)
    let best = results[0]
    let bestScore = -1

    for (const anime of results) {
      const title = anime.title ? this.normalizeTitle(anime.title.romaji || '') : ''
      const englishTitle = anime.title?.english ? this.normalizeTitle(anime.title.english) : ''
      const nativeTitle = anime.title?.native ? this.normalizeTitle(anime.title.native) : ''
      let score = -1

      if (title === q || englishTitle === q || nativeTitle === q) {
        score = 3
      } else if (title.startsWith(q) || englishTitle.startsWith(q) || nativeTitle.startsWith(q)) {
        score = 2
      } else if (title.includes(q) || englishTitle.includes(q) || nativeTitle.includes(q)) {
        score = 1
      }

      if (score > bestScore) {
        bestScore = score
        best = anime
        if (score === 3) break
      }
    }

    return best
  }

  private mediaFields = `
    id
    idMal
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
      const rawQuery = options.query || ''
      const query = rawQuery.replace(/[""]/g, '').replace(/[']/g, '').replace(/\s+/g, ' ').trim()
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
      const media = data?.data?.Page?.media
      if (!media || media.length === 0) return []

      const results = media.map((m) => this.toShow(m))

      if (results.length > 0) {
        const best = this.bestMatch(media, query)
        const bestIndex = media.findIndex((m) => m.id === best.id)
        if (bestIndex > 0) {
          const [bestItem] = results.splice(bestIndex, 1)
          results.unshift(bestItem)
        }
      }

      return results
    } catch (error) {
      logger.error({ error }, 'MegaPlay (AniList) search failed')
      return []
    }
  }

  async resolveShowId(title: string, _romaji?: string): Promise<string | null> {
    const results = await this.search({ query: title })
    return results[0]?._id || null
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      if (!/^\d+$/.test(showId)) return null

      const cacheKey = `megaplay_eps_${showId}`
      const cached = this.cache.get<EpisodeDetails>(cacheKey)
      if (cached) return cached

      const gql = `query ($id: Int) {
        Media (id: $id, type: ANIME) {
          episodes
          status
          idMal
        }
      }`

      const data = await anilistRequest<{ Media: AniListMedia }>(gql, { id: Number(showId) })
      const media = data?.data?.Media
      if (!media) return null

      const episodeCount = media.episodes || 0
      let count = episodeCount
      if (count === 0) {
        if (media.status === 'RELEASING' || media.status === 'FINISHED') {
          count = 12
        }
      }

      const episodes = Array.from({ length: count }, (_, i) => (i + 1).toString())

      const result: EpisodeDetails = {
        episodes,
        description: '',
      }

      this.cache.set(cacheKey, result, 86400)
      return result
    } catch (error) {
      logger.error({ error, showId }, 'MegaPlay getEpisodes failed')
      return null
    }
  }

  private readonly megaPlayHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://megaplay.buzz/',
  }

  private decodeScriptString(value: string): string {
    return value.replace(
      /\\u([\dA-Fa-f]{4})|\\x([\dA-Fa-f]{2})|\\([\\'"bnfrtv0])/g,
      (_, unicode: string, hex: string, escaped: string) => {
        if (unicode) return String.fromCharCode(parseInt(unicode, 16))
        if (hex) return String.fromCharCode(parseInt(hex, 16))
        return (
          (
            { b: '\b', n: '\n', f: '\f', r: '\r', t: '\t', v: '\v', 0: '\0' } as Record<
              string,
              string
            >
          )[escaped] ?? escaped
        )
      }
    )
  }

  private getScriptStrings(script: string): string[] {
    const strings: string[] = []
    let index = 0
    let previous = ''
    while (index < script.length) {
      const char = script[index]
      if (char === '/' && script[index + 1] === '/') {
        index = script.indexOf('\n', index + 2)
        if (index < 0) break
        continue
      }
      if (char === '/' && script[index + 1] === '*') {
        index = script.indexOf('*/', index + 2)
        if (index < 0) break
        index += 2
        continue
      }
      if (char === '/' && /[=(:,[!&|?{};]/.test(previous)) {
        index++
        let inClass = false
        while (index < script.length) {
          if (script[index] === '\\') {
            index += 2
            continue
          }
          if (script[index] === '[') inClass = true
          if (script[index] === ']') inClass = false
          if (script[index] === '/' && !inClass) {
            index++
            while (/[a-z]/i.test(script[index] ?? '')) index++
            break
          }
          index++
        }
        continue
      }
      if (char === "'" || char === '"') {
        const quote = char
        let value = ''
        index++
        while (index < script.length && script[index] !== quote) {
          if (script[index] === '\\' && index + 1 < script.length) value += script[index++]
          value += script[index++]
        }
        strings.push(this.decodeScriptString(value))
        index++
        continue
      }
      if (char === '`') {
        index++
        while (index < script.length && script[index] !== '`')
          index += script[index] === '\\' ? 2 : 1
        index++
        continue
      }
      if (!/\s/.test(char)) previous = char
      index++
    }
    return [...new Set(strings)]
  }

  private async getMegaPlayClientScript(pageUrl: string, html: string): Promise<string | null> {
    const cacheKey = 'megaplay_client_script'
    const cached = this.cache.get<string>(cacheKey)
    if (cached) return cached

    const scriptUrls = [...html.matchAll(/<script[^>]+src="([^"]+)"[^>]*>/gi)].map(
      (m) => new URL(m[1], pageUrl).href
    )
    const scripts = await Promise.all(
      scriptUrls.map(async (url) => {
        try {
          const res = await fetch(url, {
            headers: { ...this.megaPlayHeaders, Referer: pageUrl },
            signal: AbortSignal.timeout(15000),
          })
          if (!res.ok) return null
          return await res.text()
        } catch {
          return null
        }
      })
    )
    const script = scripts.find((s) => s && /getSources/i.test(s) && /AES-CBC/i.test(s)) ?? null
    if (script) this.cache.set(cacheKey, script, 86400)
    return script
  }

  private decryptMegaPlaySource(enc: string, script: string): string | null {
    let encrypted: Buffer
    try {
      encrypted = Buffer.from(enc, 'base64url')
    } catch {
      return null
    }
    if (!encrypted.length || encrypted.length % 16 !== 0) return null

    const tryPair = (keyValue: string, ivValue: string): string | null => {
      try {
        const key = Buffer.alloc(32)
        Buffer.from(keyValue).copy(key)
        const decipher = createDecipheriv('aes-256-cbc', key, Buffer.from(ivValue))
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
        const data = JSON.parse(decrypted.toString('utf8')) as { file?: unknown; url?: unknown }
        const source = data?.file ?? data?.url
        return typeof source === 'string' && source ? source : null
      } catch {
        return null
      }
    }

    // Fast path: key/IV pair that worked before (keyed by script URL version).
    const cachedPair = this.cache.get<{ keyValue: string; ivValue: string }>('megaplay_crypt_pair')
    if (cachedPair) {
      const hit = tryPair(cachedPair.keyValue, cachedPair.ivValue)
      if (hit) return hit
    }

    const values = this.getScriptStrings(script).filter(
      (s) => Buffer.byteLength(s) > 0 && Buffer.byteLength(s) <= 32
    )
    const ivs = values.filter((s) => Buffer.byteLength(s) === 16)
    for (const keyValue of values) {
      for (const ivValue of ivs) {
        const hit = tryPair(keyValue, ivValue)
        if (hit) {
          this.cache.set('megaplay_crypt_pair', { keyValue, ivValue }, 86400)
          return hit
        }
      }
    }
    return null
  }

  private async fetchMegaPlayData(
    fileId: string,
    pageUrl: string,
    clientScript: string | null
  ): Promise<{
    sources?: { file: string; type?: string }[] | { file: string; type?: string }
    tracks?: { file: string; label?: string; kind?: string }[]
  } | null> {
    const routes = clientScript
      ? this.getScriptStrings(clientScript)
          .filter((v) => /^stream\/getSources[\w/-]*$/i.test(v))
          .sort((a, b) => a.length - b.length)
      : []
    const legacy = routes[0] ?? 'stream/getSources'
    const modern = routes.find((r) => r !== legacy && r.startsWith(legacy)) ?? null
    const fetchRoute = async (route: string | null) => {
      if (!route) return null
      try {
        const url = new URL(route, 'https://megaplay.buzz/')
        url.searchParams.append('id', fileId)
        url.searchParams.append('id', fileId)
        const res = await fetch(url.href, {
          headers: {
            ...this.megaPlayHeaders,
            Referer: pageUrl,
            'X-Requested-With': 'XMLHttpRequest',
          },
          signal: AbortSignal.timeout(15000),
        })
        if (!res.ok) return null
        return (await res.json()) as {
          sources?: { file: string; type?: string }[] | { file: string; type?: string }
          tracks?: { file: string; label?: string; kind?: string }[]
          enc?: string
        }
      } catch {
        return null
      }
    }

    const [modernData, legacyData] = await Promise.all([fetchRoute(modern), fetchRoute(legacy)])
    const data = modernData ?? legacyData
    if (!data) return null

    const directFile =
      (Array.isArray(data.sources) ? data.sources[0]?.file : data.sources?.file) ??
      (Array.isArray(legacyData?.sources) ? legacyData.sources[0]?.file : legacyData?.sources?.file)
    if (directFile) {
      return {
        sources: { file: directFile },
        tracks: modernData?.tracks ?? legacyData?.tracks,
      }
    }

    const enc = modernData && 'enc' in modernData ? modernData.enc : legacyData?.enc
    if (enc && clientScript) {
      const url = this.decryptMegaPlaySource(enc, clientScript)
      if (url) {
        return {
          sources: { file: url },
          tracks: modernData?.tracks ?? legacyData?.tracks,
        }
      }
      logger.warn('[MegaPlay] enc decrypt failed')
    }
    return data
  }

  private async getMalId(anilistId: string): Promise<string | null> {
    const cacheKey = `megaplay_malid_${anilistId}`
    const cached = this.cache.get<string>(cacheKey)
    if (cached !== undefined) return cached || null

    try {
      const gql = `query ($id: Int) {
        Media (id: $id, type: ANIME) {
          idMal
        }
      }`
      const data = await anilistRequest<{ Media: { idMal?: number | null } }>(gql, {
        id: Number(anilistId),
      })
      const idMal = data?.data?.Media?.idMal
      if (!idMal) {
        this.cache.set(cacheKey, '', 3600)
        return null
      }
      const result = String(idMal)
      this.cache.set(cacheKey, result, 86400)
      return result
    } catch {
      return null
    }
  }

  private async tryFetchStream(
    showId: string,
    targetEpisode: string,
    mode: 'sub' | 'dub',
    endpoint: 'ani' | 'mal'
  ): Promise<VideoSource[] | null> {
    const base = this.megaPlayBase.replace('/ani', `/${endpoint}`)
    const streamPageUrl = `${base}/${showId}/${targetEpisode}/${mode}`

    const pageRes = await fetch(streamPageUrl, {
      headers: this.megaPlayHeaders,
    })
    if (!pageRes.ok) return null

    const html = await pageRes.text()
    const idMatch = html.match(/data-id="([0-9]+)"/)
    const extractedId = idMatch ? idMatch[1] : html.match(/<title>File ([0-9]+)/i)?.[1]
    if (!extractedId) return null

    const clientScript = await this.getMegaPlayClientScript(streamPageUrl, html)
    const data = await this.fetchMegaPlayData(extractedId, streamPageUrl, clientScript)
    if (!data) return null

    let sources: { file: string; type?: string }[] = []
    if (Array.isArray(data.sources)) {
      sources = data.sources
    } else if (data.sources && 'file' in data.sources) {
      sources = [data.sources]
    }

    if (sources.length === 0) return null

    const links: VideoLink[] = []
    for (const s of sources) {
      if (s.file.includes('.m3u8')) {
        try {
          const masterRes = await fetch(s.file, {
            headers: {
              Referer: 'https://megaplay.buzz/',
              'User-Agent': this.megaPlayHeaders['User-Agent'],
            },
            signal: AbortSignal.timeout(10000),
          })
          if (masterRes.ok) {
            const playlist = await masterRes.text()
            const variantRe = /#EXT-X-STREAM-INF:([^\n]*)\n(\S+)/g
            let m: RegExpExecArray | null
            while ((m = variantRe.exec(playlist)) !== null) {
              const attrs = m[1]
              const label =
                attrs.match(/NAME="([^"]+)"/)?.[1] ||
                (attrs.match(/RESOLUTION=\d+x(\d+)/)?.[1] ?? '') + 'p' ||
                ''
              if (!label || label === 'p') continue
              const variantUrl = new URL(m[2], s.file).href
              links.push({
                resolutionStr: label,
                link: variantUrl,
                hls: true,
                headers: {
                  Referer: 'https://megaplay.buzz/',
                  'User-Agent': this.megaPlayHeaders['User-Agent'],
                },
              })
            }
          }
        } catch {
          // fall through to add master as Auto
        }
        links.push({
          resolutionStr: 'Auto',
          link: s.file,
          hls: true,
          headers: {
            Referer: 'https://megaplay.buzz/',
            'User-Agent': this.megaPlayHeaders['User-Agent'],
          },
        })
      } else {
        links.push({
          resolutionStr: 'Auto',
          link: s.file,
          hls: false,
          headers: {
            Referer: 'https://megaplay.buzz/',
            'User-Agent': this.megaPlayHeaders['User-Agent'],
          },
        })
      }
    }

    const subtitles: SubtitleTrack[] = (data.tracks || [])
      .filter((t) => {
        const kind = (t.kind || '').toLowerCase()
        return t.file && (!kind || kind.includes('caption') || kind.includes('sub'))
      })
      .map((t) => ({
        language: t.label || 'Unknown',
        label: t.label || 'Unknown',
        url: t.file,
      }))

    return [
      {
        sourceName: `MegaPlay (${mode.toUpperCase()})`,
        links,
        subtitles,
        type: 'player',
        actualEpisodeNumber: targetEpisode,
      },
      {
        sourceName: `MegaPlay (${mode.toUpperCase()}) [Fallback]`,
        links: [
          {
            link: streamPageUrl,
            resolutionStr: 'Auto',
            hls: false,
            headers: { Referer: 'https://megaplay.buzz/' },
          },
        ],
        subtitles: [],
        type: 'iframe',
        actualEpisodeNumber: targetEpisode,
      },
    ]
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    if (!/^\d+$/.test(showId)) return null

    let targetEpisode = episodeNumber
    if (episodeNumber === '0') {
      targetEpisode = '1'
    }

    try {
      const cacheKey = `megaplay_stream_${showId}_${targetEpisode}_${mode}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      let result = await this.tryFetchStream(showId, targetEpisode, mode, 'ani')
      if (!result) {
        const malId = await this.getMalId(showId)
        if (malId) {
          result = await this.tryFetchStream(malId, targetEpisode, mode, 'mal')
        }
      }

      if (result) {
        this.cache.set(cacheKey, result, 3600)
      }
      return result
    } catch (error) {
      logger.error({ error, showId, episodeNumber, mode }, '[MegaPlay] getStreamUrls failed')
      return null
    }
  }
}

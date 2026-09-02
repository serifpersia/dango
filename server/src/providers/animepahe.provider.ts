import * as cheerio from 'cheerio'
import NodeCache from 'node-cache'
import { gotScraping } from 'got-scraping'

import {
  Provider,
  Show,
  VideoSource,
  EpisodeDetails,
  EpisodeDetail,
  SearchOptions,
} from './provider.interface'
import { pickBestMatch, buildQueryVariants } from './title-matching'
import logger from '../logger'
import { requestContext } from '../utils/request-context'
import { sanitizeCfClearance } from '../utils/cookie.utils'

interface AnimePaheSearchResult {
  session: string
  title: string
  name?: string
  poster?: string
  image?: string
  type?: string
  year?: number
}

interface AnimePaheEpisode {
  episode?: number
  number?: number
  session?: string
  release_session?: string
  title?: string
}

interface AnimePaheVideoSource {
  url: string
  quality: string | null
  fansub: string | null
  audio: string | null
}

interface AnimePaheApiResponse<T> {
  data?: T[]
  results?: T[]
  items?: T[]
  last_page?: number
  lastPage?: number
}

export class AnimePaheProvider implements Provider {
  name = 'AnimePahe'
  private readonly BASE_URL = 'https://animepahe.pw'
  private readonly API_URL = 'https://animepahe.pw/api'

  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  private async getRequestHeaders(
    isApi: boolean = false,
    customUaOverride?: string,
    customCookieOverride?: string
  ): Promise<Record<string, string>> {
    const store = requestContext.getStore()
    const customUa = customUaOverride || store?.get('ua')
    const customCookie = customCookieOverride || store?.get('cookie')

    const userAgent =
      customUa ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
    let cookieStr = ''

    if (customCookie) {
      // Sanitize cookie: remove 'cf_clearance' label (with : or =), spaces, and quotes
      let sanitized = customCookie.trim()
      // Remove "cf_clearance" prefix case-insensitively
      sanitized = sanitized.replace(/^cf_clearance/i, '')
      // Remove leading : or = and any whitespace
      sanitized = sanitized.replace(/^[:=]\s*/, '')
      // Remove all quotes and trim again
      sanitized = sanitized.replace(/["']/g, '').trim()

      cookieStr = `cf_clearance=${sanitized}`
    }

    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: `${this.BASE_URL}/`,
      Origin: this.BASE_URL,
      Cookie: cookieStr,
    }

    if (isApi) {
      headers['X-Requested-With'] = 'XMLHttpRequest'
      headers['Accept'] = 'application/json, text/javascript, */*; q=0.01'
    }

    return headers
  }

  private async fetchText(
    url: string,
    isApi: boolean = false,
    ua?: string,
    cookie?: string
  ): Promise<string> {
    try {
      const headers = await this.getRequestHeaders(isApi, ua, cookie)
      const response = await gotScraping(url, {
        method: 'GET',
        headers,
        responseType: 'text',
      })

      const text = response.body

      if (response.statusCode !== 200) {
        if (response.statusCode === 403 || text.includes('Cloudflare')) {
          const error = new Error(`AUTH_REQUIRED`) as Error & { status?: number }
          error.status = 403
          throw error
        }
        throw new Error(`HTTP ${response.statusCode}`)
      }

      return text
    } catch (error) {
      if ((error as Error).message === 'AUTH_REQUIRED') throw error
      logger.error({ url, error: (error as Error).message }, 'AnimePahe Fetch failed')
      throw error
    }
  }

  private async fetchJson<T>(url: string, ua?: string, cookie?: string): Promise<T | null> {
    const data = await this.fetchText(url, true, ua, cookie)
    try {
      return JSON.parse(data) as T
    } catch {
      logger.error({ url }, 'Failed to parse AnimePahe JSON')
      return null
    }
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const q = options.query || ''
      const url = `${this.API_URL}?m=search&q=${encodeURIComponent(q)}`
      const data = await this.fetchJson<AnimePaheApiResponse<AnimePaheSearchResult>>(url)
      if (!data) return []

      const items = (data.data || data.results || data.items || []) as AnimePaheSearchResult[]
      return items.map((a) => ({
        _id: a.session,
        id: a.session,
        name: a.title || a.name || '',
        englishName: a.title,
        thumbnail: a.poster || a.image,
        type: a.type,
        year: a.year,
        session: a.session,
      }))
    } catch (e) {
      if ((e as Error).message === 'AUTH_REQUIRED') throw e
      return []
    }
  }

  async resolveShowId(title: string, romaji?: string): Promise<string | null> {
    const targets = [title, romaji].filter((t): t is string => !!t && t.trim().length > 0)
    if (targets.length === 0) return null

    for (const variant of buildQueryVariants(title, romaji)) {
      const results = await this.search({ query: variant })
      if (results.length === 0) continue

      const candidates = results.map((r) => ({
        title: r.name || r.englishName || '',
        id: r.session ?? r._id ?? r.id ?? '',
      }))

      const matchResult = pickBestMatch(candidates, targets)
      if (matchResult) {
        return matchResult.item.id
      }
    }

    return null
  }

  async getEpisodes(
    showId: string,
    _mode: 'sub' | 'dub',
    ua?: string,
    cookie?: string
  ): Promise<EpisodeDetails | null> {
    try {
      const firstPageUrl = `${this.API_URL}?m=release&id=${showId}&sort=episode_asc&page=1`
      const firstPageData = await this.fetchJson<AnimePaheApiResponse<AnimePaheEpisode>>(
        firstPageUrl,
        ua,
        cookie
      )
      if (!firstPageData) return null

      let episodes = (firstPageData.data || firstPageData.results || []) as AnimePaheEpisode[]
      const lastPage = Number(firstPageData.last_page || firstPageData.lastPage || 1)

      for (let p = 2; p <= lastPage; p++) {
        const pageUrl = `${this.API_URL}?m=release&id=${showId}&sort=episode_asc&page=${p}`
        const pageData = await this.fetchJson<AnimePaheApiResponse<AnimePaheEpisode>>(
          pageUrl,
          ua,
          cookie
        )
        if (pageData) {
          episodes = episodes.concat(
            (pageData.data || pageData.results || []) as AnimePaheEpisode[]
          )
        }
      }

      const episodeMap: Record<string, string> = {}
      const epDetails: EpisodeDetail[] = []

      episodes.forEach((ep) => {
        const epNum = (ep.episode ?? ep.number ?? '').toString()
        if (epNum) {
          episodeMap[epNum] = ep.session || ep.release_session || ''
          epDetails.push({ number: epNum, title: ep.title })
        }
      })

      this.cache.set(`animepahe_epmap_${showId}`, episodeMap, 86400)

      return {
        episodes: epDetails
          .sort((a, b) => Number(a.number) - Number(b.number))
          .map((e) => e.number),
        availableEpisodesDetail: epDetails,
        description: '',
      } satisfies EpisodeDetails
    } catch (e) {
      if ((e as Error).message === 'AUTH_REQUIRED') throw e
      return null
    }
  }

  private async getEpisodeSession(showId: string, episodeNumber: string): Promise<string | null> {
    const cacheKey = `animepahe_epmap_${showId}`
    let cachedMap = this.cache.get<Record<string, string>>(cacheKey)

    if (!cachedMap) {
      await this.getEpisodes(showId, 'sub')
      cachedMap = this.cache.get<Record<string, string>>(cacheKey)
    }

    if (!cachedMap) return null
    if (cachedMap[episodeNumber]) return cachedMap[episodeNumber]

    const target = parseFloat(episodeNumber)
    const keys = Object.keys(cachedMap)

    for (const key of keys) {
      if (parseFloat(key) === target) return cachedMap[key]
    }

    const sorted = keys.sort((a, b) => Number(a) - Number(b))
    const first = Number(sorted[0])

    if (target < first) {
      const idx = Math.floor(target) - 1
      if (idx >= 0 && idx < sorted.length) return cachedMap[sorted[idx]]
    }

    return null
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    mode: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      const epSession = await this.getEpisodeSession(showId, episodeNumber)
      if (!epSession) return null

      const sources = await this.getSources(showId, epSession)
      const results: VideoSource[] = []

      const isDubSource = (audio: string) => audio.includes('eng') || audio.includes('dub')

      const store = requestContext.getStore()
      const rawCookie = store?.get('cookie') || ''
      const cookieValue = sanitizeCfClearance(rawCookie)

      for (const src of sources) {
        const audio = (src.audio || '').toLowerCase()
        const sourceMode = isDubSource(audio) ? 'dub' : 'sub'

        if (sourceMode !== mode) continue

        const label = src.fansub
          ? `${src.quality || 'Auto'} - ${src.fansub} (${sourceMode.toUpperCase()})`
          : `${src.quality || 'Auto'} (${sourceMode.toUpperCase()})`

        const embedLink = cookieValue
          ? `/api/embed-proxy?url=${encodeURIComponent(src.url)}&cookie=${encodeURIComponent(cookieValue)}`
          : `/api/embed-proxy?url=${encodeURIComponent(src.url)}`

        let directLink: string | null = null
        try {
          const resolved = await this.resolveKwik(src.url, store?.get('ua'), rawCookie)
          if (resolved.m3u8) {
            directLink = cookieValue
              ? `/api/proxy?url=${encodeURIComponent(resolved.m3u8)}&referer=${encodeURIComponent(resolved.referer)}&cookie=${encodeURIComponent(cookieValue)}`
              : `/api/proxy?url=${encodeURIComponent(resolved.m3u8)}&referer=${encodeURIComponent(resolved.referer)}`
          }
        } catch (e) {
          logger.error(
            { url: src.url, error: (e as Error).message },
            '[AnimePahe] direct resolve failed'
          )
        }

        if (directLink) {
          results.push({
            sourceName: `${label} (Direct)`,
            links: [
              {
                resolutionStr: src.quality || 'Auto',
                link: directLink,
                hls: true,
              },
            ],
            type: 'player',
            actualEpisodeNumber: episodeNumber,
          })
        }

        results.push({
          sourceName: `${label}`,
          links: [
            {
              resolutionStr: src.quality || 'Auto',
              link: embedLink,
              hls: false,
            },
          ],
          type: 'iframe',
          actualEpisodeNumber: episodeNumber,
        })
      }

      return results.length > 0 ? results : null
    } catch (e) {
      if ((e as Error).message === 'AUTH_REQUIRED') throw e
      return null
    }
  }

  private async getSources(
    animeSession: string,
    episodeSession: string
  ): Promise<AnimePaheVideoSource[]> {
    try {
      const playUrl = `${this.BASE_URL}/play/${animeSession}/${episodeSession}`
      const html = await this.fetchText(playUrl)
      const $ = cheerio.load(html)

      const sources: AnimePaheVideoSource[] = []

      $('[data-src]').each((_, el) => {
        const src = $(el).attr('data-src')?.trim()
        if (!src || !/kwik/i.test(src)) return

        const res = $(el).attr('data-resolution') || $(el).attr('data-res')
        sources.push({
          url: src,
          quality: res ? (res.endsWith('p') ? res : `${res}p`) : null,
          fansub: $(el).attr('data-fansub') ?? null,
          audio: $(el).attr('data-audio') ?? null,
        })
      })

      const unique = Array.from(new Map(sources.map((s) => [s.url, s])).values())
      unique.sort((a, b) => {
        const qa = parseInt(a.quality || '0') || 0
        const qb = parseInt(b.quality || '0') || 0
        return qb - qa
      })

      return unique
    } catch {
      return []
    }
  }

  private async resolveKwik(
    kwikUrl: string,
    ua?: string,
    cookie?: string
  ): Promise<{ m3u8: string; referer: string }> {
    try {
      const headers: Record<string, string> = {
        'User-Agent':
          ua ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
        Referer: `${this.BASE_URL}/`,
        Origin: this.BASE_URL,
      }

      const resp = await gotScraping({
        url: kwikUrl,
        method: 'GET',
        headers,
        responseType: 'text',
        timeout: { request: 30000 },
        followRedirect: true,
        throwHttpErrors: false,
      })
      if (resp.statusCode !== 200) {
        return { m3u8: '', referer: kwikUrl }
      }
      const html = resp.body

      let searchFrom = 0
      while (true) {
        const evalStart = html.indexOf('eval(function(p,a,c,k,e,d)', searchFrom)
        if (evalStart === -1) break
        let depth = 0
        let parenEnd = -1
        for (let i = evalStart + 4; i < html.length; i++) {
          if (html[i] === '(') depth++
          else if (html[i] === ')') {
            depth--
            if (depth === 0) {
              parenEnd = i
              break
            }
          }
        }
        if (parenEnd === -1) {
          searchFrom = evalStart + 1
          continue
        }
        try {
          const result = eval(html.slice(evalStart + 4, parenEnd + 1)) as unknown
          if (typeof result === 'string') {
            const m = result.match(/source\s*=\s*['"]([^'"]+\.m3u8[^'"]*)['"]/)
            if (m) return { m3u8: m[1], referer: kwikUrl }
          }
        } catch {
          // ignore and keep scanning
        }
        searchFrom = parenEnd + 1
      }
      return { m3u8: '', referer: kwikUrl }
    } catch (e) {
      logger.error({ kwikUrl, error: (e as Error).message }, '[AnimePahe] resolveKwik failed')
      return { m3u8: '', referer: kwikUrl }
    }
  }

  async getShowMeta(showId: string, ua?: string, cookie?: string): Promise<Partial<Show> | null> {
    try {
      const url = `${this.BASE_URL}/anime/${showId}`
      const html = await this.fetchText(url, false, ua, cookie)

      const $ = cheerio.load(html)
      const metadata: Partial<Show> = {
        _id: showId,
        id: showId,
        names: {},
      }

      const cleanText = (text?: string): string | null => {
        if (!text) return null
        return text.replace(/\s+/g, ' ').trim()
      }

      const titleText =
        cleanText($('.anime-header h1 > span').text()) ||
        cleanText($('.anime-header h1').text()) ||
        ''
      metadata.name = titleText
      metadata.englishName = titleText
      metadata.names!.english = titleText

      const romaji = cleanText($('.anime-header h2.japanese').text())
      if (romaji) {
        metadata.names!.romaji = romaji
      }

      const posterDiv = $('.anime-poster')
      if (posterDiv.length) {
        const img = posterDiv.find('img')
        if (img.length) {
          metadata.thumbnail = img.attr('data-src') || img.attr('src')
        }
      }

      const synopsisDiv = $('.anime-synopsis')
      if (synopsisDiv.length) {
        metadata.description = cleanText(synopsisDiv.text()) || undefined
      }

      const infoBox: Record<string, string | { name: string; url?: string }[]> = {}
      const infoDiv = $('.anime-info')
      if (infoDiv.length) {
        infoDiv.find('p').each((_, el) => {
          const p = $(el)
          const fullText = cleanText(p.text())
          if (!fullText) return

          const colonIdx = fullText.indexOf(':')
          if (colonIdx === -1) return

          const label = fullText.substring(0, colonIdx).trim()

          if (label === 'External Links' || label === 'Themes' || label === 'Demographic') {
            const items: { name: string; url?: string }[] = []
            p.find('a').each((_, aEl) => {
              items.push({
                name: cleanText($(aEl).text()) || '',
                url: $(aEl).attr('href'),
              })
            })
            infoBox[label] = items
          } else {
            const value = fullText.substring(colonIdx + 1).trim()
            infoBox[label] = value
          }
        })
      }

      if (typeof infoBox['Japanese'] === 'string') {
        metadata.nativeName = infoBox['Japanese']
        metadata.names!.native = infoBox['Japanese']
      }

      if (typeof infoBox['Synonyms'] === 'string') {
        metadata.names!.synonyms = infoBox['Synonyms'].split(',').map((s: string) => s.trim())
      }

      if (typeof infoBox['Type'] === 'string') {
        metadata.type = infoBox['Type']
      }

      const epsStr =
        typeof infoBox['Episodes'] === 'string'
          ? infoBox['Episodes']
          : typeof infoBox['Episode'] === 'string'
            ? infoBox['Episode']
            : undefined
      if (epsStr && epsStr !== '?') {
        const parsedEps = parseInt(epsStr, 10)
        if (!isNaN(parsedEps)) {
          metadata.episodeCount = parsedEps
        }
      }

      if (typeof infoBox['Duration'] === 'string') {
        metadata.episodeDuration = infoBox['Duration']
      }
      if (typeof infoBox['Status'] === 'string') {
        metadata.status = infoBox['Status']
      }

      const parseDateStr = (dateStr?: string) => {
        if (!dateStr) return null
        const parsed = Date.parse(dateStr)
        if (isNaN(parsed)) return null
        const dateObj = new Date(parsed)
        return {
          year: dateObj.getFullYear(),
          month: dateObj.getMonth(),
          date: dateObj.getDate(),
        }
      }

      const airedStr = typeof infoBox['Aired'] === 'string' ? infoBox['Aired'] : undefined
      if (airedStr) {
        const dates = airedStr.split(/\s+to\s+/)
        const start = parseDateStr(dates[0])
        if (start) {
          metadata.airedStart = start
        }
        if (dates[1] && dates[1] !== '?') {
          const end = parseDateStr(dates[1])
          if (end) {
            metadata.airedEnd = end
          }
        }
      }

      const seasonStr = typeof infoBox['Season'] === 'string' ? infoBox['Season'] : undefined
      if (seasonStr) {
        const parts = seasonStr.split(' ')
        const seasonName = parts[0]
        const yearMatch = seasonStr.match(/\d{4}/)
        const yearVal = yearMatch ? parseInt(yearMatch[0], 10) : undefined
        if (yearVal) {
          metadata.year = yearVal
        }
        metadata.season = {
          season: seasonName,
          year: yearVal,
        }
      } else if (typeof infoBox['Aired'] === 'string') {
        const yearMatch = infoBox['Aired'].match(/\d{4}/)
        if (yearMatch) {
          metadata.year = parseInt(yearMatch[0], 10)
        }
      }

      if (typeof infoBox['Studios'] === 'string') {
        metadata.studios = infoBox['Studios'].split(',').map((s: string) => ({ name: s.trim() }))
      }

      const themes = (infoBox['Themes'] as { name: string; url?: string }[] | undefined) ?? []
      const demographic =
        (infoBox['Demographic'] as { name: string; url?: string }[] | undefined) ?? []
      metadata.tags = [
        ...themes.map((t) => ({ name: t.name })),
        ...demographic.map((d) => ({ name: d.name })),
      ]

      const genreDiv = $('.anime-genre')
      if (genreDiv.length) {
        metadata.genres = genreDiv
          .find('a')
          .map((_, el) => ({ name: cleanText($(el).text()) || '' }))
          .get()
      }

      return metadata
    } catch (e) {
      if ((e as Error).message === 'AUTH_REQUIRED') throw e
      logger.error({ showId, error: (e as Error).message }, 'Failed to fetch AnimePahe metadata')
      return null
    }
  }
}

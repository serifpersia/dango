import NodeCache from 'node-cache'
import {
  Provider,
  Show,
  VideoSource,
  EpisodeDetails,
  SearchOptions,
  VideoLink,
} from './provider.interface'
import logger from '../logger'

const BASE_URL = 'https://watchhentai.net'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function resolveUrl(href: string): string {
  if (!href) return ''
  if (href.startsWith('http')) return href
  if (href.startsWith('//')) return `https:${href}`
  if (href.startsWith('/')) return `${BASE_URL}${href}`
  return `${BASE_URL}/${href}`
}

function unwrapTimthumb(raw: string): string {
  if (!raw) return ''
  const m = raw.match(/[?&]src=([^&]+)/i)
  if (!m) return raw
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

function extractImgUrl(html: string): string {
  const dataSrcM = html.match(/\bdata-src=["']([^"']+)["']/i)
  if (dataSrcM) return unwrapTimthumb(dataSrcM[1])
  const srcM = html.match(/\bsrc=["']([^"']+)["']/i)
  if (srcM && !srcM[1].startsWith('data:')) return unwrapTimthumb(srcM[1])
  return ''
}

function cleanUrl(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/&amp;/g, '&'))
  } catch {
    return raw.replace(/&amp;/g, '&')
  }
}

function whDecodeMediaUrl(encoded: string): string {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  const bytes = Buffer.from(padded, 'base64')
  let xored = ''
  for (let i = 0; i < bytes.length; i++) {
    xored += String.fromCharCode(bytes[i] ^ ((13 + (i % 17)) & 255))
  }
  const reversed = xored.split('').reverse().join('')
  return Buffer.from(reversed, 'base64').toString('utf8')
}

function extractDirectSrc(playerUrl: string): string {
  const clean = playerUrl.replace(/&amp;/g, '&')
  try {
    const source = new URL(clean).searchParams.get('source')
    if (source) return decodeURIComponent(source)
  } catch {
    const m = clean.match(/[?&]source=([^&]+)/i)
    if (m) {
      try {
        return decodeURIComponent(m[1])
      } catch {
        return m[1]
      }
    }
  }
  return ''
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Cache-Control': 'no-cache',
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

function extractArticles(html: string): string[] {
  const results: string[] = []
  const openTag = '<article'
  const closeTag = '</article>'
  let pos = 0

  while (pos < html.length) {
    const start = html.toLowerCase().indexOf(openTag.toLowerCase(), pos)
    if (start === -1) break
    const end = html.toLowerCase().indexOf(closeTag.toLowerCase(), start)
    if (end === -1) break
    results.push(html.slice(start, end + closeTag.length))
    pos = end + closeTag.length
  }
  return results
}

function parseSearchArticles(html: string) {
  const results: { title: string; url: string; poster: string; year: string }[] = []
  const articles = extractArticles(html)
  for (const art of articles) {
    const hrefM = art.match(/<a\s[^>]*\bhref=["']([^"']+)["']/i)
    const href = hrefM ? hrefM[1] : ''
    const h3M = art.match(/<h3(?:\s[^>]*)?>([^<]+)<\/h3>/i)
    const title = h3M ? cleanText(h3M[1]) : ''
    const poster = extractImgUrl(art)
    const yearM = art.match(/buttonyear[^>]*>.*?(\d{4})/s)
    const year = yearM ? yearM[1] : ''

    if (!title) {
      const altM = art.match(/\balt=["']([^"']+)["']/i)
      if (altM) {
        const altTitle = cleanText(altM[1])
        if (altTitle && href) {
          results.push({ title: altTitle, url: resolveUrl(href), poster, year })
        }
      }
    } else if (href && title) {
      results.push({ title, url: resolveUrl(href), poster, year })
    }
  }
  return results
}

function extractPlayerData(html: string) {
  let defaultSrc = ''
  let thumbnail = ''

  const jwMatch = html.match(/var\s+jw\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script>|;)/)
  if (jwMatch) {
    const fileM = jwMatch[1].match(/"file"\s*:\s*"([^"]+)"/)
    const imageM = jwMatch[1].match(/"image"\s*:\s*"([^"]+)"/)
    if (fileM) defaultSrc = cleanUrl(fileM[1].replace(/\\\//g, '/'))
    if (imageM) thumbnail = cleanUrl(imageM[1].replace(/\\\//g, '/'))
  }

  let duration = ''
  const schemaMatch = html.match(
    /<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i
  )
  if (schemaMatch) {
    try {
      const schema = JSON.parse(schemaMatch[1].trim())
      if (!defaultSrc && schema.contentUrl) defaultSrc = schema.contentUrl
      if (!thumbnail && schema.thumbnailUrl) thumbnail = schema.thumbnailUrl
      if (schema.duration) duration = schema.duration
    } catch {
      const durM = schemaMatch[1].match(/"duration"\s*:\s*"([^"]+)"/)
      const cuM = schemaMatch[1].match(/"contentUrl"\s*:\s*"([^"]+)"/)
      const thM = schemaMatch[1].match(/"thumbnailUrl"\s*:\s*"([^"]+)"/)
      if (durM) duration = durM[1]
      if (cuM && !defaultSrc) defaultSrc = cuM[1]
      if (thM && !thumbnail) thumbnail = thM[1]
    }
  }

  const sources: { src: string; type: string; label: string }[] = []
  const sourcesBlockM = html.match(/sources\s*:\s*\[([\s\S]*?)\]/)
  if (sourcesBlockM) {
    const entryRe = /\{([\s\S]*?)\}/g
    let em: RegExpExecArray | null
    while ((em = entryRe.exec(sourcesBlockM[1])) !== null) {
      const entry = em[1]
      const fileM = entry.match(/["']?file["']?\s*:\s*["']([^"']+)["']/)
      const typeM = entry.match(/["']?type["']?\s*:\s*["']([^"']+)["']/)
      const labelM = entry.match(/["']?label["']?\s*:\s*["']([^"']+)["']/)
      if (fileM) {
        sources.push({
          src: cleanUrl(fileM[1].replace(/\\\//g, '/')),
          type: typeM ? typeM[1] : 'video/mp4',
          label: labelM ? labelM[1] : 'default',
        })
      }
    }
  }

  if (sources.length === 0 && defaultSrc) {
    const labelGuess = defaultSrc.match(/_(\d+p)\./)?.[1] ?? 'default'
    sources.push({ src: defaultSrc, type: 'video/mp4', label: labelGuess })
  }

  if (sources.length === 0) {
    const videoUrlRe = /https?:\/\/[^"' ]+\.(mp4|m3u8)[^"' ]*/gi
    let vm: RegExpExecArray | null
    const seen = new Set<string>()
    while ((vm = videoUrlRe.exec(html)) !== null) {
      const url = cleanUrl(vm[0])
      if (seen.has(url)) continue
      seen.add(url)
      const label = url.match(/_(\d{3,4}p)\./)?.[1] ?? 'default'
      sources.push({
        src: url,
        type: url.includes('.m3u8') ? 'application/x-mpegURL' : 'video/mp4',
        label,
      })
    }
  }

  return { sources, defaultSrc, thumbnail, duration }
}

export class WhProvider implements Provider {
  name = 'WH'

  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  private bestMatch(
    results: { title: string; url: string; poster: string; year: string }[],
    query: string
  ): { title: string; url: string; poster: string; year: string; score: number } | null {
    if (!results.length) return null
    if (results.length === 1) return { ...results[0], score: 0 }

    const q = query.toLowerCase().trim()
    let best = results[0]
    let bestScore = -1

    for (const item of results) {
      const title = item.title.toLowerCase()
      let score = -1
      if (title === q) score = 3
      else if (title.startsWith(q)) score = 2
      else if (title.includes(q)) score = 1

      if (score > bestScore) {
        bestScore = score
        best = item
        if (score === 3) break
      }
    }

    return { ...best, score: bestScore }
  }

  async search(options: SearchOptions): Promise<Show[]> {
    try {
      const query = (options.query || '').trim()
      if (!query) return []

      const html = await fetchText(`${BASE_URL}/?s=${encodeURIComponent(query)}`)
      const results = parseSearchArticles(html)

      if (results.length === 0) return []

      const matchResult = this.bestMatch(results, query)
      const matched = matchResult || results[0]
      const slug = matched.url.split('/').filter(Boolean).pop() || ''

      return [
        {
          _id: slug,
          id: slug,
          name: matched.title,
          englishName: matched.title,
          thumbnail: matched.poster,
          type: 'TV',
          year: matched.year ? Number(matched.year) : null,
          availableEpisodesDetail: { sub: [], dub: [] },
        },
      ]
    } catch (error) {
      logger.error({ error }, '[WH] Search failed')
      return []
    }
  }

  async resolveShowId(title: string, romaji?: string): Promise<string | null> {
    const query = (romaji || title).trim()
    if (!query) return null

    const words = query.split(/\s+/).filter(Boolean)
    const variants = [
      query,
      query
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
      words.slice(0, 3).join(' '),
      words.slice(0, 2).join(' '),
      words[0] || '',
    ].filter(Boolean)

    for (const variant of variants) {
      const html = await fetchText(`${BASE_URL}/?s=${encodeURIComponent(variant)}`)
      const results = parseSearchArticles(html)
      if (results.length === 0) continue

      const matchResult = this.bestMatch(results, variant)
      if (matchResult && matchResult.score >= 1) {
        return matchResult.url.split('/').filter(Boolean).pop() || null
      }
    }

    return null
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      if (!showId) return null

      const cacheKey = `wh_eps_${showId}`
      const cached = this.cache.get<{
        episodes: string[]
        description: string
        episodeMap: Record<string, string>
      }>(cacheKey)
      if (cached) {
        return { episodes: cached.episodes, description: cached.description }
      }

      const html = await fetchText(`${BASE_URL}/series/${showId}/`)
      const videosLinks = html.match(/\/videos\/[^"'\s]+/gi) || []

      const episodeMap: Record<string, string> = {}
      const episodeNumbers: string[] = []

      videosLinks.forEach((link) => {
        const slug = link.replace(/^\/videos\//, '').replace(/\/$/, '')
        const numM = slug.match(/episode[-\s]?(\d+)/i)
        const num = numM ? numM[1] : ''
        if (num && slug && !episodeMap[num]) {
          episodeMap[num] = slug
          episodeNumbers.push(num)
        }
      })

      const description = ''

      const result: EpisodeDetails = {
        episodes: episodeNumbers,
        description,
      }

      this.cache.set(
        cacheKey,
        {
          episodes: episodeNumbers,
          description,
          episodeMap,
        },
        120
      )

      return result
    } catch (error) {
      logger.error({ error, showId }, '[WH] getEpisodes failed')
      return null
    }
  }

  private async getEpisodeSlug(seriesSlug: string, episodeNumber: string): Promise<string | null> {
    try {
      const cacheKey = `wh_epmap_${seriesSlug}`
      let cached = this.cache.get<Record<string, string>>(cacheKey) || {}

      const buildEpisodeMap = async (): Promise<Record<string, string>> => {
        const html = await fetchText(`${BASE_URL}/series/${seriesSlug}/`)
        const videosLinks = html.match(/\/videos\/[^"'\s]+/gi) || []
        const map: Record<string, string> = {}
        videosLinks.forEach((link) => {
          const slug = link.replace(/^\/videos\//, '').replace(/\/$/, '')
          const numM = slug.match(/episode[-\s]?(\d+)/i)
          const num = numM ? numM[1] : ''
          if (num && slug) {
            map[num] = slug
          }
        })
        this.cache.set(cacheKey, map, 3600)
        return map
      }

      if (Object.keys(cached).length === 0) {
        cached = await buildEpisodeMap()
      }

      if (cached[episodeNumber]) return cached[episodeNumber]

      const target = parseFloat(episodeNumber)
      const keys = Object.keys(cached)
      for (const key of keys) {
        if (parseFloat(key) === target) return cached[key]
      }

      const sorted = keys.sort((a, b) => Number(a) - Number(b))
      const first = Number(sorted[0])
      if (target < first && sorted.length > 0) return cached[sorted[0]]

      cached = await buildEpisodeMap()

      if (cached[episodeNumber]) return cached[episodeNumber]
      for (const key of Object.keys(cached)) {
        if (parseFloat(key) === target) return cached[key]
      }
      const sorted2 = Object.keys(cached).sort((a, b) => Number(a) - Number(b))
      const first2 = Number(sorted2[0])
      if (target < first2 && sorted2.length > 0) return cached[sorted2[0]]

      return null
    } catch (error) {
      logger.error({ error, seriesSlug, episodeNumber }, '[WH] getEpisodeSlug failed')
      return null
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    _mode: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      let targetEpisode = episodeNumber
      if (episodeNumber === '0') targetEpisode = '1'

      const episodeSlug = await this.getEpisodeSlug(showId, targetEpisode)
      if (!episodeSlug) {
        logger.warn({ showId, episodeNumber }, '[WH] Could not resolve episode slug')
        return null
      }

      const cacheKey = `wh_stream_${showId}_${targetEpisode}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const watchUrl = `${BASE_URL}/videos/${episodeSlug}/`
      const watchHtml = await fetchText(watchUrl)

      const plyrUrlMatch = watchHtml.match(
        /https:\/\/watchhentai\.net\/player\/\d+\/\d+\/(?:mp4|gdrive)\/?/
      )
      const jwUrlMatch = watchHtml.match(/https:\/\/watchhentai\.net\/jwplayer\/\?[^'")\s]+/)
      let playerHtml = watchHtml
      let directFallback = ''
      let playerUrl = ''

      if (plyrUrlMatch) {
        playerUrl = cleanUrl(plyrUrlMatch[0])
      } else if (jwUrlMatch) {
        playerUrl = cleanUrl(jwUrlMatch[0])
        directFallback = extractDirectSrc(playerUrl)
      }

      if (playerUrl) {
        try {
          const res = await fetch(playerUrl, {
            headers: {
              'User-Agent': UA,
              Referer: watchUrl,
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
            },
            signal: AbortSignal.timeout(30000),
          })
          if (res.ok) playerHtml = await res.text()
        } catch {
          // fall back to watch page html
        }
      }

      const links: VideoLink[] = []

      if (plyrUrlMatch) {
        const jwSourcesMatch = playerHtml.match(/var\s+whJwSources\s*=\s*(\[[\s\S]*?\])\s*;/)
        if (jwSourcesMatch) {
          try {
            const entries = JSON.parse(jwSourcesMatch[1]) as {
              file?: string
              label?: string
            }[]
            for (const entry of entries) {
              if (!entry.file) continue
              const url = whDecodeMediaUrl(entry.file)
              if (!/^https?:\/\//.test(url)) continue
              links.push({
                resolutionStr: entry.label || 'Auto',
                link: url,
                hls: url.includes('.m3u8'),
                headers: { Referer: BASE_URL + '/' },
              })
            }
          } catch {
            // fall back to plain URL extraction
          }
        }

        if (links.length === 0) {
          const seen = new Set<string>()
          const urlRe = /https?:\/\/[^"' ]+\.(?:mp4|m3u8)[^"' ]*/gi
          let vm: RegExpExecArray | null
          while ((vm = urlRe.exec(playerHtml)) !== null) {
            const url = cleanUrl(vm[0])
            if (seen.has(url)) continue
            seen.add(url)
            links.push({
              resolutionStr: url.match(/[_-](\d{3,4}p)\./)?.[1] ?? 'Auto',
              link: url,
              hls: url.includes('.m3u8'),
              headers: { Referer: BASE_URL + '/' },
            })
          }
        }
      }

      if (links.length === 0) {
        const playerData = extractPlayerData(playerHtml)
        for (const src of playerData.sources) {
          links.push({
            resolutionStr: src.label || 'Auto',
            link: src.src,
            hls:
              src.type === 'application/x-mpegURL' ||
              src.type === 'm3u8' ||
              src.src.includes('.m3u8'),
            headers: { Referer: BASE_URL + '/' },
          })
        }
      }

      if (links.length === 0 && directFallback) {
        links.push({
          resolutionStr: directFallback.match(/_(\d+p)\./)?.[1] ?? 'Auto',
          link: directFallback,
          hls: directFallback.includes('.m3u8'),
          headers: { Referer: BASE_URL + '/' },
        })
      }

      if (links.length === 0) {
        return null
      }

      const result: VideoSource[] = [
        {
          sourceName: 'WH (Direct)',
          links,
          type: 'player',
          actualEpisodeNumber: targetEpisode,
        },
      ]

      if (playerUrl) {
        result.push({
          sourceName: 'WH (Iframe)',
          links: [{ resolutionStr: 'Auto', link: playerUrl, hls: false }],
          type: 'iframe',
          actualEpisodeNumber: targetEpisode,
        })
      }

      this.cache.set(cacheKey, result, 3600)
      return result
    } catch (error) {
      logger.error({ error, showId, episodeNumber }, '[WH] getStreamUrls failed')
      return null
    }
  }
}

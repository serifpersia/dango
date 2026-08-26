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

const BASE_URL = 'https://japaneseasmr.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

interface JasmrWork {
  rjCode: string
  postId: string
  title: string
  thumbnail: string
  cv?: string
  circle?: string
  releaseDate?: string
  rating: string
  isAdult: boolean
}

function parseRatingFromClasses(classAttr: string): { rating: string; isAdult: boolean } {
  const classes = ` ${classAttr} `
  if (classes.includes(' category-sfw ')) return { rating: 'SFW', isAdult: false }
  if (classes.includes(' category-r-15 ')) return { rating: 'R-15', isAdult: false }
  if (classes.includes(' category-maniax ')) return { rating: 'R-18', isAdult: true }
  return { rating: '', isAdult: true }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, code: string) => {
      try {
        if (code.startsWith('#x') || code.startsWith('#X')) {
          return String.fromCodePoint(parseInt(code.slice(2), 16))
        }
        if (code.startsWith('#')) {
          return String.fromCodePoint(parseInt(code.slice(1), 10))
        }
        const entities: Record<string, string> = {
          amp: '&',
          lt: '<',
          gt: '>',
          quot: '"',
          apos: "'",
          nbsp: ' ',
          hellip: '\u2026',
          mdash: '\u2014',
          ndash: '\u2013',
        }
        const lower = code.toLowerCase()
        return entities[lower] ?? match
      } catch {
        return match
      }
    })
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: `${BASE_URL}/`,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.8,en;q=0.6',
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

function parseArchivePosts(html: string): JasmrWork[] {
  const works: JasmrWork[] = []
  const seen = new Set<string>()

  const chunks = html.split('<li class="site-archive-post').slice(1)
  for (const rawChunk of chunks) {
    const classEnd = rawChunk.indexOf('">')
    const classAttr = classEnd === -1 ? '' : rawChunk.slice(0, classEnd)
    const { rating, isAdult } = parseRatingFromClasses(classAttr)

    const end = rawChunk.indexOf('</li>')
    const chunk = end === -1 ? rawChunk : rawChunk.slice(0, end)

    const titleMatch = chunk.match(
      /<h2 class="entry-title"><a href="([^"]+)">([\s\S]*?)<\/a><\/h2>/
    )
    if (!titleMatch) continue

    const postUrl = titleMatch[1]
    const postIdMatch = postUrl.match(/\/(\d+)\/?/)
    if (!postIdMatch) continue

    const thumbMatch = chunk.match(/data-src="(https:\/\/pic\.weeabo0\.xyz\/[^"]+?)"/)
    let rjCode = ''
    if (thumbMatch) {
      const rjFromThumb = thumbMatch[1].match(/RJ\d{5,}/i)
      if (rjFromThumb) rjCode = rjFromThumb[0].toUpperCase()
    }
    if (!rjCode) {
      const rjFromText = chunk.match(/\[(RJ\d{5,})\]/i)
      if (rjFromText) rjCode = rjFromText[1].toUpperCase()
    }
    if (!rjCode) continue

    const cvMatch = chunk.match(/CV:\s*([^<]+)</)
    const metaMatch = chunk.match(/\[(\d{6})\]\[([^\]]+)\]/)

    const work: JasmrWork = {
      rjCode,
      postId: postIdMatch[1],
      title: decodeEntities(titleMatch[2]),
      thumbnail: thumbMatch ? thumbMatch[1] : '',
      cv: cvMatch ? decodeEntities(cvMatch[1]) : undefined,
      circle: metaMatch ? decodeEntities(metaMatch[2]) : undefined,
      releaseDate: metaMatch ? metaMatch[1] : undefined,
      rating,
      isAdult,
    }

    if (seen.has(work.rjCode)) continue
    seen.add(work.rjCode)
    works.push(work)
  }

  return works
}

function hasNextPage(html: string, page: number): boolean {
  return html.includes(`/${page + 1}/"`) || html.includes(`/page/${page + 1}/`)
}

function toProxyImage(url: string): string {
  if (!url) return ''
  return `/api/image-proxy?url=${encodeURIComponent(url)}`
}

function toShow(work: JasmrWork): Show {
  return {
    _id: work.rjCode,
    id: work.rjCode,
    name: work.title,
    englishName: work.title,
    nativeName: work.title,
    thumbnail: toProxyImage(work.thumbnail),
    description: [
      work.circle ? `Circle: ${work.circle}` : '',
      work.cv ? `CV: ${work.cv}` : '',
      work.releaseDate ? `Released: ${work.releaseDate}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    type: 'TV',
    rating: work.rating || (work.isAdult ? 'R-18' : ''),
    isAdult: work.isAdult,
    availableEpisodesDetail: { sub: ['1'], dub: [] },
    availableEpisodes: { sub: 1 },
  }
}

const ARCHIVE_PATHS: Record<string, string> = {
  sfw: 'category/rating/sfw',
  'r-15': 'category/rating/r-15',
  'r-18': 'category/rating/maniax',
  yuri: 'tag/yuri-girls-love',
  otokonoko: 'category/otokonoko',
  futanari: 'category/futanari',
  'r-18g': 'category/rating/extreme',
}

function buildArchiveUrl(query: string, page: number, sort?: string, archiveKey?: string): string {
  const params = new URLSearchParams()
  if (query) params.set('s', query)

  switch (sort) {
    case 'oldest':
      params.set('orderby', 'date')
      params.set('order', 'asc')
      break
    case 'title_asc':
      params.set('orderby', 'title')
      params.set('order', 'asc')
      break
    case 'title_desc':
      params.set('orderby', 'title')
      params.set('order', 'desc')
      break
    case 'popular_recent':
      params.set('orderby', 'post_views')
      params.set('order', 'desc')
      params.set('date', 'recent')
      break
    case 'popular_week':
      params.set('orderby', 'post_views')
      params.set('order', 'desc')
      params.set('date', 'week')
      break
    case 'popular_month':
      params.set('orderby', 'post_views')
      params.set('order', 'desc')
      params.set('date', 'month')
      break
    case 'popular_6_months':
      params.set('orderby', 'post_views')
      params.set('order', 'desc')
      params.set('date', '6_months')
      break
    case 'popular_year':
      params.set('orderby', 'post_views')
      params.set('order', 'desc')
      params.set('date', 'year')
      break
    case 'popular':
      params.set('orderby', 'post_views')
      params.set('order', 'desc')
      break
    case 'comments_week':
      params.set('orderby', 'comment_count')
      params.set('order', 'desc')
      params.set('date', 'week')
      break
    case 'comments_month':
      params.set('orderby', 'comment_count')
      params.set('order', 'desc')
      params.set('date', 'month')
      break
    case 'comments_year':
      params.set('orderby', 'comment_count')
      params.set('order', 'desc')
      params.set('date', 'year')
      break
    case 'comments':
      params.set('orderby', 'comment_count')
      params.set('order', 'desc')
      break
    case 'random':
      params.set('orderby', 'rand')
      break
    default:
      break
  }

  const queryString = params.toString()

  const archivePath = archiveKey ? ARCHIVE_PATHS[archiveKey] : undefined
  const basePath = archivePath ? `${BASE_URL}/${archivePath}` : BASE_URL
  const pageSuffix = page > 1 ? `/page/${page}/` : '/'
  return queryString ? `${basePath}${pageSuffix}?${queryString}` : `${basePath}${pageSuffix}`
}

function parseTags(html: string): string[] {
  const matches = Array.from(
    html.matchAll(/<a href="https:\/\/japaneseasmr\.com\/tag\/[^"]+"[^>]*>([^<]+)<\/a>/g)
  ).map((m) => decodeEntities(m[1]))
  return Array.from(new Set(matches)).slice(0, 15)
}

export interface JasmrChapter {
  time: number
  label: string
}

function parseChapters(html: string): JasmrChapter[] {
  const table =
    html.match(/id="plyr-chapter-playlist"[\s\S]*?<\/table>/)?.[0] ??
    html.match(/id="basic-chapter-playlist"[\s\S]*?<\/table>/)?.[0] ??
    ''

  const chapters: JasmrChapter[] = []
  const seen = new Set<string>()
  const re =
    /data-value="(\d+)"[^>]*>[^<]*<\/a>\s*<\/td>\s*<td class="chapter_list chapter_title">\s*<a[^>]*?data-track-title="([^"]*)"/g

  for (const m of html.matchAll(re)) {
    const time = parseInt(m[1], 10)
    const label = decodeEntities(m[2])
    if (!Number.isFinite(time) || !label) continue
    const key = `${time}|${label}`
    if (seen.has(key)) continue
    seen.add(key)
    chapters.push({ time, label })
  }

  return chapters
}

export class JasmrProvider implements Provider {
  name = 'JAsmr'

  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  private async fetchArchive(
    query: string,
    page: number,
    sort?: string,
    archiveKey?: string
  ): Promise<{ works: JasmrWork[]; hasNext: boolean }> {
    const url = buildArchiveUrl(query, page, sort, archiveKey)
    const html = await fetchText(url)
    return { works: parseArchivePosts(html), hasNext: hasNextPage(html, page) }
  }

  async browse(options: SearchOptions): Promise<{ shows: Show[]; hasNext: boolean }> {
    try {
      const query = (options.query || '').trim()
      const page = options.page && options.page > 0 ? options.page : 1
      const sort = options.sort || undefined
      const archiveKey =
        options.rating && ARCHIVE_PATHS[options.rating] ? options.rating : undefined
      const noCache = sort === 'random'
      const cacheKey = `jasmr_browse_${query || '__latest__'}_${page}_${sort || '__default__'}_${
        archiveKey || '__all__'
      }`
      if (!noCache) {
        const cached = this.cache.get<{ shows: Show[]; hasNext: boolean }>(cacheKey)
        if (cached) return cached
      }

      const { works, hasNext } = await this.fetchArchive(query, page, sort, archiveKey)
      const result = { shows: works.map(toShow), hasNext }
      if (!noCache) this.cache.set(cacheKey, result, 300)
      return result
    } catch (error) {
      logger.error({ error }, '[JAsmr] Browse failed')
      return { shows: [], hasNext: false }
    }
  }

  async search(options: SearchOptions): Promise<Show[]> {
    const { shows } = await this.browse(options)
    return shows
  }

  private async getWorkMeta(rjCode: string): Promise<JasmrWork | null> {
    const cacheKey = `jasmr_meta_${rjCode}`
    const cached = this.cache.get<JasmrWork>(cacheKey)
    if (cached) return cached

    const html = await fetchText(`${BASE_URL}/?s=${encodeURIComponent(rjCode)}`)
    const work = parseArchivePosts(html).find((w) => w.rjCode === rjCode) || null
    if (work) this.cache.set(cacheKey, work, 3600)
    return work
  }

  private async getPostHtml(rjCode: string): Promise<string | null> {
    const meta = await this.getWorkMeta(rjCode)
    if (!meta) return null

    const cacheKey = `jasmr_post_${meta.postId}`
    const cached = this.cache.get<string>(cacheKey)
    if (cached) return cached

    const html = await fetchText(`${BASE_URL}/${meta.postId}/`)
    this.cache.set(cacheKey, html, 600)
    return html
  }

  async getEpisodes(showId: string): Promise<EpisodeDetails | null> {
    try {
      const rjCode = showId.trim().toUpperCase()
      if (!/^RJ\d{5,}$/.test(rjCode)) return null

      const cacheKey = `jasmr_eps_${rjCode}`
      const cached = this.cache.get<EpisodeDetails>(cacheKey)
      if (cached) return cached

      let description = ''
      try {
        const meta = await this.getWorkMeta(rjCode)
        if (meta) {
          description = [
            meta.circle ? `Circle: ${meta.circle}` : '',
            meta.cv ? `CV: ${meta.cv}` : '',
            meta.releaseDate ? `Released: ${meta.releaseDate}` : '',
          ]
            .filter(Boolean)
            .join('\n')

          const postHtml = await this.getPostHtml(rjCode)
          if (postHtml) {
            const tags = parseTags(postHtml)
            if (tags.length > 0) {
              description += `\nTags: ${tags.join(', ')}`
            }
          }
        }
      } catch (err) {
        logger.warn({ err, rjCode }, '[JAsmr] Work meta lookup failed')
      }

      const result: EpisodeDetails = { episodes: ['1'], description }
      this.cache.set(cacheKey, result, 1800)
      return result
    } catch (error) {
      logger.error({ error, showId }, '[JAsmr] getEpisodes failed')
      return null
    }
  }

  async getImages(rjCodeRaw: string): Promise<string[]> {
    try {
      const rjCode = rjCodeRaw.trim().toUpperCase()
      if (!/^RJ\d{5,}$/.test(rjCode)) return []

      const cacheKey = `jasmr_images_${rjCode}`
      const cached = this.cache.get<string[]>(cacheKey)
      if (cached) return cached

      const postHtml = await this.getPostHtml(rjCode)
      if (!postHtml) return []

      const matches = Array.from(
        postHtml.matchAll(/href="(https:\/\/img\.weeabo0\.xyz\/[^"]+?\.(?:jpg|jpeg|png|webp))"/g)
      ).map((m) => m[1])
      const images = Array.from(new Set(matches))
        .filter((url) => !url.includes('_img_main'))
        .slice(0, 30)
        .map(toProxyImage)

      this.cache.set(cacheKey, images, 3600)
      return images
    } catch (error) {
      logger.error({ error, rjCode: rjCodeRaw }, '[JAsmr] getImages failed')
      return []
    }
  }

  async getChapters(rjCodeRaw: string): Promise<JasmrChapter[]> {
    try {
      const rjCode = rjCodeRaw.trim().toUpperCase()
      if (!/^RJ\d{5,}$/.test(rjCode)) return []

      const cacheKey = `jasmr_chapters_${rjCode}`
      const cached = this.cache.get<JasmrChapter[]>(cacheKey)
      if (cached) return cached

      const postHtml = await this.getPostHtml(rjCode)
      if (!postHtml) return []

      const chapters = parseChapters(postHtml)
      this.cache.set(cacheKey, chapters, 3600)
      return chapters
    } catch (error) {
      logger.error({ error, rjCode: rjCodeRaw }, '[JAsmr] getChapters failed')
      return []
    }
  }

  async getStreamUrls(
    showId: string,
    episodeNumber: string,
    _mode?: 'sub' | 'dub'
  ): Promise<VideoSource[] | null> {
    try {
      const rjCode = showId.trim().toUpperCase()
      if (!/^RJ\d{5,}$/.test(rjCode)) {
        logger.warn({ showId }, '[JAsmr] Invalid RJ code')
        return null
      }

      const cacheKey = `jasmr_stream_${rjCode}_${episodeNumber}`
      const cached = this.cache.get<VideoSource[]>(cacheKey)
      if (cached) return cached

      const meta = await this.getWorkMeta(rjCode)
      if (!meta) {
        logger.warn({ rjCode }, '[JAsmr] Could not resolve post page')
        return null
      }

      const html = (await this.getPostHtml(rjCode)) || ''

      const toProxy = (rawUrl: string): string =>
        `/api/proxy?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(`${BASE_URL}/`)}`

      const links: VideoLink[] = []

      const m3u8Match = html.match(/<source src="(https:\/\/v\.weeab0o\.xyz\/[^"]+\.m3u8)"/)
      const audioSrcMatch = html.match(/audioSrc\s*=\s*'(https:\/\/[^']+\.m3u8)'/)
      const streamUrl = m3u8Match?.[1] || audioSrcMatch?.[1]
      if (streamUrl) {
        links.push({ resolutionStr: 'Audio', link: toProxy(streamUrl), hls: true })
      } else {
        const mp3Matches = Array.from(
          html.matchAll(/<source src="(https:\/\/v\.weeab0o\.xyz\/[^"]+\.mp3)"/g)
        ).map((m) => m[1])
        const uniqueMp3s = Array.from(new Set(mp3Matches))
        if (uniqueMp3s.length === 0) {
          logger.warn(
            { rjCode, postId: meta.postId },
            '[JAsmr] No audio sources found on post page'
          )
          return null
        }
        uniqueMp3s.forEach((mp3Url, i) => {
          links.push({ resolutionStr: `Track ${i + 1}`, link: toProxy(mp3Url), hls: false })
        })
      }

      const result: VideoSource[] = [
        {
          sourceName: this.name,
          links,
          type: 'player',
          actualEpisodeNumber: episodeNumber || '1',
        },
      ]

      this.cache.set(cacheKey, result, 3600)
      return result
    } catch (error) {
      logger.error({ error, showId, episodeNumber }, '[JAsmr] getStreamUrls failed')
      return null
    }
  }
}

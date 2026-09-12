import NodeCache from 'node-cache'
import * as cheerio from 'cheerio'
import logger from '../../logger'
import type {
  MangaCard,
  MangaChapter,
  MangaDetail,
  MangaProvider,
  MangaSearchOptions,
} from './manga.types'

const BASE = 'https://www.mangapill.com'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Referer: `${BASE}/`,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`MangaPill HTTP ${res.status}: ${url}`)
  return res.text()
}

function mangaIdFromHref(href: string): string {
  const m = href.match(/^\/manga\/(\d+)/)
  return m ? m[1] : href
}

export class MangaPillProvider implements MangaProvider {
  name = 'mangapill' as const
  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  async search(options: MangaSearchOptions) {
    const { query = '', type = '', status = '' } = options
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (type) params.set('type', type)
    if (status) params.set('status', status)
    if ([...params.keys()].length === 0) {
      params.set('type', 'manga')
    }
    const cacheKey = `manga-pill-search-${params.toString()}`
    const cached = this.cache.get<{ items: MangaCard[]; hasNext: boolean }>(cacheKey)
    if (cached) return cached
    try {
      const html = await fetchHtml(`${BASE}/search?${params.toString()}`)
      const $ = cheerio.load(html)
      const hrefs = new Set<string>()
      $('a[href^="/manga/"]').each((_, el) => {
        const href = $(el).attr('href') || ''
        if (/^\/manga\/\d+\//.test(href)) hrefs.add(href)
      })
      const items: MangaCard[] = []
      for (const href of hrefs) {
        const id = mangaIdFromHref(href)
        const anchors = $(`a[href="${href}"]`)
        let title = ''
        let cover = ''
        anchors.each((_, el) => {
          const t = $(el).find('.line-clamp-2').first().text().trim()
          if (t && !title) title = t
          const img = $(el).find('img[data-src], img[src]').first()
          if (img.length && !cover) cover = img.attr('data-src') || img.attr('src') || ''
        })
        const scope = anchors.first().parent()
        const badges = scope
          .find('.bg-purple-500, .bg-orange-500, .bg-green-500')
          .map((__, b) => $(b).text().trim())
          .get()
        const genres = scope
          .find('.bg-card.rounded')
          .map((__, g) => $(g).text().trim())
          .get()
          .filter(Boolean)
        items.push({
          id,
          provider: 'mangapill',
          title: title || `Manga ${id}`,
          cover: cover.startsWith('http') ? cover : cover ? `${BASE}${cover}` : '',
          type: badges[0],
          year: badges[1] ? parseInt(badges[1]) || null : null,
          status: badges[2],
          genres: genres.slice(0, 6),
        })
      }
      const result = { items, hasNext: false }
      this.cache.set(cacheKey, result, 300)
      return result
    } catch (err) {
      logger.error({ err }, '[MangaPill] search failed')
      return { items: [], hasNext: false }
    }
  }

  async getDetail(id: string): Promise<MangaDetail | null> {
    const cacheKey = `manga-pill-detail-${id}`
    const cached = this.cache.get<MangaDetail>(cacheKey)
    if (cached) return cached
    try {
      const html = await fetchHtml(`${BASE}/manga/${id}`)
      const $ = cheerio.load(html)
      const title = $('h1').first().text().trim() || `Manga ${id}`
      const cover =
        $('img[data-src], img[src]')
          .map((_, img) => $(img).attr('data-src') || $(img).attr('src') || '')
          .get()
          .find((s) => s.includes('mangapill') || s.includes('readdetectiveconan')) || ''
      const description = $('.text-secondary').first().text().trim().slice(0, 2000) || undefined
      const chapters = this.parseChapters($, id)
      const detail: MangaDetail = {
        id,
        provider: 'mangapill',
        title,
        cover,
        description,
        chapters,
      }
      this.cache.set(cacheKey, detail, 600)
      return detail
    } catch (err) {
      logger.error({ err, id }, '[MangaPill] detail failed')
      return null
    }
  }

  async getChapters(id: string): Promise<MangaChapter[]> {
    const detail = await this.getDetail(id)
    return detail?.chapters || []
  }

  private parseChapters($: cheerio.CheerioAPI, mangaId: string): MangaChapter[] {
    const chapters: MangaChapter[] = []
    const seen = new Set<string>()
    $('a[href^="/chapters/"]').each((_, el) => {
      const href = $(el).attr('href') || ''
      const m = href.match(/^\/chapters\/(\d+)-(\d+)\/(.*)-chapter-([\d.]+)$/)
      if (!m) return
      if (seen.has(href)) return
      seen.add(href)
      const label = $(el).text().trim().replace(/\s+/g, ' ')
      chapters.push({
        id: href.replace(/^\//, ''),
        provider: 'mangapill',
        mangaId,
        number: m[4],
        title: label && !/^chapter\s*[\d.]+$/i.test(label) ? label : undefined,
      })
    })
    chapters.sort((a, b) => {
      const na = parseFloat(a.number)
      const nb = parseFloat(b.number)
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
      return a.number.localeCompare(b.number, undefined, { numeric: true })
    })
    return chapters
  }

  async getPages(chapterId: string): Promise<string[]> {
    const cacheKey = `manga-pill-pages-${chapterId}`
    const cached = this.cache.get<string[]>(cacheKey)
    if (cached) return cached
    try {
      const path = chapterId.startsWith('chapters/') ? `/${chapterId}` : `/chapters/${chapterId}`
      const html = await fetchHtml(`${BASE}${path}`)
      const $ = cheerio.load(html)
      const pages: string[] = []
      $('picture img').each((_, img) => {
        const src = $(img).attr('data-src') || $(img).attr('src') || ''
        if (/cdn\.readdetectiveconan\.com\/file\/mangap\//.test(src)) pages.push(src)
      })
      if (pages.length === 0) {
        $('img').each((_, img) => {
          const src = $(img).attr('data-src') || $(img).attr('src') || ''
          if (/cdn\.readdetectiveconan\.com\/file\/mangap\//.test(src) && !pages.includes(src)) {
            pages.push(src)
          }
        })
      }
      this.cache.set(cacheKey, pages, 1800)
      return pages
    } catch (err) {
      logger.error({ err, chapterId }, '[MangaPill] pages failed')
      return []
    }
  }
}

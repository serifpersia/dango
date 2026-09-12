import NodeCache from 'node-cache'
import logger from '../../logger'
import type {
  MangaCard,
  MangaChapter,
  MangaContentRating,
  MangaDetail,
  MangaProvider,
  MangaSearchOptions,
} from './manga.types'

const API = 'https://api.mangadex.org'
const UA = 'Dango/3.0 (+https://github.com/serifpersia/dango)'

const PER_PAGE = 24

function pickTitle(titles: Record<string, string> | undefined): string {
  if (!titles) return 'Unknown'
  return titles.en || titles['ja-ro'] || Object.values(titles)[0] || 'Unknown'
}

function coverFromRelationships(
  id: string,
  rels: Array<{ type: string; attributes?: { fileName?: string } }>
): string {
  const cover = rels?.find((r) => r.type === 'cover_art')
  const fileName = cover?.attributes?.fileName
  if (!fileName) return ''
  return `https://uploads.mangadex.org/covers/${id}/${fileName}.256.jpg`
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw new Error(`MangaDex HTTP ${res.status}: ${url}`)
  return res.json() as Promise<T>
}

function cleanDescription(raw: string): string {
  return raw
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, (m) => {
      const text = m.slice(m.indexOf('[') + 1, m.indexOf(']'))
      return text || ''
    })
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return t && !t.startsWith('|') && !/^\|\s*:?-+/.test(t) && t !== '---'
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+/g, (s) => (s.includes('\n') ? s : ' '))
    .trim()
    .slice(0, 2000)
}

interface MdListResponse {
  data: Array<{
    id: string
    attributes: {
      title: Record<string, string>
      altTitles?: Record<string, string>[]
      description?: Record<string, string>
      status?: string
      year?: number | null
      contentRating?: string
      tags?: Array<{ attributes?: { name?: Record<string, string>; group?: string } }>
    }
    relationships?: Array<{ type: string; attributes?: { fileName?: string; name?: string } }>
  }>
  total?: number
  limit?: number
  offset?: number
}

interface MdFeedResponse {
  data: Array<{
    id: string
    attributes: {
      chapter?: string | null
      title?: string | null
      volume?: string | null
      translatedLanguage?: string
      externalUrl?: string | null
      pages?: number
      publishAt?: string
    }
    relationships?: Array<{ type: string; attributes?: { name?: string } }>
  }>
  total?: number
}

function toCard(m: MdListResponse['data'][number]): MangaCard {
  const a = m.attributes
  const alt = a.altTitles?.[0] ? Object.values(a.altTitles[0])[0] : undefined
  return {
    id: m.id,
    provider: 'mangadex',
    title: pickTitle(a.title),
    altTitle: alt,
    cover: coverFromRelationships(m.id, m.relationships || []),
    status: a.status,
    year: a.year ?? null,
    genres:
      a.tags
        ?.filter((t) => t.attributes?.group === 'genre')
        .map((t) => t.attributes?.name?.en || '')
        .filter(Boolean)
        .slice(0, 6) || [],
    contentRating: a.contentRating,
  }
}

export class MangaDexProvider implements MangaProvider {
  name = 'mangadex' as const
  private cache: NodeCache

  constructor(cache: NodeCache) {
    this.cache = cache
  }

  async search(options: MangaSearchOptions) {
    const { query = '', page = 1, limit = PER_PAGE, sort = 'popular', ratings = ['safe'] } = options
    const offset = (Math.max(1, page) - 1) * limit
    const params = new URLSearchParams({
      limit: String(Math.min(limit, 50)),
      offset: String(offset),
      'includes[]': 'cover_art',
      hasAvailableChapters: 'true',
    })
    if (query.trim()) params.set('title', query.trim())
    for (const r of ratings) params.append('contentRating[]', r)
    if (options.status) params.append('status[]', options.status)
    switch (sort) {
      case 'latest':
        params.set('order[latestUploadedChapter]', 'desc')
        break
      case 'rating':
        params.set('order[rating]', 'desc')
        break
      case 'followed':
        params.set('order[followedCount]', 'desc')
        break
      default:
        params.set('order[relevance]', 'desc')
    }
    const cacheKey = `manga-md-search-${params.toString()}`
    const cached = this.cache.get<{ items: MangaCard[]; hasNext: boolean; total?: number }>(
      cacheKey
    )
    if (cached) return cached
    try {
      const data = await getJson<MdListResponse>(`${API}/manga?${params.toString()}`)
      const items = (data.data || []).map(toCard)
      const total = data.total ?? 0
      const result = { items, hasNext: offset + items.length < total, total }
      this.cache.set(cacheKey, result, 300)
      return result
    } catch (err) {
      logger.error({ err }, '[MangaDex] search failed')
      return { items: [], hasNext: false }
    }
  }

  async getDetail(
    id: string,
    ratings: MangaContentRating[] = ['safe']
  ): Promise<MangaDetail | null> {
    const cacheKey = `manga-md-detail-${id}-${ratings.join(',')}`
    const cached = this.cache.get<MangaDetail>(cacheKey)
    if (cached) return cached
    try {
      const data = await getJson<{ data: MdListResponse['data'][number] }>(
        `${API}/manga/${id}?includes[]=cover_art&includes[]=author&includes[]=artist`
      )
      const m = data.data
      if (!m) return null
      const card = toCard(m)
      const rels = m.relationships || []
      const author = rels.find((r) => r.type === 'author')?.attributes?.name
      const artist = rels.find((r) => r.type === 'artist')?.attributes?.name
      const chapters = await this.getChapters(id, ratings)
      const detail: MangaDetail = {
        ...card,
        description: cleanDescription(m.attributes.description?.en || ''),
        author,
        artist,
        chapters,
      }
      this.cache.set(cacheKey, detail, 600)
      return detail
    } catch (err) {
      logger.error({ err, id }, '[MangaDex] detail failed')
      return null
    }
  }

  async getChapters(id: string, ratings: MangaContentRating[] = ['safe']): Promise<MangaChapter[]> {
    const cacheKey = `manga-md-chapters-${id}-${ratings.join(',')}`
    const cached = this.cache.get<MangaChapter[]>(cacheKey)
    if (cached) return cached
    try {
      const params = new URLSearchParams({
        limit: '100',
        offset: '0',
        'translatedLanguage[]': 'en',
        'order[chapter]': 'asc',
        'includes[]': 'scanlation_group',
      })
      for (const r of ratings) params.append('contentRating[]', r)
      const all: MangaChapter[] = []
      const fetchFeed = async (withLang: boolean) => {
        const out: MangaChapter[] = []
        for (let page = 0; page < 5; page++) {
          const p = new URLSearchParams(params)
          if (!withLang) p.delete('translatedLanguage[]')
          p.set('offset', String(page * 100))
          const data = await getJson<MdFeedResponse>(`${API}/manga/${id}/feed?${p.toString()}`)
          for (const c of data.data || []) {
            const group = c.relationships?.find((r) => r.type === 'scanlation_group')?.attributes
              ?.name
            out.push({
              id: c.id,
              provider: 'mangadex',
              mangaId: id,
              number: c.attributes.chapter || '?',
              title: c.attributes.title || undefined,
              volume: c.attributes.volume || undefined,
              language: c.attributes.translatedLanguage,
              pages: c.attributes.pages,
              group,
              externalUrl: c.attributes.externalUrl || undefined,
              publishedAt: c.attributes.publishAt,
            })
          }
          if ((data.data || []).length < 100) break
        }
        return out
      }
      const enChapters = await fetchFeed(true)
      for (const c of enChapters) all.push(c)
      if (all.length === 0) {
        for (const c of await fetchFeed(false)) all.push(c)
      }
      this.cache.set(cacheKey, all, 600)
      return all
    } catch (err) {
      logger.error({ err, id }, '[MangaDex] chapters failed')
      return []
    }
  }

  async getPages(chapterId: string): Promise<string[]> {
    const cacheKey = `manga-md-pages-${chapterId}`
    const cached = this.cache.get<string[]>(cacheKey)
    if (cached) return cached
    try {
      const data = await getJson<{ baseUrl: string; chapter: { hash: string; data: string[] } }>(
        `${API}/at-home/server/${chapterId}`
      )
      const pages = (data.chapter?.data || []).map(
        (f) => `${data.baseUrl}/data/${data.chapter.hash}/${f}`
      )
      this.cache.set(cacheKey, pages, 300)
      return pages
    } catch (err) {
      logger.error({ err, chapterId }, '[MangaDex] pages failed')
      return []
    }
  }
}

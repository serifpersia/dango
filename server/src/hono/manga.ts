import type { Hono, Context } from 'hono'
import type { AppCache } from '../utils/cache.utils.js'
import logger from '../logger.js'
import { parseJsonBody } from '../utils/http.utils.js'
import type {
  MangaContentRating,
  MangaProviderName,
  MangaProvider,
} from '../providers/manga/manga.types.js'

const SAFE: MangaContentRating[] = ['safe']

function parseRatings(query: Record<string, string | undefined>): MangaContentRating[] {
  const mature = query['mature'] === '1'
  const raw = String(query['rating'] || 'safe')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is MangaContentRating =>
      ['safe', 'suggestive', 'erotica', 'pornographic'].includes(s)
    )
  if (!mature) return SAFE
  const exact = [...new Set(raw)]
  return exact.length > 0 ? exact : SAFE
}

async function cached(
  c: Context,
  cache: AppCache,
  key: string,
  ttl: number | undefined,
  produce: () => Promise<{ status?: number; body: unknown }>
): Promise<Response> {
  const hit = cache.get<unknown>(key)
  if (hit) return c.json(hit)
  const result = await produce()
  const status = result.status ?? 200
  if (status >= 200 && status < 400) {
    if (ttl !== undefined) cache.set(key, result.body, ttl)
    else cache.set(key, result.body)
  }
  return c.json(result.body, status as 200)
}

export function registerManga(
  app: Hono,
  getApiCache: () => AppCache,
  getProvider: (name: string) => MangaProvider | undefined
) {
  const pick = (name: string): MangaProvider | undefined => getProvider(name.toLowerCase())

  app.get('/api/manga/search', async (c) => {
    const qp = (name: string) => c.req.query(name) || ''
    return cached(
      c,
      getApiCache(),
      `route-manga-search-${qp('provider')}-${qp('q')}-${c.req.query('page') || 1}-${qp('sort')}-${qp('status')}-${qp('type')}-${qp('rating')}-${qp('mature')}`,
      300,
      async () => {
        try {
          const ratings = parseRatings({ rating: qp('rating'), mature: qp('mature') })
          const rawType = qp('type')
          const type = rawType === 'doujinshi' && qp('mature') !== '1' ? '' : rawType
          const options = {
            query: qp('q'),
            page: parseInt(c.req.query('page') as string) || 1,
            limit: Math.min(parseInt(c.req.query('limit') as string) || 24, 50),
            sort: qp('sort') || 'popular',
            status: qp('status'),
            type,
            ratings,
          }
          const result = await pick(qp('provider') as string as MangaProviderName)?.search(options)
          return { body: result ?? { items: [], hasNext: false } }
        } catch (err) {
          logger.error({ err }, '[Manga] search failed')
          return { body: { items: [], hasNext: false } }
        }
      }
    )
  })

  app.get('/api/manga/info', async (c) => {
    const provider = String(c.req.query('provider') || '')
    const id = String(c.req.query('id') || '')
    const rating = String(c.req.query('rating') || '')
    const mature = String(c.req.query('mature') || '')
    return cached(
      c,
      getApiCache(),
      `route-manga-info-${provider}-${id}-${rating}-${mature}`,
      600,
      async () => {
        try {
          if (!id) return { status: 400, body: { error: 'Missing id' } }
          const detail = await pick(provider as string as MangaProviderName)?.getDetail(
            id,
            parseRatings({ rating, mature })
          )
          if (!detail) return { status: 404, body: { error: 'Not found' } }
          return { body: detail }
        } catch (err) {
          logger.error({ err }, '[Manga] info failed')
          return { status: 500, body: { error: 'Failed to load manga' } }
        }
      }
    )
  })

  app.get('/api/manga/chapters', async (c) => {
    const provider = String(c.req.query('provider') || '')
    const id = String(c.req.query('id') || '')
    const rating = String(c.req.query('rating') || '')
    const mature = String(c.req.query('mature') || '')
    return cached(
      c,
      getApiCache(),
      `route-manga-chapters-${provider}-${id}-${rating}-${mature}`,
      600,
      async () => {
        try {
          if (!id) return { status: 400, body: { error: 'Missing id' } }
          const chapters =
            (await pick(provider as string as MangaProviderName)?.getChapters(
              id,
              parseRatings({ rating, mature })
            )) ?? []
          return { body: { chapters } }
        } catch (err) {
          logger.error({ err }, '[Manga] chapters failed')
          return { body: { chapters: [] } }
        }
      }
    )
  })

  app.get('/api/manga/pages', async (c) => {
    const provider = String(c.req.query('provider') || '')
    const id = String(c.req.query('id') || '')
    return cached(c, getApiCache(), `route-manga-pages-${provider}-${id}`, 300, async () => {
      try {
        if (!id) return { status: 400, body: { error: 'Missing id' } }
        const pages = (await pick(provider as string as MangaProviderName)?.getPages(id)) ?? []
        return { body: { pages } }
      } catch (err) {
        logger.error({ err }, '[Manga] pages failed')
        return { body: { pages: [] } }
      }
    })
  })

  app.get('/api/manga/trending', async (c) => {
    return cached(c, getApiCache(), 'route-manga-trending', 600, async () => {
      try {
        const url =
          'https://api.mangadex.org/manga?limit=6&order%5BfollowedCount%5D=desc&includes%5B%5D=cover_art&contentRating%5B%5D=safe&contentRating%5B%5D=suggestive'
        const upstream = await fetch(url, {
          headers: { 'User-Agent': 'dango/3.1.9' },
        })
        if (!upstream.ok) return { body: [] }
        const data = (await parseJsonBody(upstream)) as {
          data?: Array<{
            id: string
            attributes?: {
              title?: Record<string, string>
              description?: Record<string, string>
              tags?: Array<{ attributes?: { name?: Record<string, string> } }>
              year?: number
              status?: string
            }
            relationships?: Array<{
              type: string
              attributes?: { fileName?: string }
            }>
          }>
        }
        const results = (data.data || []).map((m) => {
          const title = m.attributes?.title?.en || Object.values(m.attributes?.title || {})[0] || ''
          const desc = m.attributes?.description?.en || ''
          const tags = (m.attributes?.tags || []).map((t) => t.attributes?.name?.en).filter(Boolean)
          const coverArt = m.relationships?.find((r) => r.type === 'cover_art')
          const fileName = coverArt?.attributes?.fileName
          const cover = fileName
            ? `https://uploads.mangadex.org/covers/${m.id}/${fileName}.512.jpg`
            : ''
          return {
            id: m.id,
            title,
            description: desc,
            tags,
            year: m.attributes?.year || null,
            status: m.attributes?.status || null,
            cover,
          }
        })
        return { body: results }
      } catch (err) {
        logger.error({ err }, '[Manga] trending failed')
        return { body: [] }
      }
    })
  })
}

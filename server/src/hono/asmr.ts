import type { Hono, Context } from 'hono'
import type { AppCache } from '../utils/cache.utils.js'
import logger from '../logger.js'

export interface JasmrApi {
  browse(o: { query?: string; page?: number; sort?: string; rating?: string }): Promise<unknown>
  getEpisodes(showId: string): Promise<{ description?: string } | null>
  getStreamUrls(showId: string, episode: string): Promise<{ links: unknown[] }[] | null>
  getImages(showId: string): Promise<unknown>
  getChapters(showId: string): Promise<unknown>
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

export function registerAsmr(
  app: Hono,
  getApiCache: () => AppCache,
  getProvider: () => JasmrApi | undefined
) {
  app.get('/api/asmr/browse', async (c) => {
    const q = c.req.query('q') || ''
    const page = c.req.query('page') || 1
    const sort = c.req.query('sort') || ''
    const rating = c.req.query('rating') || ''
    return cached(
      c,
      getApiCache(),
      `route-asmr-browse-${q}-${page}-${sort}-${rating}-${sort === 'random' ? Date.now() : ''}`,
      300,
      async () => {
        try {
          const provider = getProvider()
          if (!provider) return { body: { shows: [], hasNext: false } }
          const result = await provider.browse({
            query: q as string,
            page: parseInt(page as string) || 1,
            sort: sort as string,
            rating: rating as string,
          })
          return { body: result }
        } catch (err) {
          if ((err as Error).message === 'AUTH_REQUIRED') {
            return { status: 403, body: { error: 'AUTH_REQUIRED', provider: 'jasmr' } }
          }
          logger.error({ err }, '[Asmr] browse failed')
          return { body: { shows: [], hasNext: false } }
        }
      }
    )
  })

  app.get('/api/asmr/work/:rj', async (c) => {
    const rj = c.req.param('rj')
    return cached(c, getApiCache(), `route-asmr-work-${rj}`, 1800, async () => {
      try {
        const provider = getProvider()
        if (!provider) {
          return {
            body: {
              rjCode: rj,
              description: '',
              tracks: [],
              images: [],
              chapters: [],
            },
          }
        }
        const rjCode = String(rj).trim().toUpperCase()
        const episodes = await provider.getEpisodes(rjCode)
        const [streams, images, chapters] = await Promise.all([
          provider.getStreamUrls(rjCode, '1'),
          provider.getImages(rjCode),
          provider.getChapters(rjCode),
        ])
        return {
          body: {
            rjCode,
            description: episodes?.description || '',
            tracks: streams?.[0]?.links || [],
            images,
            chapters,
          },
        }
      } catch (err) {
        if ((err as Error).message === 'AUTH_REQUIRED') {
          return { status: 403, body: { error: 'AUTH_REQUIRED', provider: 'jasmr' } }
        }
        logger.error({ err, rj }, '[Asmr] work fetch failed')
        return { body: { rjCode: rj, description: '', tracks: [], images: [], chapters: [] } }
      }
    })
  })
}

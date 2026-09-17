import { Router, Request, Response } from 'express'
import { AppCache } from '../utils/cache.utils.js'
import logger from '../logger.js'

export interface JasmrApi {
  browse(o: { query?: string; page?: number; sort?: string; rating?: string }): Promise<unknown>
  getEpisodes(showId: string): Promise<{ description?: string } | null>
  getStreamUrls(showId: string, episode: string): Promise<{ links: unknown[] }[] | null>
  getImages(showId: string): Promise<unknown>
  getChapters(showId: string): Promise<unknown>
}

function makeCacheMiddleware(cache: AppCache, keyFn: (req: Request) => string, ttl?: number) {
  return (req: Request, res: Response, next: () => void) => {
    const cacheKey = keyFn(req)
    const cached = cache.get(cacheKey)
    if (cached) return res.json(cached)

    const originalJson = res.json.bind(res)
    res.json = (data: unknown) => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        if (ttl !== undefined) cache.set(cacheKey, data, ttl)
        else cache.set(cacheKey, data)
      }
      return originalJson(data)
    }
    next()
  }
}

export function createAsmrRouter(
  apiCache: AppCache,
  getProvider: () => JasmrApi | undefined
): Router {
  const router = Router()

  router.get(
    '/asmr/browse',
    makeCacheMiddleware(
      apiCache,
      (req) =>
        `route-asmr-browse-${req.query.q || ''}-${req.query.page || 1}-${req.query.sort || ''}-${
          req.query.rating || ''
        }-${req.query.sort === 'random' ? Date.now() : ''}`,
      300
    ),
    async (req, res) => {
      try {
        const provider = getProvider()
        if (!provider) return res.json({ shows: [], hasNext: false })
        const result = await provider.browse({
          query: req.query.q as string,
          page: parseInt(req.query.page as string) || 1,
          sort: req.query.sort as string,
          rating: req.query.rating as string,
        })
        res.json(result)
      } catch (err) {
        if ((err as Error).message === 'AUTH_REQUIRED') {
          return res.status(403).json({ error: 'AUTH_REQUIRED', provider: 'jasmr' })
        }
        logger.error({ err }, '[Asmr] browse failed')
        res.json({ shows: [], hasNext: false })
      }
    }
  )

  router.get(
    '/asmr/work/:rj',
    makeCacheMiddleware(apiCache, (req) => `route-asmr-work-${req.params.rj}`, 1800),
    async (req, res) => {
      try {
        const provider = getProvider()
        if (!provider) {
          return res.json({
            rjCode: req.params.rj,
            description: '',
            tracks: [],
            images: [],
            chapters: [],
          })
        }
        const rjCode = String(req.params.rj).trim().toUpperCase()
        const episodes = await provider.getEpisodes(rjCode)
        const streams = await provider.getStreamUrls(rjCode, '1')
        const images = await provider.getImages(rjCode)
        const chapters = await provider.getChapters(rjCode)
        res.json({
          rjCode,
          description: episodes?.description || '',
          tracks: streams?.[0]?.links || [],
          images,
          chapters,
        })
      } catch (err) {
        if ((err as Error).message === 'AUTH_REQUIRED') {
          return res.status(403).json({ error: 'AUTH_REQUIRED', provider: 'jasmr' })
        }
        logger.error({ err, rj: req.params.rj }, '[Asmr] work fetch failed')
        res.json({ rjCode: req.params.rj, description: '', tracks: [], images: [], chapters: [] })
      }
    }
  )

  return router
}

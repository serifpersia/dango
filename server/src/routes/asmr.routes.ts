import { Router, Request, Response } from 'express'
import NodeCache from 'node-cache'
import { JasmrProvider } from '../providers/jasmr.provider'
import logger from '../logger'

function makeCacheMiddleware(cache: NodeCache, keyFn: (req: Request) => string, ttl?: number) {
  return (req: Request, res: Response, next: () => void) => {
    const cacheKey = keyFn(req)
    const cached = cache.get(cacheKey)
    if (cached) return res.json(cached)

    const originalJson = res.json.bind(res)
    res.json = (data: unknown) => {
      if (ttl !== undefined) cache.set(cacheKey, data, ttl)
      else cache.set(cacheKey, data)
      return originalJson(data)
    }
    next()
  }
}

export function createAsmrRouter(apiCache: NodeCache, provider: JasmrProvider): Router {
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
        const result = await provider.browse({
          query: req.query.q as string,
          page: parseInt(req.query.page as string) || 1,
          sort: req.query.sort as string,
          rating: req.query.rating as string,
        })
        res.json(result)
      } catch (err) {
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
        logger.error({ err, rj: req.params.rj }, '[Asmr] work fetch failed')
        res.json({ rjCode: req.params.rj, description: '', tracks: [], images: [], chapters: [] })
      }
    }
  )

  return router
}

import { Router, Request, Response } from 'express'
import NodeCache from 'node-cache'
import logger from '../logger'
import { MangaDexProvider } from '../providers/manga/mangadex.provider'
import { MangaPillProvider } from '../providers/manga/mangapill.provider'
import type { MangaContentRating, MangaProviderName } from '../providers/manga/manga.types'

function makeCacheMiddleware(cache: NodeCache, keyFn: (req: Request) => string, ttl?: number) {
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

const SAFE: MangaContentRating[] = ['safe']

function parseRatings(req: Request): MangaContentRating[] {
  const mature = req.query.mature === '1'
  const raw = String(req.query.rating || 'safe')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is MangaContentRating =>
      ['safe', 'suggestive', 'erotica', 'pornographic'].includes(s)
    )
  if (!mature) return SAFE
  const exact = [...new Set(raw)]
  return exact.length > 0 ? exact : SAFE
}

export function createMangaRouter(apiCache: NodeCache): Router {
  const router = Router()
  const dex = new MangaDexProvider(apiCache)
  const pill = new MangaPillProvider(apiCache)

  const pick = (name: string) => (name === 'mangapill' ? pill : dex)

  router.get(
    '/manga/search',
    makeCacheMiddleware(
      apiCache,
      (req) =>
        `route-manga-search-${req.query.provider || ''}-${req.query.q || ''}-${req.query.page || 1}-${req.query.sort || ''}-${req.query.status || ''}-${req.query.type || ''}-${req.query.rating || ''}-${req.query.mature || ''}`,
      300
    ),
    async (req, res) => {
      try {
        const provider = req.query.provider as string as MangaProviderName
        const ratings = parseRatings(req)
        const rawType = (req.query.type as string) || ''
        const type = rawType === 'doujinshi' && req.query.mature !== '1' ? '' : rawType
        const options = {
          query: (req.query.q as string) || '',
          page: parseInt(req.query.page as string) || 1,
          limit: Math.min(parseInt(req.query.limit as string) || 24, 50),
          sort: (req.query.sort as string) || 'popular',
          status: (req.query.status as string) || '',
          type,
          ratings,
        }
        const result = await pick(provider).search(options)
        res.json(result)
      } catch (err) {
        logger.error({ err }, '[Manga] search failed')
        res.json({ items: [], hasNext: false })
      }
    }
  )

  router.get(
    '/manga/info',
    makeCacheMiddleware(
      apiCache,
      (req) =>
        `route-manga-info-${req.query.provider || ''}-${req.query.id || ''}-${req.query.rating || ''}-${req.query.mature || ''}`,
      600
    ),
    async (req, res) => {
      try {
        const provider = req.query.provider as string as MangaProviderName
        const id = String(req.query.id || '')
        if (!id) return res.status(400).json({ error: 'Missing id' })
        const detail = await pick(provider).getDetail(id, parseRatings(req))
        if (!detail) return res.status(404).json({ error: 'Not found' })
        res.json(detail)
      } catch (err) {
        logger.error({ err }, '[Manga] info failed')
        res.status(500).json({ error: 'Failed to load manga' })
      }
    }
  )

  router.get(
    '/manga/chapters',
    makeCacheMiddleware(
      apiCache,
      (req) =>
        `route-manga-chapters-${req.query.provider || ''}-${req.query.id || ''}-${req.query.rating || ''}-${req.query.mature || ''}`,
      600
    ),
    async (req, res) => {
      try {
        const provider = req.query.provider as string as MangaProviderName
        const id = String(req.query.id || '')
        if (!id) return res.status(400).json({ error: 'Missing id' })
        const chapters = await pick(provider).getChapters(id, parseRatings(req))
        res.json({ chapters })
      } catch (err) {
        logger.error({ err }, '[Manga] chapters failed')
        res.json({ chapters: [] })
      }
    }
  )

  router.get(
    '/manga/pages',
    makeCacheMiddleware(
      apiCache,
      (req) => `route-manga-pages-${req.query.provider || ''}-${req.query.id || ''}`,
      300
    ),
    async (req, res) => {
      try {
        const provider = req.query.provider as string as MangaProviderName
        const id = String(req.query.id || '')
        if (!id) return res.status(400).json({ error: 'Missing id' })
        const pages = await pick(provider).getPages(id)
        res.json({ pages })
      } catch (err) {
        logger.error({ err }, '[Manga] pages failed')
        res.json({ pages: [] })
      }
    }
  )

  return router
}

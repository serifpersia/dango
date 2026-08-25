import { Router, Request, Response, NextFunction } from 'express'
import { DataController } from '../controllers/data.controller'
import { Provider } from '../providers/provider.interface'
import NodeCache from 'node-cache'

function makeCacheMiddleware(
  cache: NodeCache,
  keyFn: (req: Request) => string,
  ttl?: number,
  validate: (data: unknown) => boolean = (d) => Array.isArray(d) && d.length > 0
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const cacheKey = keyFn(req)
    const cached = cache.get(cacheKey)
    if (cached) return res.json(cached)

    const originalJson = res.json.bind(res)
    res.json = (data: unknown) => {
      if (validate(data)) {
        if (ttl !== undefined) {
          cache.set(cacheKey, data, ttl)
        } else {
          cache.set(cacheKey, data)
        }
      }
      return originalJson(data)
    }
    next()
  }
}

export function createDataRouter(
  apiCache: NodeCache,
  providers: { [key: string]: Provider }
): Router {
  const router = Router()
  const controller = new DataController(providers)

  router.get(
    '/schedule/:date',
    makeCacheMiddleware(
      apiCache,
      (req) => `schedule-${req.params.date}-${req.query.format || 'TV'}`,
      1800
    ),
    controller.getSchedule
  )

  router.get(
    '/latest-releases',
    makeCacheMiddleware(
      apiCache,
      (req) =>
        `latest-releases-${req.query.format || 'TV'}-${req.query.page || 1}-${req.query.size || 12}`,
      300
    ),
    controller.getLatestReleases
  )

  router.get(
    '/search',
    makeCacheMiddleware(apiCache, (req) => `search-${JSON.stringify(req.query)}`, 1800),
    controller.search
  )

  router.get('/skip-times/:showId/:episodeNumber', controller.getSkipTimes)
  router.get('/video', controller.getVideo)
  router.get(
    '/episodes',
    makeCacheMiddleware(apiCache, (req) => `episodes-${req.query.showId || ''}`, 3600),
    controller.getEpisodes
  )
  router.get(
    '/seasonal',
    makeCacheMiddleware(
      apiCache,
      (req) =>
        `seasonal-${req.query.format || 'ALL'}-${req.query.page || 1}-${req.query.size || 14}`,
      300
    ),
    controller.getSeasonal
  )
  router.get(
    '/show-meta/:id',
    makeCacheMiddleware(
      apiCache,
      (req) => `meta-${req.params.id}`,
      3600,
      (d) => !!d
    ),
    controller.getShowMeta
  )
  router.get(
    '/popular-list',
    makeCacheMiddleware(
      apiCache,
      (req) =>
        `popular-list-${req.query.sort || 'TRENDING_DESC'}-${req.query.page || 1}-${req.query.size || 20}`,
      300
    ),
    controller.getPopularList
  )

  router.get(
    '/trending',
    makeCacheMiddleware(apiCache, () => 'trending', 300),
    controller.getTrending
  )

  router.get(
    '/spotlight',
    makeCacheMiddleware(apiCache, () => 'spotlight', 300),
    controller.getSpotlight
  )

  router.get(
    '/home',
    makeCacheMiddleware(apiCache, (req) => `home-${req.query.format || 'TV'}`, 300),
    controller.getBatchedHome
  )

  router.get('/genres-and-tags', controller.getGenresAndTags)
  router.get('/anilist-status', controller.getAnilistStatus)
  router.get('/system-notifications', controller.getSystemNotifications)

  return router
}

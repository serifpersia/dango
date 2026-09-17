import { Router, type Request, type Response } from 'express'
import type { ProviderCatalogItem } from '../providers/remote-types.js'

export function createProvidersRouter(
  getCatalog: () => ProviderCatalogItem[],
  refresh: () => Promise<ProviderCatalogItem[]>
): Router {
  const router = Router()

  router.get('/providers', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'public, max-age=300').json(getCatalog())
  })

  router.post('/providers/refresh', async (_req: Request, res: Response) => {
    try {
      const catalog = await refresh()
      res.json(catalog)
    } catch (err) {
      res.status(500).json({ error: (err as Error).message || 'refresh failed' })
    }
  })

  return router
}

import { Router } from 'express'
import { InsightsController } from '../controllers/insights.controller.js'
import { CONFIG } from '../config.js'
import {
  getLinkedDiscordUser,
  setLinkedDiscordUser,
  syncDiscordRoles,
} from '../lib/discord-roles-sync.service.js'

export function createInsightsRouter(): Router {
  const router = Router()
  const controller = new InsightsController()

  router.get('/insights', controller.getWatchInsights)
  router.get('/insights/genre-cards', controller.getGenreCards)
  router.get('/insights/recommendations', controller.getRecommendations)
  router.get('/insights/discord-sync-stats', controller.getDiscordSyncStats)

  router.get('/discord-roles-config', (_req, res) => {
    res.json({ workerUrl: CONFIG.DISCORD_ROLES_WORKER_URL || null })
  })

  router.get('/discord-user', async (req, res) => {
    const user = await getLinkedDiscordUser(req.db)
    res.json({ user })
  })

  router.post('/discord-user', async (req, res) => {
    const { user } = req.body as { user: { id?: unknown } | null }
    if (
      user !== null &&
      user !== undefined &&
      (typeof user !== 'object' || typeof user.id !== 'string' || !user.id)
    ) {
      res.status(400).json({ error: 'Invalid user payload: expected { id, ... } or null' })
      return
    }
    await setLinkedDiscordUser(req.db, (user as never) || null)
    res.json({ success: true, user: user || null })
  })

  router.post('/discord-sync-now', async (req, res) => {
    const result = await syncDiscordRoles(req.db, true)
    res.json(result)
  })

  return router
}

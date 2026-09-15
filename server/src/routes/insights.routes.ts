import { Router } from 'express'
import { InsightsController } from '../controllers/insights.controller.js'

export function createInsightsRouter(): Router {
  const router = Router()
  const controller = new InsightsController()

  router.get('/insights', controller.getWatchInsights)
  router.get('/insights/genre-cards', controller.getGenreCards)

  return router
}

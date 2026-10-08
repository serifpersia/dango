import { protectedProcedure, router } from '../index.js'
import { getWatchInsights, getGenreCards } from '../../lib/insights.js'
import { getCachedRecommendations } from '../../lib/recommendations.service.js'

export const insightsRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    return getWatchInsights(ctx.db)
  }),

  genreCards: protectedProcedure.query(async ({ ctx }) => {
    return getGenreCards(ctx.db)
  }),

  recommendations: protectedProcedure.query(async ({ ctx }) => {
    return { candidates: await getCachedRecommendations(ctx.db) }
  }),
})

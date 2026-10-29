import { protectedProcedure, router } from '../index.js'
import { getWatchInsights, getGenreCards } from '../../lib/insights.js'
import { getCachedRecommendations } from '../../lib/recommendations.service.js'
import { badRequest } from '../errors.js'
import { defineSchema, reqObj } from '../validation.js'

type RecommendationsInput = { refresh?: boolean } | undefined

const recommendationsInput = () =>
  defineSchema<RecommendationsInput, RecommendationsInput>((value) => {
    if (value === undefined || value === null) return undefined
    const obj = reqObj(value)
    if (obj.refresh !== undefined && typeof obj.refresh !== 'boolean') {
      throw badRequest('refresh must be a boolean')
    }
    return { refresh: obj.refresh as boolean | undefined }
  })

export const insightsRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    return getWatchInsights(ctx.db)
  }),

  genreCards: protectedProcedure.query(async ({ ctx }) => {
    return getGenreCards(ctx.db)
  }),

  recommendations: protectedProcedure
    .input(recommendationsInput())
    .query(async ({ ctx, input }) => {
      return { candidates: await getCachedRecommendations(ctx.db, input?.refresh) }
    }),
})

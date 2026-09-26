import { TRPCError } from '@trpc/server'
import { protectedProcedure, router } from '../index.js'
import { getWatchInsights, getGenreCards } from '../../lib/insights.js'
import {
  computeDiscordSyncStats,
  getCachedRecommendations,
  getLinkedDiscordUser,
  setLinkedDiscordUser,
  syncDiscordRoles,
} from '../../lib/discord-roles-sync.service.js'
import { defineSchema, reqObj } from '../validation.js'

export type DiscordUserInput = { user?: unknown }

const discordUserInput = () =>
  defineSchema<DiscordUserInput, DiscordUserInput>((value) => {
    if (value === undefined || value === null) return {}
    return { user: reqObj(value).user }
  })

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

  discordSyncStats: protectedProcedure.query(async ({ ctx }) => {
    return computeDiscordSyncStats(ctx.db)
  }),

  discordUser: protectedProcedure.query(async ({ ctx }) => {
    return { user: await getLinkedDiscordUser(ctx.db) }
  }),

  setDiscordUser: protectedProcedure.input(discordUserInput()).mutation(async ({ ctx, input }) => {
    const { user } = input
    if (
      user !== null &&
      user !== undefined &&
      (typeof user !== 'object' ||
        typeof (user as { id?: unknown }).id !== 'string' ||
        !(user as { id: string }).id)
    ) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid user payload: expected { id, ... } or null',
      })
    }
    await setLinkedDiscordUser(ctx.db, (user as never) || null)
    return { success: true, user: user || null }
  }),

  discordSyncNow: protectedProcedure.mutation(async ({ ctx }) => {
    return syncDiscordRoles(ctx.db, true)
  }),
})

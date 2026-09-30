import { protectedProcedure, router } from '../index.js'
import { getWatchInsights, getGenreCards } from '../../lib/insights.js'
import {
  computeDiscordSyncStats,
  getCachedRecommendations,
  getLinkedDiscordUser,
  setLinkedDiscordUser,
  syncDiscordRoles,
  type LinkedDiscordUser,
} from '../../lib/discord-roles-sync.service.js'
import { defineSchema, optStr, reqObj, reqStr } from '../validation.js'

export type DiscordUserInput = { user?: LinkedDiscordUser | null }

const discordUserInput = () =>
  defineSchema<DiscordUserInput, DiscordUserInput>((value) => {
    if (value === undefined || value === null) return {}
    const raw = reqObj(value).user
    if (raw === undefined || raw === null) return { user: null }
    const obj = reqObj(raw)
    return {
      user: {
        id: reqStr(obj, 'id'),
        username: optStr(obj, 'username') ?? '',
        avatar: optStr(obj, 'avatar') ?? null,
      },
    }
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
    const user = input.user ?? null
    await setLinkedDiscordUser(ctx.db, user)
    return { success: true, user }
  }),

  discordSyncNow: protectedProcedure.mutation(async ({ ctx }) => {
    return syncDiscordRoles(ctx.db, true)
  }),
})

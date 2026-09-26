import { protectedProcedure, router } from '../index.js'
import { getWatchlistDiscoveryStatus, triggerWatchlistDiscovery } from '../../hono/watchlist.js'

export const discoveryRouter = router({
  status: protectedProcedure.query(() => {
    return getWatchlistDiscoveryStatus()
  }),
  nudge: protectedProcedure.mutation(() => {
    const started = triggerWatchlistDiscovery(false)
    return { success: true, started, ...getWatchlistDiscoveryStatus() }
  }),
  refresh: protectedProcedure.mutation(() => {
    const started = triggerWatchlistDiscovery(true)
    return { success: true, started, ...getWatchlistDiscoveryStatus() }
  }),
})

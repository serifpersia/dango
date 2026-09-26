import { protectedProcedure, router } from '../index.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { getMigratedId } from '../../lib/migration.js'
import { episodeProgressInput, showIdInput } from '../validation.js'

export const progressRouter = router({
  getEpisode: protectedProcedure.input(episodeProgressInput()).query(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    const progress = await WatchedEpisodesRepository.getByShowAndEpisode(
      ctx.db,
      showId,
      input.episodeNumber
    )
    return progress || { currentTime: 0, duration: 0 }
  }),

  getWatchedEpisodes: protectedProcedure.input(showIdInput()).query(async ({ ctx, input }) => {
    const showId = await getMigratedId(ctx.db, input.showId)
    return WatchedEpisodesRepository.getWatchedEpisodeNumbers(ctx.db, showId)
  }),
})

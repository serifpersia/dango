import { trpcClient } from './trpc'

export interface SuggestedEpisode {
  showId: string
  episodeNumber: string
  resumeTime: number
}

export async function getSuggestedEpisode(showId: string): Promise<SuggestedEpisode> {
  try {
    return await trpcClient.watchlist.queueSuggested.query({ showId })
  } catch {
    throw new Error('Failed to resolve suggested episode')
  }
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '../lib/trpc'
import type { RouterOutputs } from '../lib/trpc'

const STALE_5_MIN = 1000 * 60 * 5

export interface TvSearchResult {
  id: number
  title: string
  year: string
  type: string
  image: string
  backdrop: string
  overview: string
  vote_average: number
  adult: boolean
  genre_ids: number[]
}

export const useTvSearchPaginated = (params: {
  query?: string
  type?: string
  genre?: string
  year?: string
  sort_by?: string
  page?: number
}) => {
  const trpc = useTRPC()
  const { query, type, genre, year, sort_by, page } = params
  return useQuery({
    ...trpc.tv.search.queryOptions({
      q: query?.trim() || '',
      type: type || 'multi',
      genre: genre || '',
      year: year && year !== 'ALL' ? year : '',
      sortBy: sort_by || 'popularity.desc',
      page: page || 1,
    }),
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useTvTrending = (
  mediaType: string = 'all',
  timeWindow: string = 'week',
  page: number = 1,
  enabled: boolean = true
) => {
  const trpc = useTRPC()
  const query = useQuery({
    ...trpc.tv.trending.queryOptions({ mediaType, timeWindow, page }),
    enabled,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
  return { ...query, data: query.data as RouterOutputs['tv']['trending'] | undefined }
}

export interface TvNotification {
  mediaId: string
  tmdbId: number
  mediaType: string
  name: string
  thumbnail: string
  season: number
  episode: number
  latestSeason: number
  latestEpisode: number
  pendingCount: number
  latestAiredAt: number
  id: string
}

export interface TvInfoNotification {
  mediaId: string
  tmdbId: number
  mediaType: string
  name: string
  thumbnail: string
  season: number
  episode: number
  airingAt: number
  id: string
}

export const useTvNotifications = (enabled: boolean = true) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tvNotifications.list.queryOptions(),
    enabled,
    refetchInterval: 60000,
  })
}

export const useTvInfoNotifications = (enabled: boolean = true) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tvNotifications.info.queryOptions(),
    enabled,
    refetchInterval: 60000,
  })
}

export const useDismissTvNotification = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvNotifications.dismiss.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.tvNotifications.pathFilter())
      },
    })
  )
}

export const useDismissTvInfoNotification = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvNotifications.dismissInfo.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.tvNotifications.pathFilter())
      },
    })
  )
}

export const useClearAllTvNotifications = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvNotifications.clearAll.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.tvNotifications.pathFilter())
      },
    })
  )
}

export const useClearAllTvInfoNotifications = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvNotifications.clearInfo.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.tvNotifications.pathFilter())
      },
    })
  )
}

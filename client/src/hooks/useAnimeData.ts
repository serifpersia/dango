import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { trpcClient } from '../lib/trpc'
import { useTRPC } from '../lib/trpc'

export interface Anime {
  _id: string
  id: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  bannerImage?: string
  description?: string
  genres?: { name: string }[]
  score?: number
  type?: string
  status?: string
  episodeNumber?: number
  currentTime?: number
  duration?: number
  watchedCount?: number
  availableEpisodesDetail?: {
    sub?: string[]
    dub?: string[]
  }
  episodeCount?: number
  isAdult?: boolean
  rating?: string
  aired?: boolean
  nextEpisodeAirDate?: string
  season?: { title?: string }
  nextAiring?: { episode: number; timeUntilAiring: number }
  studios?: { name: string }[]
}

export interface QueueItem {
  id: number
  _id: string
  showId: string
  episodeNumber: string
  queue_order: number
  name?: string
  nativeName?: string
  englishName?: string
  thumbnail?: string
  type?: string
}

export const useTrendingAnime = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.data.trending.queryOptions(),
    staleTime: 1000 * 60 * 5,
  })
}

export const useSpotlightBanners = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.data.spotlight.queryOptions(),
    staleTime: 1000 * 60 * 5,
    retry: 1,
  })
}

export interface BatchedHomeData {
  trending: Anime[]
  seasonal: Anime[]
  spotlight: Anime[]
}

export const useBatchedHome = (format: string = 'TV') => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.data.home.queryOptions({ format }),
    staleTime: 1000 * 60 * 5,
  })
}

export const useInfiniteTrendingList = (sort: string = 'TRENDING_DESC', size: number = 10) => {
  return useInfiniteQuery<Anime[]>({
    queryKey: ['trendingList', sort, size],
    queryFn: ({ pageParam = 1 }) =>
      trpcClient.data.popularList.query({
        sort,
        page: pageParam as number,
        size,
      }) as Promise<Anime[]>,
    initialPageParam: 1,
    getNextPageParam: (lastPage: Anime[], allPages) => {
      return lastPage.length >= size ? allPages.length + 1 : undefined
    },
  })
}

export const useLatestReleases = (format: string = 'TV') => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.data.latestReleases.queryOptions({ format }),
  })
}

export const useInfiniteLatestReleases = (format: string = 'TV', size: number = 12) => {
  return useInfiniteQuery<Anime[]>({
    queryKey: ['latestReleases', format, size],
    queryFn: ({ pageParam = 1 }) =>
      trpcClient.data.latestReleases.query({
        format,
        page: pageParam as number,
        size,
      }) as Promise<Anime[]>,
    initialPageParam: 1,
    getNextPageParam: (lastPage: Anime[], allPages) => {
      return lastPage.length >= size ? allPages.length + 1 : undefined
    },
  })
}

export const useCurrentSeason = (format: string = 'ALL') => {
  return useInfiniteQuery({
    queryKey: ['currentSeason', format],
    queryFn: ({ pageParam = 1 }) =>
      trpcClient.data.seasonal.query({ format, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (lastPage: Anime[], allPages) => {
      return lastPage.length > 0 ? allPages.length + 1 : undefined
    },
  })
}

export const usePaginatedCurrentSeason = (
  page: number,
  format: string = 'TV',
  enabled: boolean = true
) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.data.seasonal.queryOptions({ page, format }),
    enabled,
    staleTime: 1000 * 60 * 5,
  })
}

const SEARCH_PARAMS = [
  'query',
  'sortBy',
  'type',
  'status',
  'season',
  'year',
  'country',
  'genres',
  'excludeGenres',
  'excludeTags',
  'minScore',
  'minEpisodes',
  'adult',
] as const

export const usePaginatedSearchAnime = (
  searchQueryString: string,
  page: number,
  limit: number = 14
) => {
  const trpc = useTRPC()
  const params = new URLSearchParams(searchQueryString)
  const input: {
    page: number
    limit: number
    query?: string
    sortBy?: string
    type?: string
    status?: string
    season?: string
    year?: string
    country?: string
    genres?: string
    excludeGenres?: string
    excludeTags?: string
    minScore?: string
    minEpisodes?: string
    adult?: string
  } = { page, limit }
  for (const key of SEARCH_PARAMS) {
    const value = params.get(key)
    if (value !== null) (input as Record<string, string | number>)[key] = value
  }
  return useQuery({
    ...trpc.data.search.queryOptions(input),
    enabled: searchQueryString != null,
  })
}

export const useQueue = () => {
  const trpc = useTRPC()
  return useQuery(trpc.queue.list.queryOptions())
}

export const useAddToQueue = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.queue.add.mutationOptions({
      onSuccess: (data) => {
        if (data.queued) {
          toast.success('Added to queue')
        } else {
          toast.success('Removed from queue')
        }
        void queryClient.invalidateQueries(trpc.queue.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
      },
      onError: (error) => {
        toast.error(`Failed to update queue: ${error.message}`)
      },
    })
  )
}

export const useRemoveFromQueue = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.queue.remove.mutationOptions({
      onSuccess: () => {
        toast.success('Removed from queue')
        void queryClient.invalidateQueries(trpc.queue.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useQueueRemainingEpisodes = (showId?: string, enabled: boolean = true) => {
  return useQuery<{ showId: string; episodes: string[] }>({
    queryKey: ['queue-remaining', showId],
    queryFn: () => trpcClient.watchlist.queueRemaining.query({ showId: showId as string }),
    enabled: !!showId && enabled,
    staleTime: 1000 * 60,
  })
}

export const useAddToQueueBatch = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.queue.addBatch.mutationOptions({
      onSuccess: (data, variables) => {
        const count = data.added ?? variables.episodeNumbers.length
        toast.success(`${count} ${count === 1 ? 'episode' : 'episodes'} added to queue`)
        void queryClient.invalidateQueries(trpc.queue.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
      },
      onError: (error) => {
        toast.error(`Failed to update queue: ${error.message}`)
      },
    })
  )
}

export const useRemoveFromQueueBatch = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.queue.removeMany.mutationOptions({
      onSuccess: () => {
        toast.success('Removed from queue')
        void queryClient.invalidateQueries(trpc.queue.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useClearQueue = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.queue.clear.mutationOptions({
      onSuccess: () => {
        toast.success('Queue cleared')
        void queryClient.invalidateQueries(trpc.queue.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      },
      onError: (error) => {
        toast.error(`Failed to clear queue: ${error.message}`)
      },
    })
  )
}

export const useReorderQueue = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const listKey = trpc.queue.list.queryOptions().queryKey
  return useMutation(
    trpc.queue.reorder.mutationOptions({
      onMutate: async (items) => {
        await queryClient.cancelQueries({ queryKey: listKey })
        const previousQueue = queryClient.getQueryData<QueueItem[]>(listKey)
        queryClient.setQueryData<QueueItem[]>(listKey, (old) => {
          if (!old) return old
          const byId = new Map(old.map((item) => [item.id, item]))
          return items
            .map((item, index) => {
              const existing = byId.get(item.id ?? -1)
              return existing ? { ...existing, queue_order: index } : undefined
            })
            .filter((item): item is QueueItem => !!item)
        })
        return { previousQueue }
      },
      onError: (_error, _items, context) => {
        if (context?.previousQueue) queryClient.setQueryData(listKey, context.previousQueue)
      },
      onSettled: () => {
        void queryClient.invalidateQueries(trpc.queue.pathFilter())
      },
    })
  )
}

interface PaginatedAnimeResponse {
  data: Anime[]
  total: number
  page: number
  limit: number
}

const LIST_PARAMS = [
  'status',
  'showMature',
  'query',
  'type',
  'season',
  'year',
  'genres',
  'excludeGenres',
  'sortBy',
  'titlePreference',
] as const

type ListFilterInput = {
  status?: string
  showMature?: string
  query?: string
  type?: string
  season?: string
  year?: string
  genres?: string
  excludeGenres?: string
  sortBy?: string
  titlePreference?: string
  page?: number
  limit?: number
}

function parseListFilters(filters: string, page: number, limit: number): ListFilterInput {
  const params = new URLSearchParams(filters)
  const input: ListFilterInput = { page, limit }
  for (const key of LIST_PARAMS) {
    const value = params.get(key)
    if (value !== null) (input as Record<string, string | number>)[key] = value
  }
  return input
}

export const useInfiniteWatchlist = (status: string, filters: string = '') => {
  return useInfiniteQuery<PaginatedAnimeResponse, Error, { pages: Anime[]; pageParams: unknown[] }>(
    {
      queryKey: ['watchlist', status, filters],
      queryFn: async ({ pageParam = 1 }) => {
        const params = new URLSearchParams(filters)
        params.set('status', status)
        const response = await trpcClient.watchlist.list.query(
          parseListFilters(params.toString(), pageParam as number, 14)
        )
        return response as unknown as PaginatedAnimeResponse
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage) => {
        if (lastPage.data.length === 0 || lastPage.page * lastPage.limit >= lastPage.total) {
          return undefined
        }
        return lastPage.page + 1
      },
      select: (data) => ({
        ...data,
        pages: data.pages.flatMap((page) => page.data),
      }),
    }
  )
}

export const usePaginatedWatchlist = (
  status: string,
  filters: string = '',
  page: number,
  limit: number = 14
) => {
  return useQuery<PaginatedAnimeResponse>({
    queryKey: ['watchlist', status, filters, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams(filters)
      params.set('status', status)
      const response = await trpcClient.watchlist.list.query(
        parseListFilters(params.toString(), page, limit)
      )
      return response as unknown as PaginatedAnimeResponse
    },
  })
}

export const useAllContinueWatching = (filters: string = '') => {
  return useInfiniteQuery<PaginatedAnimeResponse, Error, { pages: Anime[]; pageParams: unknown[] }>(
    {
      queryKey: ['allContinueWatching', filters],
      queryFn: async ({ pageParam = 1 }) => {
        const response = await trpcClient.watchlist.continueWatchingAll.query(
          parseListFilters(filters, pageParam as number, 14)
        )
        return response as unknown as PaginatedAnimeResponse
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage) => {
        if (lastPage.data.length === 0 || lastPage.page * lastPage.limit >= lastPage.total) {
          return undefined
        }
        return lastPage.page + 1
      },
      select: (data) => ({
        ...data,
        pages: data.pages.flatMap((page) => page.data),
      }),
    }
  )
}

export const usePaginatedAllContinueWatching = (
  filters: string = '',
  page: number,
  limit: number = 14
) => {
  return useQuery<PaginatedAnimeResponse>({
    queryKey: ['allContinueWatching', filters, page, limit],
    queryFn: async () => {
      const response = await trpcClient.watchlist.continueWatchingAll.query(
        parseListFilters(filters, page, limit)
      )
      return response as unknown as PaginatedAnimeResponse
    },
  })
}

export const useRemoveFromWatchlist = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.watchlist.remove.mutationOptions({
      onSuccess: () => {
        toast.success('Removed from watchlist')
        void queryClient.invalidateQueries(trpc.watchlist.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useBatchUpdateWatchlistStatus = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.watchlist.batchStatus.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Status updated for ${data.updated ?? 0} items`)
        void queryClient.invalidateQueries(trpc.watchlist.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['watchlist'] })
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      },
      onError: (error) => {
        toast.error(`Failed to update statuses: ${error.message}`)
      },
    })
  )
}

export const useBatchRemoveFromWatchlist = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.watchlist.removeMany.mutationOptions({
      onSuccess: (data) => {
        const count = data.removed ?? 0
        toast.success(`Removed ${count} ${count === 1 ? 'item' : 'items'} from watchlist`)
        void queryClient.invalidateQueries(trpc.watchlist.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['watchlist'] })
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useBatchRemoveFromContinueWatching = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.continueWatching.removeMany.mutationOptions({
      onSuccess: (data) => {
        const count = data.removed ?? 0
        toast.success(`Removed ${count} ${count === 1 ? 'item' : 'items'} from continue watching`)
        void queryClient.invalidateQueries(trpc.continueWatching.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export interface Notification {
  showId: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
  episodeNumber: string
  id: string
}

export interface SystemNotification {
  id: string
  type: 'system'
  title: string
  message: string
  icon: 'warning' | 'error' | 'info'
  createdAt: number
}

export const useNotifications = (enabled: boolean = true) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.notifications.list.queryOptions(),
    enabled,
    refetchInterval: 30000,
  })
}

export const useSystemNotifications = (enabled: boolean = true) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.data.systemNotifications.queryOptions(),
    enabled,
    refetchInterval: 30000,
  })
}

export interface DiscoveryStatus {
  running: boolean
  state: 'idle' | 'running' | 'complete' | 'empty' | 'error'
  total: number
  done: number
  lastRunAt: number
}

export const useDiscoveryStatus = (enabled: boolean = true) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.discovery.status.queryOptions(),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as DiscoveryStatus | undefined
      return data?.running ? 2000 : false
    },
  })
}

export const useTriggerDiscovery = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const statusKey = trpc.discovery.status.queryOptions().queryKey
  return useMutation(
    trpc.discovery.refresh.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData<DiscoveryStatus>(statusKey, {
          running: data.running,
          state: data.state,
          total: data.total,
          done: data.done,
          lastRunAt: data.lastRunAt,
        })
        void queryClient.invalidateQueries(trpc.notifications.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      },
      onError: () => {
        queryClient.invalidateQueries({ queryKey: statusKey })
      },
    })
  )
}

export const useNudgeDiscovery = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const statusKey = trpc.discovery.status.queryOptions().queryKey
  return useMutation(
    trpc.discovery.nudge.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData<DiscoveryStatus>(statusKey, {
          running: data.running,
          state: data.state,
          total: data.total,
          done: data.done,
          lastRunAt: data.lastRunAt,
        })
        void queryClient.invalidateQueries(trpc.notifications.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      },
      onError: () => {
        queryClient.invalidateQueries({ queryKey: statusKey })
      },
    })
  )
}

export const useDismissNotification = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.notifications.dismiss.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.notifications.pathFilter())
      },
    })
  )
}

export const useClearAllNotifications = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.notifications.clearAll.mutationOptions({
      onSuccess: () => {
        void queryClient.invalidateQueries(trpc.notifications.pathFilter())
      },
    })
  )
}

export const useThisWeekSchedule = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.continueWatching.thisWeek.queryOptions(),
    staleTime: 1000 * 60 * 5,
  })
}

export const useGenresAndTags = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.data.genresAndTags.queryOptions(),
    staleTime: 1000 * 60 * 60,
  })
}

export interface GenreCard {
  rank: number
  name: string
  count: number
  meanScore: number
  timeWatched: string
  topShows: TopShow[]
}

export interface TopShow {
  id: string
  name: string
  nativeName?: string
  englishName?: string
  thumbnail: string
}

export const useGenreCards = () => {
  return useQuery<GenreCard[]>({
    queryKey: ['genreCards'],
    queryFn: () => trpcClient.insights.genreCards.query() as unknown as Promise<GenreCard[]>,
  })
}

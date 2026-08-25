import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchApi } from '../lib/fetchApi'

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
  nextEpisodeToWatch?: string
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
  return useQuery<Anime[]>({
    queryKey: ['trending'],
    queryFn: () => fetchApi('/api/trending'),
    staleTime: 1000 * 60 * 5,
  })
}

export const useSpotlightBanners = () => {
  return useQuery<Anime[]>({
    queryKey: ['spotlight'],
    queryFn: () => fetchApi('/api/spotlight'),
    staleTime: 1000 * 60 * 5,
  })
}

export interface BatchedHomeData {
  trending: Anime[]
  seasonal: Anime[]
  spotlight: Anime[]
}

export const useBatchedHome = (format: string = 'TV') => {
  return useQuery<BatchedHomeData>({
    queryKey: ['batchedHome', format],
    queryFn: () => fetchApi(`/api/home?format=${format}`),
    staleTime: 1000 * 60 * 5,
  })
}

export const useInfiniteTrendingList = (sort: string = 'TRENDING_DESC', size: number = 10) => {
  return useInfiniteQuery<Anime[]>({
    queryKey: ['trendingList', sort, size],
    queryFn: ({ pageParam = 1 }) =>
      fetchApi(`/api/popular-list?sort=${sort}&page=${pageParam as number}&size=${size}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage: Anime[], allPages) => {
      return lastPage.length >= size ? allPages.length + 1 : undefined
    },
  })
}

export const useLatestReleases = (format: string = 'TV') => {
  return useQuery<Anime[]>({
    queryKey: ['latestReleases', format],
    queryFn: () => fetchApi(`/api/latest-releases?format=${format}`),
  })
}

export const useInfiniteLatestReleases = (format: string = 'TV', size: number = 12) => {
  return useInfiniteQuery<Anime[]>({
    queryKey: ['latestReleases', format, size],
    queryFn: ({ pageParam = 1 }) =>
      fetchApi(`/api/latest-releases?format=${format}&page=${pageParam as number}&size=${size}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage: Anime[], allPages) => {
      return lastPage.length >= size ? allPages.length + 1 : undefined
    },
  })
}

export const useCurrentSeason = (format: string = 'ALL') => {
  return useInfiniteQuery({
    queryKey: ['currentSeason', format],
    queryFn: ({ pageParam = 1 }) => fetchApi(`/api/seasonal?format=${format}&page=${pageParam}`),
    initialPageParam: 1,
    getNextPageParam: (lastPage: Anime[], allPages) => {
      return lastPage.length > 0 ? allPages.length + 1 : undefined
    },
  })
}

export const usePaginatedCurrentSeason = (page: number, format: string = 'TV') => {
  return useQuery<Anime[]>({
    queryKey: ['currentSeason', page, format],
    queryFn: () => fetchApi(`/api/seasonal?page=${page}&format=${format}&size=14`),
  })
}

export const usePaginatedSearchAnime = (
  searchQueryString: string,
  page: number,
  limit: number = 14
) => {
  return useQuery<Anime[]>({
    queryKey: ['searchAnime', searchQueryString, page, limit],
    queryFn: async () => {
      const params = new URLSearchParams(searchQueryString)
      params.set('page', page.toString())
      params.set('limit', limit.toString())
      return fetchApi(`/api/search?${params.toString()}`)
    },
    enabled: searchQueryString != null,
  })
}

export const useQueue = () => {
  return useQuery<QueueItem[]>({
    queryKey: ['queue'],
    queryFn: () => fetchApi('/api/queue'),
  })
}

export const useAddToQueue = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: {
      showId: string
      episodeNumber: string
      showName?: string
      showThumbnail?: string
      nativeName?: string
      englishName?: string
      type?: string
    }) => {
      const response = await fetch('/api/queue/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      if (!response.ok) throw new Error('Failed to update queue')
      return response.json() as Promise<{ success: boolean; queued: boolean }>
    },
    onSuccess: (data) => {
      if (data.queued) {
        toast.success('Added to queue')
      } else {
        toast.success('Removed from queue')
      }
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to update queue: ${error.message}`)
    },
  })
}

export const useRemoveFromQueue = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: { showId: string; episodeNumber: string }) => {
      const response = await fetch('/api/queue/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      })
      if (!response.ok) throw new Error('Failed to remove queue item')
    },
    onSuccess: () => {
      toast.success('Removed from queue')
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatchingFast'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatchingUpNext'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatching'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove: ${error.message}`)
    },
  })
}

export const useQueueRemainingEpisodes = (showId?: string, enabled: boolean = true) => {
  return useQuery<{ showId: string; episodes: string[] }>({
    queryKey: ['queue-remaining', showId],
    queryFn: () => fetchApi(`/api/queue/remaining/${showId}`),
    enabled: !!showId && enabled,
    staleTime: 1000 * 60,
  })
}

export interface QueueAddPayload {
  showId: string
  showName?: string
  showThumbnail?: string
  nativeName?: string
  englishName?: string
  type?: string
}

export const useAddToQueueBatch = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      episodeNumbers,
      ...meta
    }: QueueAddPayload & { episodeNumbers: string[] }) => {
      const response = await fetch('/api/queue/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...meta, episodeNumbers }),
      })
      if (!response.ok) throw new Error('Failed to update queue')
      return response.json() as Promise<{ success: boolean; added: number }>
    },
    onSuccess: (data, variables) => {
      const count = data.added ?? variables.episodeNumbers.length
      toast.success(`${count} ${count === 1 ? 'episode' : 'episodes'} added to queue`)
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to update queue: ${error.message}`)
    },
  })
}

export const useRemoveFromQueueBatch = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      showId,
      episodeNumbers,
    }: {
      showId: string
      episodeNumbers?: string[]
    }) => {
      const response = await fetch('/api/queue/remove-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId, episodeNumbers }),
      })
      if (!response.ok) throw new Error('Failed to remove queue items')
    },
    onSuccess: () => {
      toast.success('Removed from queue')
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatchingFast'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatchingUpNext'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatching'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove: ${error.message}`)
    },
  })
}

export const useClearQueue = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/queue/clear', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to clear queue')
    },
    onSuccess: () => {
      toast.success('Queue cleared')
      queryClient.invalidateQueries({ queryKey: ['queue'] })
      queryClient.invalidateQueries({ queryKey: ['queue-remaining'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatchingFast'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatchingUpNext'] })
      queryClient.invalidateQueries({ queryKey: ['continueWatching'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to clear queue: ${error.message}`)
    },
  })
}

export const useReorderQueue = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (items: Pick<QueueItem, 'id' | 'showId' | 'episodeNumber'>[]) => {
      const response = await fetch('/api/queue/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!response.ok) throw new Error('Failed to reorder queue')
    },
    onMutate: async (items) => {
      await queryClient.cancelQueries({ queryKey: ['queue'] })
      const previousQueue = queryClient.getQueryData<QueueItem[]>(['queue'])
      queryClient.setQueryData<QueueItem[]>(['queue'], (old) => {
        if (!old) return old
        const byId = new Map(old.map((item) => [item.id, item]))
        return items
          .map((item, index) => {
            const existing = byId.get(item.id)
            return existing ? { ...existing, queue_order: index } : undefined
          })
          .filter((item): item is QueueItem => !!item)
      })
      return { previousQueue }
    },
    onError: (_error, _items, context) => {
      if (context?.previousQueue) queryClient.setQueryData(['queue'], context.previousQueue)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] })
    },
  })
}

interface PaginatedAnimeResponse {
  data: Anime[]
  total: number
  page: number
  limit: number
}

export const useInfiniteWatchlist = (status: string, filters: string = '') => {
  return useInfiniteQuery<PaginatedAnimeResponse, Error, { pages: Anime[]; pageParams: unknown[] }>(
    {
      queryKey: ['watchlist', status, filters],
      queryFn: async ({ pageParam = 1 }) => {
        const params = new URLSearchParams(filters)
        params.set('status', status)
        params.set('page', String(pageParam))
        params.set('limit', '14')
        const response = await fetchApi(`/api/watchlist?${params.toString()}`)
        return response
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
      params.set('page', String(page))
      params.set('limit', String(limit))
      return fetchApi(`/api/watchlist?${params.toString()}`)
    },
  })
}

export const useAllContinueWatching = (filters: string = '') => {
  return useInfiniteQuery<PaginatedAnimeResponse, Error, { pages: Anime[]; pageParams: unknown[] }>(
    {
      queryKey: ['allContinueWatching', filters],
      queryFn: async ({ pageParam = 1 }) => {
        const params = new URLSearchParams(filters)
        params.set('page', String(pageParam))
        params.set('limit', '14')
        const response = await fetchApi(`/api/continue-watching/all?${params.toString()}`)
        return response
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
      const params = new URLSearchParams(filters)
      params.set('page', String(page))
      params.set('limit', String(limit))
      return fetchApi(`/api/continue-watching/all?${params.toString()}`)
    },
  })
}

export const useRemoveFromWatchlist = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (showId: string) => {
      const response = await fetch(`/api/watchlist/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: showId }),
      })
      if (!response.ok) {
        throw new Error('Failed to remove from watchlist')
      }
    },
    onSuccess: () => {
      toast.success('Removed from watchlist')
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
    onError: (error) => {
      toast.error(`Failed to remove: ${error.message}`)
    },
  })
}

export const useBatchUpdateWatchlistStatus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      const response = await fetch('/api/watchlist/batch-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, status }),
      })
      if (!response.ok) throw new Error('Failed to update watchlist statuses')
      return response.json() as Promise<{ success: boolean; updated: number }>
    },
    onSuccess: (data) => {
      toast.success(`Status updated for ${data.updated ?? 0} items`)
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to update statuses: ${error.message}`)
    },
  })
}

export const useBatchRemoveFromWatchlist = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const response = await fetch('/api/watchlist/remove-many', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!response.ok) throw new Error('Failed to remove from watchlist')
      return response.json() as Promise<{ success: boolean; removed: number }>
    },
    onSuccess: (data) => {
      const count = data.removed ?? 0
      toast.success(`Removed ${count} ${count === 1 ? 'item' : 'items'} from watchlist`)
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
      queryClient.invalidateQueries({ queryKey: ['allContinueWatching'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove: ${error.message}`)
    },
  })
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
  return useQuery<Notification[]>({
    queryKey: ['notifications'],
    queryFn: () => fetchApi('/api/notifications'),
    enabled,
    refetchInterval: 30000,
  })
}

export const useSystemNotifications = (enabled: boolean = true) => {
  return useQuery<SystemNotification[]>({
    queryKey: ['system-notifications'],
    queryFn: () => fetchApi('/api/system-notifications'),
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
  return useQuery<DiscoveryStatus>({
    queryKey: ['discovery-status'],
    queryFn: () => fetchApi('/api/discovery/status'),
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as DiscoveryStatus | undefined
      return data?.running ? 2000 : false
    },
  })
}

export const useTriggerDiscovery = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/discovery/refresh', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to trigger discovery')
      return response.json() as Promise<DiscoveryStatus & { success: boolean; started: boolean }>
    },
    onSuccess: (data) => {
      queryClient.setQueryData<DiscoveryStatus>(['discovery-status'], {
        running: data.running,
        state: data.state,
        total: data.total,
        done: data.done,
        lastRunAt: data.lastRunAt,
      })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery-status'] })
    },
  })
}

export const useNudgeDiscovery = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/discovery/nudge', { method: 'POST' })
      if (!response.ok) throw new Error('Failed to trigger discovery')
      return response.json() as Promise<DiscoveryStatus & { success: boolean; started: boolean }>
    },
    onSuccess: (data) => {
      queryClient.setQueryData<DiscoveryStatus>(['discovery-status'], {
        running: data.running,
        state: data.state,
        total: data.total,
        done: data.done,
        lastRunAt: data.lastRunAt,
      })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['discovery-status'] })
    },
  })
}

export const useDismissNotification = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ showId, episodeNumber }: { showId: string; episodeNumber: string }) => {
      const response = await fetch(`/api/notifications/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId, episodeNumber }),
      })
      if (!response.ok) {
        throw new Error('Failed to dismiss notification')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export const useClearAllNotifications = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (showId?: string) => {
      const response = await fetch(`/api/notifications/clear-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showId }),
      })
      if (!response.ok) {
        throw new Error('Failed to clear notifications')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export const useThisWeekSchedule = () => {
  return useQuery<Anime[]>({
    queryKey: ['thisWeekSchedule'],
    queryFn: () => fetchApi('/api/continue-watching/this-week'),
  })
}

export const useGenresAndStudios = () => {
  return useQuery<{ genres: string[]; tags: string[]; studios: string[] }>({
    queryKey: ['genresAndStudios'],
    queryFn: () => fetchApi('/api/genres-and-tags'),
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
    queryFn: () => fetchApi('/api/insights/genre-cards'),
  })
}

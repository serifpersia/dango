import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchApi } from '../lib/fetchApi'
import { buildTvId } from '../lib/tv'

export type TvLibraryStatus = 'Watching' | 'Completed' | 'On-Hold' | 'Dropped' | 'Planned'

export const TV_LIBRARY_STATUSES: TvLibraryStatus[] = [
  'Watching',
  'Completed',
  'On-Hold',
  'Dropped',
  'Planned',
]

export interface TvLibraryItem {
  id: string
  tmdbId: number
  mediaType: string
  title: string
  poster: string
  backdrop?: string | null
  year?: string | null
  overview?: string | null
  status: string
  adult?: number | null
  lastSeason?: number | null
  lastEpisode?: number | null
  updatedAt?: number | null
}

export interface TvProgressItem {
  mediaId: string
  season: number
  episode: number
  currentTime: number
  duration: number
  updatedAt: number
}

export interface ContinueWatchingTvItem extends TvLibraryItem {
  season?: number | null
  episode?: number | null
  currentTime?: number | null
  duration?: number | null
  progressAt?: number | null
}

interface PaginatedTvLibrary {
  data: TvLibraryItem[]
  total: number
  page: number
  limit: number
}

export const tvLibraryId = (mediaType: string, tmdbId: number | string) =>
  buildTvId(mediaType, tmdbId)

export const useTvLibrary = (status: string = 'All', page: number = 1, limit: number = 24) => {
  return useQuery<PaginatedTvLibrary>({
    queryKey: ['tv-library', status, page, limit],
    queryFn: () => {
      const p = new URLSearchParams()
      p.set('status', status)
      p.set('page', String(page))
      p.set('limit', String(limit))
      return fetchApi(`/api/tv/library?${p.toString()}`)
    },
  })
}

export const useTvLibraryIds = () => {
  return useQuery<{ ids: string[] }>({
    queryKey: ['tv-library-ids'],
    queryFn: () => fetchApi('/api/tv/library/ids'),
    staleTime: 1000 * 60,
  })
}

export const useTvLibraryCheck = (id?: string) => {
  return useQuery<{ inLibrary: boolean; status: string | null }>({
    queryKey: ['tv-library-check', id],
    queryFn: () => fetchApi(`/api/tv/library/check/${encodeURIComponent(id || '')}`),
    enabled: !!id,
    staleTime: 1000 * 60,
  })
}

export const useTvContinueWatching = (limit: number = 24) => {
  return useQuery<{ data: ContinueWatchingTvItem[]; total: number }>({
    queryKey: ['tv-continue-watching', limit],
    queryFn: () => fetchApi(`/api/tv/continue-watching?limit=${limit}`),
  })
}

export const useTvProgress = (mediaId?: string) => {
  return useQuery<{ progress: TvProgressItem[] }>({
    queryKey: ['tv-progress', mediaId],
    queryFn: () => fetchApi(`/api/tv/progress/${encodeURIComponent(mediaId || '')}`),
    enabled: !!mediaId,
  })
}

export const useTvLatestProgress = (mediaId?: string, season?: number, episode?: number) => {
  return useQuery<TvProgressItem | { currentTime: number; duration: number }>({
    queryKey: ['tv-progress-latest', mediaId, season, episode],
    queryFn: () => fetchApi(`/api/tv/progress/${encodeURIComponent(mediaId || '')}/latest`),
    enabled: !!mediaId,
    staleTime: 1000 * 60,
  })
}

export const useAddTvBookmark = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: {
      tmdbId: number
      mediaType: string
      title: string
      poster?: string
      backdrop?: string
      year?: string
      overview?: string
      status?: string
      adult?: boolean
      silent?: boolean
    }) => {
      const { silent: _silent, ...body } = item
      return fetchApi('/api/tv/library/add', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<{ success: boolean; id: string }>
    },
    onSuccess: (_data, variables) => {
      if (!variables.silent) toast.success('Added to TV watchlist')
      queryClient.invalidateQueries({ queryKey: ['tv-library'] })
      queryClient.invalidateQueries({ queryKey: ['tv-library-ids'] })
      queryClient.invalidateQueries({
        queryKey: ['tv-library-check', tvLibraryId(variables.mediaType, variables.tmdbId)],
      })
    },
    onError: (error: Error) => {
      toast.error(`Failed to add: ${error.message}`)
    },
  })
}

export const useRemoveTvBookmark = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await fetchApi('/api/tv/library/remove', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
    },
    onSuccess: (_data, id) => {
      toast.success('Removed from TV watchlist')
      queryClient.invalidateQueries({ queryKey: ['tv-library'] })
      queryClient.invalidateQueries({ queryKey: ['tv-library-ids'] })
      queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
      queryClient.invalidateQueries({ queryKey: ['tv-library-check', id] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove: ${error.message}`)
    },
  })
}

export const useUpdateTvStatus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await fetchApi('/api/tv/library/status', {
        method: 'POST',
        body: JSON.stringify({ id, status }),
      })
    },
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['tv-library'] })
      queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to update status: ${error.message}`)
    },
  })
}

export const useSaveTvProgress = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (progress: {
      mediaId: string
      season: number
      episode: number
      currentTime: number
      duration?: number
    }) => {
      await fetchApi('/api/tv/progress', {
        method: 'POST',
        body: JSON.stringify(progress),
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tv-progress', variables.mediaId] })
      queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
      queryClient.invalidateQueries({ queryKey: ['tv-library'] })
      queryClient.invalidateQueries({ queryKey: ['tv-library-ids'] })
    },
  })
}

export const useRemoveTvProgress = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      mediaId,
      season,
      episode,
    }: {
      mediaId: string
      season?: number
      episode?: number
    }) => {
      await fetchApi('/api/tv/progress/remove', {
        method: 'POST',
        body: JSON.stringify({ mediaId, season, episode }),
      })
    },
    onSuccess: () => {
      toast.success('Progress reset')
      queryClient.invalidateQueries({ queryKey: ['tv-progress'] })
      queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
      queryClient.invalidateQueries({ queryKey: ['tv-library'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset progress: ${error.message}`)
    },
  })
}

export const useToggleTvBookmark = () => {
  const add = useAddTvBookmark()
  const remove = useRemoveTvBookmark()
  const { data: idsData } = useTvLibraryIds()
  const bookmarkedIds = useMemo(() => new Set(idsData?.ids || []), [idsData])

  const toggle = (item: {
    tmdbId: number
    mediaType: string
    title: string
    poster?: string
    backdrop?: string
    year?: string
    overview?: string
    adult?: boolean
  }) => {
    const libId = tvLibraryId(item.mediaType, item.tmdbId)
    if (bookmarkedIds.has(libId)) {
      remove.mutate(libId)
    } else {
      add.mutate({ ...item, poster: item.poster || '' })
    }
  }

  return { toggle, bookmarkedIds, pending: add.isPending || remove.isPending }
}

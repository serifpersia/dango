import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { buildTvId } from '../lib/tv'
import { trpcClient, useTRPC } from '../lib/trpc'

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

export interface ContinueWatchingTvItem extends TvLibraryItem {
  season?: number | null
  episode?: number | null
  currentTime?: number | null
  duration?: number | null
  completed?: number | boolean | null
  progressAt?: number | null
}

export const tvLibraryId = (mediaType: string, tmdbId: number | string) =>
  buildTvId(mediaType, tmdbId)

export const useTvLibrary = (status: string = 'All', page: number = 1, limit: number = 24) => {
  const trpc = useTRPC()
  return useQuery(trpc.tvLibrary.list.queryOptions({ status, page, limit }))
}

export const useTvLibraryIds = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tvLibrary.ids.queryOptions(),
    staleTime: 1000 * 60,
  })
}

export const useTvLibraryCheck = (id?: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tvLibrary.check.queryOptions({ id: id || '' }),
    enabled: !!id,
    staleTime: 1000 * 60,
  })
}

export const useTvContinueWatching = (limit: number = 24) => {
  const trpc = useTRPC()
  return useQuery(trpc.tvProgress.continueWatching.queryOptions({ limit }))
}

export const useTvProgress = (mediaId?: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tvProgress.getByMedia.queryOptions({ mediaId: mediaId || '' }),
    enabled: !!mediaId,
  })
}

export const useTvLatestProgress = (mediaId?: string, season?: number, episode?: number) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tvProgress.latest.queryOptions({ mediaId: mediaId || '', season, episode }),
    enabled: !!mediaId,
    staleTime: 0,
  })
}

export const useAddTvBookmark = () => {
  const trpc = useTRPC()
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
      return trpcClient.tvLibrary.add.mutate(body)
    },
    onSuccess: (_data, variables) => {
      if (!variables.silent) toast.success('Added to TV watchlist')
      queryClient.invalidateQueries({ queryKey: ['tv-library'] })
      void queryClient.invalidateQueries(trpc.tvLibrary.pathFilter())
    },
    onError: (error: Error) => {
      toast.error(`Failed to add: ${error.message}`)
    },
  })
}

export const useRemoveTvBookmark = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvLibrary.remove.mutationOptions({
      onSuccess: () => {
        toast.success('Removed from TV watchlist')
        queryClient.invalidateQueries({ queryKey: ['tv-library'] })
        queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
        void queryClient.invalidateQueries(trpc.tvLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.tvProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useUpdateTvStatus = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvLibrary.setStatus.mutationOptions({
      onSuccess: () => {
        toast.success('Status updated')
        queryClient.invalidateQueries({ queryKey: ['tv-library'] })
        queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
        void queryClient.invalidateQueries(trpc.tvLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.tvProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to update status: ${error.message}`)
      },
    })
  )
}

export const useSaveTvProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvProgress.save.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: ['tv-progress', variables.mediaId] })
        queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
        queryClient.invalidateQueries({ queryKey: ['tv-library'] })
        void queryClient.invalidateQueries(trpc.tvLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.tvProgress.pathFilter())
      },
    })
  )
}

export const useRemoveTvProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvProgress.remove.mutationOptions({
      onSuccess: () => {
        toast.success('Progress reset')
        queryClient.invalidateQueries({ queryKey: ['tv-progress'] })
        queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
        queryClient.invalidateQueries({ queryKey: ['tv-library'] })
        void queryClient.invalidateQueries(trpc.tvLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.tvProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to reset progress: ${error.message}`)
      },
    })
  )
}

export const useBatchUpdateTvStatus = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvLibrary.batchStatus.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Status updated for ${data.updated ?? 0} items`)
        queryClient.invalidateQueries({ queryKey: ['tv-library'] })
        queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
        void queryClient.invalidateQueries(trpc.tvLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.tvProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to update statuses: ${error.message}`)
      },
    })
  )
}

export const useBatchRemoveTv = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvLibrary.removeMany.mutationOptions({
      onSuccess: (data) => {
        const count = data.removed ?? 0
        toast.success(`Removed ${count} ${count === 1 ? 'item' : 'items'} from TV watchlist`)
        queryClient.invalidateQueries({ queryKey: ['tv-library'] })
        queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
        void queryClient.invalidateQueries(trpc.tvLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.tvProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useBatchRemoveTvProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.tvProgress.removeMany.mutationOptions({
      onSuccess: (data) => {
        const count = data.removed ?? 0
        toast.success(`Reset progress for ${count} ${count === 1 ? 'item' : 'items'}`)
        queryClient.invalidateQueries({ queryKey: ['tv-progress'] })
        queryClient.invalidateQueries({ queryKey: ['tv-continue-watching'] })
        queryClient.invalidateQueries({ queryKey: ['tv-library'] })
        void queryClient.invalidateQueries(trpc.tvLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.tvProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to reset progress: ${error.message}`)
      },
    })
  )
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

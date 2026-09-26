import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { DetailedShowMeta } from '../types/player'
import { trpcClient, useTRPC } from '../lib/trpc'
import { useShowMeta } from './useShowMeta'

interface UseAnimeInfoDataReturn {
  showMeta: DetailedShowMeta | undefined
  inWatchlist: boolean
  loadingMeta: boolean
  error: string | null
  toggleWatchlist: () => Promise<void>
}

export function useAnimeInfoData(showId: string | undefined): UseAnimeInfoDataReturn {
  const queryClient = useQueryClient()
  const trpc = useTRPC()
  const { data: showMeta, isLoading: loadingMeta, error: showDataError } = useShowMeta(showId)
  const checkKey = trpc.watchlist.check.queryOptions({ showId: showId ?? '' }).queryKey

  const { data: watchlistData } = useQuery({
    ...trpc.watchlist.check.queryOptions({ showId: showId ?? '' }),
    enabled: !!showId,
  })

  const inWatchlist = watchlistData?.inWatchlist ?? false

  const { mutateAsync: toggleWatchlistMutation } = useMutation({
    mutationFn: async ({ wasIn, meta }: { wasIn: boolean; meta: Record<string, unknown> }) => {
      if (!showId) throw new Error('Missing showId')
      if (wasIn) {
        await trpcClient.watchlist.remove.mutate({ id: showId })
      } else {
        const names = meta?.names as Record<string, string> | undefined
        const name = (meta?.name as string | undefined) || names?.romaji
        if (!name) throw new Error('Missing show name')
        await trpcClient.watchlist.add.mutate({
          id: showId,
          name,
          thumbnail: meta?.thumbnail as string | undefined,
          nativeName: names?.native,
          englishName: names?.english,
          type: meta?.type as string | undefined,
          isAdult: (meta as { isAdult?: boolean } | undefined)?.isAdult,
        })
      }
      return !wasIn
    },
    onMutate: async ({ wasIn }) => {
      await queryClient.cancelQueries({ queryKey: checkKey })
      queryClient.setQueryData(checkKey, (old: { inWatchlist: boolean } | undefined) => ({
        ...old,
        inWatchlist: !wasIn,
      }))
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: checkKey })
      toast.error(err instanceof Error ? err.message : 'Failed to update watchlist')
    },
    onSuccess: (newInWatchlist) => {
      toast.success(newInWatchlist ? 'Added to watchlist' : 'Removed from watchlist')
      queryClient.invalidateQueries({ queryKey: ['watchlist'] })
    },
  })

  const toggleWatchlist = useCallback(async () => {
    if (!showId || !showMeta) return
    await toggleWatchlistMutation({ wasIn: inWatchlist, meta: showMeta })
  }, [showId, showMeta, inWatchlist, toggleWatchlistMutation])

  return {
    showMeta: showMeta as DetailedShowMeta | undefined,
    inWatchlist,
    loadingMeta,
    error: showDataError ? (showDataError as Error).message : null,
    toggleWatchlist,
  }
}

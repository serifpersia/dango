import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import type { DetailedShowMeta } from '../types/player'
import { fetchApi } from '../lib/fetchApi'
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
  const { data: showMeta, isLoading: loadingMeta, error: showDataError } = useShowMeta(showId)

  const { data: watchlistData } = useQuery({
    queryKey: ['watchlist-check', showId],
    queryFn: async () => {
      if (!showId) return { inWatchlist: false }
      return fetchApi(`/api/watchlist/check/${showId}`) as Promise<{
        inWatchlist: boolean
        status?: string | null
      }>
    },
    enabled: !!showId,
  })

  const inWatchlist = watchlistData?.inWatchlist ?? false

  const { mutateAsync: toggleWatchlistMutation } = useMutation({
    mutationFn: async ({ wasIn, meta }: { wasIn: boolean; meta: Record<string, unknown> }) => {
      const endpoint = wasIn ? '/api/watchlist/remove' : '/api/watchlist/add'
      const payload = {
        id: showId,
        name: meta?.name || (meta?.names as Record<string, string> | undefined)?.romaji,
        thumbnail: meta?.thumbnail,
        nativeName: (meta?.names as Record<string, string> | undefined)?.native,
        englishName: (meta?.names as Record<string, string> | undefined)?.english,
        type: meta?.type,
        isAdult: (meta as { isAdult?: boolean } | undefined)?.isAdult,
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error || 'Watchlist update failed')
      }
      return !wasIn
    },
    onMutate: async ({ wasIn }) => {
      await queryClient.cancelQueries({ queryKey: ['watchlist-check', showId] })
      queryClient.setQueryData(
        ['watchlist-check', showId],
        (old: { inWatchlist: boolean } | undefined) => ({
          ...old,
          inWatchlist: !wasIn,
        })
      )
    },
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: ['watchlist-check', showId] })
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

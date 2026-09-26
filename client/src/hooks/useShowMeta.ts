import { useQuery } from '@tanstack/react-query'
import { trpcClient } from '../lib/trpc'

export function useShowMeta(showId: string | undefined) {
  return useQuery({
    queryKey: ['show-meta', showId],
    queryFn: async () => {
      if (!showId) return {}
      return trpcClient.data.showMeta.query({ id: showId }) as Promise<Record<string, unknown>>
    },
    enabled: !!showId,
    staleTime: 30000,
  })
}

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { qk } from '../lib/queryKeys'

export function useMalAuthCallback(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mal = params.get('mal')
    if (!mal) return
    const user = params.get('user')
    const reason = params.get('reason')
    window.history.replaceState(null, '', window.location.pathname)
    if (mal === 'success') {
      toast.success(
        user
          ? `Connected to MyAnimeList as ${decodeURIComponent(user)}`
          : 'Connected to MyAnimeList'
      )
      queryClient.invalidateQueries({ queryKey: [qk.trackerStatus] })
    } else {
      toast.error(reason ? decodeURIComponent(reason) : 'MyAnimeList authentication failed')
    }
  }, [queryClient])
}

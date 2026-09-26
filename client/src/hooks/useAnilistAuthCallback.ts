import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { trpcClient } from '../lib/trpc'

export function useAnilistAuthCallback(): boolean {
  const queryClient = useQueryClient()
  const [isExchanging, setIsExchanging] = useState(false)

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const anilistParam = searchParams.get('anilist')
    if (anilistParam) {
      const user = searchParams.get('user')
      const reason = searchParams.get('reason')
      window.history.replaceState(null, '', window.location.pathname)
      if (anilistParam === 'success') {
        toast.success(
          user ? `Connected to AniList as ${decodeURIComponent(user)}` : 'Connected to AniList'
        )
        queryClient.invalidateQueries({ queryKey: ['trackerStatus'] })
      } else {
        toast.error(reason ? decodeURIComponent(reason) : 'AniList authentication failed')
      }
      return
    }

    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const accessToken = hashParams.get('access_token')
    const code = searchParams.get('code')
    if (!accessToken && !code) {
      const err = hashParams.get('error')
      if (err) {
        toast.error(`AniList error: ${err}`)
        window.history.replaceState(null, '', window.location.pathname)
      }
      return
    }

    const redirectUri = window.location.origin + window.location.pathname
    window.history.replaceState(null, '', window.location.pathname)

    setIsExchanging(true)
    toast('Connecting to AniList...')
    trpcClient.tracker.anilistAuth
      .mutate(accessToken ? { token: accessToken } : { code, redirectUri })
      .then(async (data) => {
        const user = (data as { user?: { name?: string } }).user
        toast.success(`Connected to AniList as ${user?.name ?? 'AniList user'}`)
        queryClient.invalidateQueries({ queryKey: ['trackerStatus'] })
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'Failed to authenticate with AniList')
      })
      .finally(() => {
        setIsExchanging(false)
      })
  }, [queryClient])

  return isExchanging
}

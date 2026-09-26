import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '../lib/trpc'

export interface MusicTrack {
  id: string
  title: string
  artists: string
  album?: string
  duration?: string
  thumbnails: { url: string; width?: number; height?: number }[]
  liked?: boolean | null
}

export interface MusicPlaylist {
  id: string
  title: string
  subtitle?: string
  thumbnails: { url: string; width?: number; height?: number }[]
}

export interface MusicAuthStatus {
  authenticated: boolean
}

const STALE_5_MIN = 5 * 60 * 1000

export const useMusicAuthStatus = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.music.authStatus.queryOptions(),
    staleTime: 30 * 1000,
    refetchInterval: (query) => {
      const data = query.state.data as MusicAuthStatus | undefined
      return data?.authenticated ? false : 3000
    },
    retry: 1,
  })
}

export const useMusicSaveCookie = () => {
  const trpc = useTRPC()
  const qc = useQueryClient()
  return useMutation(
    trpc.music.authStart.mutationOptions({
      onSuccess: (_data, variables) => {
        localStorage.setItem('ytmusic_cookie', variables.cookie ?? '')
        void qc.invalidateQueries(trpc.music.pathFilter())
      },
    })
  )
}

export const useMusicSignOut = () => {
  const trpc = useTRPC()
  const qc = useQueryClient()
  return useMutation(
    trpc.music.signOut.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries(trpc.music.pathFilter())
      },
    })
  )
}

export const useMusicSearch = (query: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.music.search.queryOptions({ q: query }),
    enabled: query.trim().length > 0,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicLibrary = (enabled: boolean) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.music.library.queryOptions(),
    enabled,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicTrack = (trackId: string | null) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.music.track.queryOptions({ id: trackId || undefined }),
    enabled: !!trackId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicPlaylist = (playlistId: string | null) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.music.playlist.queryOptions({ id: playlistId || undefined }),
    enabled: !!playlistId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicUpNext = (trackId: string | null) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.music.upnext.queryOptions({ id: trackId || undefined }),
    enabled: !!trackId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicLikedIds = (enabled: boolean) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.music.likes.queryOptions(),
    enabled,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  })
}

export const useMusicRate = () => {
  const trpc = useTRPC()
  const qc = useQueryClient()
  return useMutation(
    trpc.music.like.mutationOptions({
      onSuccess: () => {
        void qc.invalidateQueries(trpc.music.pathFilter())
      },
    })
  )
}

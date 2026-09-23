import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '../lib/fetchApi'

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
  return useQuery<MusicAuthStatus>({
    queryKey: ['music-auth'],
    queryFn: () => fetchApi('/api/music/auth/status'),
    staleTime: 30 * 1000,
    refetchInterval: (query) => (query.state.data?.authenticated ? false : 3000),
    retry: 1,
  })
}

export const useMusicSaveCookie = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (
      cookie: string
    ): Promise<{ success: boolean; tracks: number; playlists: number }> =>
      fetchApi('/api/music/auth/start', {
        method: 'POST',
        body: JSON.stringify({ cookie }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['music-auth'] })
      qc.invalidateQueries({ queryKey: ['music-library'] })
    },
  })
}

export const useMusicSignOut = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (): Promise<{ success: boolean }> =>
      fetchApi('/api/music/auth/signout', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['music-auth'] })
      qc.invalidateQueries({ queryKey: ['music-library'] })
    },
  })
}

export const useMusicSearch = (query: string) => {
  return useQuery<{ tracks: MusicTrack[] }>({
    queryKey: ['music-search', query],
    queryFn: () => fetchApi(`/api/music/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 0,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicLibrary = (enabled: boolean) => {
  return useQuery<{ tracks: MusicTrack[]; playlists: MusicPlaylist[] }>({
    queryKey: ['music-library'],
    queryFn: () => fetchApi('/api/music/library'),
    enabled,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicTrack = (trackId: string | null) => {
  return useQuery<{ track: MusicTrack | null }>({
    queryKey: ['music-track', trackId],
    queryFn: () => fetchApi(`/api/music/track?id=${encodeURIComponent(trackId || '')}`),
    enabled: !!trackId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicPlaylist = (playlistId: string | null) => {
  return useQuery<{ tracks: MusicTrack[] }>({
    queryKey: ['music-playlist', playlistId],
    queryFn: () => fetchApi(`/api/music/playlist?id=${encodeURIComponent(playlistId || '')}`),
    enabled: !!playlistId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicUpNext = (trackId: string | null) => {
  return useQuery<{ tracks: MusicTrack[]; playlistId?: string | null }>({
    queryKey: ['music-upnext', trackId],
    queryFn: () => fetchApi(`/api/music/upnext?id=${encodeURIComponent(trackId || '')}`),
    enabled: !!trackId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useMusicLikedIds = (enabled: boolean) => {
  return useQuery<{ likedIds: string[] }>({
    queryKey: ['music-likes'],
    queryFn: () => fetchApi('/api/music/likes'),
    enabled,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  })
}

export const useMusicRate = () => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      like,
    }: {
      id: string
      like: boolean
    }): Promise<{
      success: boolean
      liked: boolean
    }> =>
      fetchApi('/api/music/like', {
        method: 'POST',
        body: JSON.stringify({ id, like }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['music-likes'] })
      qc.invalidateQueries({ queryKey: ['music-library'] })
      qc.invalidateQueries({ queryKey: ['music-upnext'] })
    },
  })
}

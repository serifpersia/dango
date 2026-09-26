import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/fetchApi'
import { useTRPC } from '../lib/trpc'

const STALE_5_MIN = 1000 * 60 * 5

export interface TvSearchItem {
  id: number
  title: string
  year: string
  type: string
  image: string
  vote_average?: number
  adult?: boolean
}

export interface TvDetails {
  id: number
  imdb_id: string | null
  title?: string
  overview?: string
  vote_average?: number
  year: string
  poster: string
  backdrop: string
  adult: boolean
  seasons?: { season_number: number; episode_count: number }[]
  number_of_seasons?: number
}

export interface TvEpisode {
  episode_number: number
  name?: string
  vote_average?: number
  overview?: string
  still_path?: string | null
}

export interface TvStreamSource {
  url: string
  quality: string
  type: 'hls' | 'mp4'
}

export interface TvAudioTrack {
  language: string
  label: string
}

export interface TvSubtitle {
  language: string
  label: string
  url: string
}

export interface TvSourcesResult {
  provider?: string
  server?: string
  sources: TvStreamSource[]
  audioTracks: TvAudioTrack[]
  subtitles?: TvSubtitle[]
  referer?: string
  valid?: boolean
  error?: string
}

export interface TvSearchResult {
  id: number
  title: string
  year: string
  type: string
  image: string
  backdrop: string
  overview: string
  vote_average: number
  adult: boolean
  genre_ids: number[]
}

export interface TvSearchResponse {
  results: TvSearchResult[]
  total_results: number
  total_pages: number
  page: number
}

export interface TvGenre {
  id: number
  name: string
}

export const useTvSearch = (query: string, enabled: boolean = true) => {
  const trpc = useTRPC()
  const q = query.trim()
  return useQuery({
    ...trpc.tv.search.queryOptions({ q }),
    enabled: enabled && q.length > 0,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useTvSearchPaginated = (params: {
  query?: string
  type?: string
  genre?: string
  year?: string
  sort_by?: string
  page?: number
}) => {
  const trpc = useTRPC()
  const { query, type, genre, year, sort_by, page } = params
  return useQuery({
    ...trpc.tv.search.queryOptions({
      q: query?.trim() || '',
      type: type || 'multi',
      genre: genre || '',
      year: year && year !== 'ALL' ? year : '',
      sortBy: sort_by || 'popularity.desc',
      page: page || 1,
    }),
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useTvTrending = (
  mediaType: string = 'all',
  timeWindow: string = 'week',
  page: number = 1,
  enabled: boolean = true
) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tv.trending.queryOptions({ mediaType, timeWindow, page }),
    enabled,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useTvGenres = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tv.genres.queryOptions(),
    staleTime: 86400000,
    retry: 1,
  })
}

export const useTvDetails = (type?: string, id?: string | number) => {
  const trpc = useTRPC()
  const numericId = Number(id)
  return useQuery({
    ...trpc.tv.details.queryOptions({ type: type || '', id: String(id ?? '') }),
    enabled: !!type && !!numericId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useTvEpisodes = (
  tmdbId?: string | number,
  season?: number,
  enabled: boolean = true
) => {
  const trpc = useTRPC()
  const numericId = Number(tmdbId)
  const seasonNum = Number(season) || 1
  return useQuery({
    ...trpc.tv.episodes.queryOptions({ id: String(tmdbId ?? ''), season: String(seasonNum) }),
    enabled: enabled && !!numericId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export interface TvSourceParams {
  provider: string
  type: string
  tmdbId: string | number
  season: number
  episode: number
  title?: string
  year?: string
  imdbId?: string
  totalSeasons?: number
  server?: string
}

export const useTvSources = (params: TvSourceParams, enabled: boolean = true) => {
  const trpc = useTRPC()
  const { provider, type, tmdbId, season, episode, title, year, imdbId, totalSeasons, server } =
    params
  return useQuery({
    ...trpc.tv.sources.queryOptions({
      provider,
      type,
      tmdbId: String(tmdbId),
      season,
      episode,
      title: title || '',
      year: year || '',
      imdbId: imdbId || '',
      totalSeasons: String(totalSeasons || 1),
      ...(server ? { server } : {}),
    }),
    enabled: enabled && !!provider && !!tmdbId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useTvEmbed = (
  provider: string,
  type: string,
  tmdbId: string | number,
  season: number,
  episode: number,
  enabled: boolean = true
) => {
  return useQuery<{ url: string | null; error?: string }>({
    queryKey: ['tv-embed', provider, type, tmdbId, season, episode],
    queryFn: () =>
      fetchApi(`/api/tv/embed/${provider}/${type}/${tmdbId}?season=${season}&episode=${episode}`),
    enabled: enabled && !!provider && !!tmdbId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useTvSubtitles = (
  type: string,
  tmdbId: string | number,
  season: number,
  episode: number,
  enabled: boolean = true
) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.tv.subtitles.queryOptions({
      type,
      tmdbId: String(tmdbId),
      season: String(season),
      episode: String(episode),
    }),
    enabled: enabled && !!tmdbId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

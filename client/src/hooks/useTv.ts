import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/fetchApi'

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
  title: string
  overview: string
  vote_average?: number
  year: string
  poster: string
  backdrop: string
  imdb_id?: string
  adult?: boolean
  seasons?: { season_number: number; episode_count: number }[]
  number_of_seasons?: number
}

export interface TvEpisode {
  episode_number: number
  name: string
  vote_average?: number
  overview: string
  still_path: string
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
  provider: string
  server?: string
  sources: TvStreamSource[]
  audioTracks: TvAudioTrack[]
  subtitles?: TvSubtitle[]
  referer?: string
  valid: boolean
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
  const q = query.trim()
  return useQuery<TvSearchItem[]>({
    queryKey: ['tv-search', q],
    queryFn: () => fetchApi(`/api/tv/search?q=${encodeURIComponent(q)}`),
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
  const { query, type, genre, year, sort_by, page } = params
  const searchParams = new URLSearchParams()
  if (query?.trim()) searchParams.set('q', query.trim())
  if (type && type !== 'multi') searchParams.set('type', type)
  if (genre) searchParams.set('genre', genre)
  if (year && year !== 'ALL') searchParams.set('year', year)
  if (sort_by && sort_by !== 'popularity.desc') searchParams.set('sort_by', sort_by)
  searchParams.set('page', String(page || 1))
  const qs = searchParams.toString()
  return useQuery<TvSearchResponse>({
    queryKey: ['tv-search-paginated', qs],
    queryFn: () => fetchApi(`/api/tv/search?${qs}`),
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
  return useQuery<TvSearchResponse>({
    queryKey: ['tv-trending', mediaType, timeWindow, page],
    queryFn: () =>
      fetchApi(`/api/tv/trending?media_type=${mediaType}&time_window=${timeWindow}&page=${page}`),
    enabled,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

export const useTvGenres = () => {
  return useQuery<{ tv: TvGenre[]; movie: TvGenre[] }>({
    queryKey: ['tv-genres'],
    queryFn: () => fetchApi('/api/tv/genres'),
    staleTime: 86400000,
    retry: 1,
  })
}

export const useTvDetails = (type?: string, id?: string | number) => {
  const numericId = Number(id)
  return useQuery<TvDetails>({
    queryKey: ['tv-details', type, numericId],
    queryFn: () => fetchApi(`/api/tv/details/${type}/${numericId}`),
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
  const numericId = Number(tmdbId)
  const seasonNum = Number(season) || 1
  return useQuery<{ episodes: TvEpisode[] }>({
    queryKey: ['tv-episodes', numericId, seasonNum],
    queryFn: () => fetchApi(`/api/tv/episodes/${numericId}/${seasonNum}`),
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
  const { provider, type, tmdbId, season, episode, title, year, imdbId, totalSeasons, server } =
    params
  return useQuery<TvSourcesResult>({
    queryKey: ['tv-sources', provider, type, tmdbId, season, episode, server],
    queryFn: () => {
      const p = new URLSearchParams({
        title: title || '',
        year: year || '',
        season: String(season),
        episode: String(episode),
        totalSeasons: String(totalSeasons || 1),
        imdbId: imdbId || '',
      })
      if (server) p.set('server', server)
      return fetchApi(`/api/tv/sources/${provider}/${type}/${tmdbId}?${p.toString()}`)
    },
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
  return useQuery<{ subtitles: TvSubtitle[] }>({
    queryKey: ['tv-subtitles', type, tmdbId, season, episode],
    queryFn: () =>
      fetchApi(`/api/tv/subtitles/${type}/${tmdbId}?season=${season}&episode=${episode}`),
    enabled: enabled && !!tmdbId,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
}

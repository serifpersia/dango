import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../lib/trpc'

const STALE_5_MIN = 1000 * 60 * 5

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

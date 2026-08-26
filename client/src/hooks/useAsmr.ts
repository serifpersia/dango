import { useQueries, useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/fetchApi'

export interface AsmrWork {
  _id: string
  id?: string
  name: string
  thumbnail?: string
  description?: string
  isAdult?: boolean
}

export interface AsmrBrowseResult {
  shows: AsmrWork[]
  hasNext: boolean
}

export interface AsmrTrack {
  resolutionStr: string
  link: string
  hls: boolean
}

export interface AsmrChapter {
  time: number
  label: string
}

export interface AsmrWorkDetail {
  rjCode: string
  description: string
  tracks: AsmrTrack[]
  images?: string[]
  chapters?: AsmrChapter[]
}

const STALE_5_MIN = 5 * 60 * 1000

export const PER_PAGE = 15

export const useAsmrBrowse = (query: string, page: number, sort: string, rating: string) => {
  const pageCount = page + 1

  const queries = useQueries({
    queries: Array.from({ length: pageCount }, (_, i) => {
      const n = i + 1
      return {
        queryKey: ['asmrBrowse', query, n, sort, rating],
        queryFn: () => {
          const params = new URLSearchParams()
          if (query.trim()) params.set('q', query.trim())
          params.set('page', n.toString())
          if (sort && sort !== 'latest') params.set('sort', sort)
          if (rating) params.set('rating', rating)
          return fetchApi(`/api/asmr/browse?${params.toString()}`)
        },
        staleTime: STALE_5_MIN,
      }
    }),
  })

  const flat: AsmrWork[] = queries.flatMap(
    (q) => (q.data as AsmrBrowseResult | undefined)?.shows ?? []
  )
  const windowShows = flat.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const lastData = queries[queries.length - 1]?.data as AsmrBrowseResult | undefined
  const hasNext = Boolean(lastData && (lastData.hasNext || flat.length > page * PER_PAGE))

  const isLoading = queries.some((q) => q.isLoading)
  const isFetching = queries.some((q) => q.isFetching)
  const isError = queries.some((q) => q.isError)

  return {
    data: { shows: windowShows, hasNext } as AsmrBrowseResult,
    isLoading,
    isError,
    isFetching,
  }
}

export const useAsmrWork = (rjCode: string | null) => {
  return useQuery<AsmrWorkDetail>({
    queryKey: ['asmrWork', rjCode],
    queryFn: () => fetchApi(`/api/asmr/work/${rjCode}`),
    enabled: !!rjCode,
    staleTime: STALE_5_MIN,
    refetchOnMount: 'always',
  })
}

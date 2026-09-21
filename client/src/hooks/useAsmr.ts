import { useQueries, useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/fetchApi'

export interface AsmrEpisodeAvailability {
  sub?: number
  dub?: number
}

export interface AsmrEpisodeAvailabilityDetail {
  sub?: string[]
  dub?: string[]
}

export interface AsmrWork {
  _id: string
  id?: string
  name: string
  thumbnail?: string
  description?: string
  isAdult?: boolean
  rating?: string
  type?: string
  nativeName?: string
  englishName?: string
  availableEpisodes?: AsmrEpisodeAvailability
  availableEpisodesDetail?: AsmrEpisodeAvailabilityDetail
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

const SPOTLIGHT_MONTH_PAGES = 15
const SPOTLIGHT_NEED = 6

export function isAsmrSpotlightSafe(work: AsmrWork): boolean {
  if (work.isAdult) return false
  if (!work.thumbnail) return false
  const rating = (work.rating || '').toLowerCase()
  return rating === '' || rating === 'sfw'
}

function mergeSpotlightShows(lists: AsmrWork[][], need: number): AsmrWork[] {
  const seen = new Set<string>()
  const out: AsmrWork[] = []
  for (const shows of lists) {
    for (const work of shows) {
      if (out.length >= need) return out
      const id = work.id || work._id
      if (!id || seen.has(id)) continue
      seen.add(id)
      if (isAsmrSpotlightSafe(work)) out.push(work)
    }
  }
  return out
}

export const useAsmrSpotlight = (enabled = true) => {
  const month = useQueries({
    queries: Array.from({ length: SPOTLIGHT_MONTH_PAGES }, (_, i) => {
      const n = i + 1
      return {
        queryKey: ['asmrBrowse', '', n, 'popular_month', ''],
        queryFn: () => {
          const params = new URLSearchParams()
          params.set('page', String(n))
          params.set('sort', 'popular_month')
          return fetchApi(`/api/asmr/browse?${params.toString()}`)
        },
        staleTime: STALE_5_MIN,
        enabled,
        retry: 1,
      }
    }),
  })

  const monthLists = month.map((q) => (q.data as AsmrBrowseResult | undefined)?.shows ?? [])
  const merged = mergeSpotlightShows(monthLists, SPOTLIGHT_NEED)

  const settled = month.every((q) => q.isFetched)
  const needFallback = enabled && settled && merged.length < SPOTLIGHT_NEED
  const fallback = useQuery({
    queryKey: ['asmrBrowse', '', 1, 'popular', 'sfw'],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set('page', '1')
      params.set('sort', 'popular')
      params.set('rating', 'sfw')
      return fetchApi(`/api/asmr/browse?${params.toString()}`)
    },
    staleTime: STALE_5_MIN,
    enabled: needFallback,
    retry: 1,
  })
  const fallbackShows = (fallback.data as AsmrBrowseResult | undefined)?.shows ?? []
  const works =
    merged.length >= SPOTLIGHT_NEED
      ? merged.slice(0, SPOTLIGHT_NEED)
      : mergeSpotlightShows([merged, fallbackShows], SPOTLIGHT_NEED)

  const isLoading =
    enabled && (month.some((q) => q.isLoading) || (needFallback && fallback.isLoading))
  const isError = enabled && settled && works.length === 0 && month.some((q) => q.isError)

  return { data: works, isLoading, isError }
}

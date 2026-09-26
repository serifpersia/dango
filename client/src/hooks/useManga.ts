import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { trpcClient, useTRPC } from '../lib/trpc'

export type MangaProviderName = string

export interface MangaCard {
  id: string
  provider: MangaProviderName
  title: string
  altTitle?: string
  cover: string
  status?: string
  year?: number | null
  type?: string
  genres?: string[]
  contentRating?: string
  latestChapter?: string
}

export interface MangaChapter {
  id: string
  provider: MangaProviderName
  mangaId: string
  number: string
  title?: string
  volume?: string
  language?: string
  pages?: number
  group?: string
  externalUrl?: string
  publishedAt?: string
}

export interface MangaDetail extends MangaCard {
  description?: string
  author?: string
  artist?: string
  chapters: MangaChapter[]
}

export interface MangaBrowseResult {
  items: MangaCard[]
  hasNext: boolean
  total?: number
}

const STALE_5_MIN = 5 * 60 * 1000

const PROVIDER_REFERER: Record<string, string> = {
  mangadex: 'https://mangadex.org/',
  mangapill: 'https://www.mangapill.com/',
}

export const mangaPageSrc = (provider: MangaProviderName, url: string) =>
  `/api/proxy?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(PROVIDER_REFERER[provider])}`

export const mangaCoverSrc = (provider: MangaProviderName, url: string) => {
  if (!url) return url
  if (provider === 'mangapill') return mangaPageSrc(provider, url)
  return url
}

export interface MangaBrowseParams {
  provider: MangaProviderName
  query: string
  page: number
  sort: string
  status: string
  type: string
  rating: string
  mature: boolean
}

export const useMangaBrowse = (params: MangaBrowseParams, enabled: boolean = true) => {
  const { provider, query, page, sort, status, type, rating, mature } = params
  return useQuery({
    queryKey: ['mangaBrowse', provider, query, page, sort, status, type, rating, mature],
    queryFn: () => {
      return trpcClient.manga.search.query({
        provider,
        q: query.trim() || undefined,
        page,
        sort: sort || undefined,
        status: status || undefined,
        type: type || undefined,
        rating: rating || undefined,
        mature: mature ? '1' : undefined,
      }) as Promise<MangaBrowseResult>
    },
    staleTime: STALE_5_MIN,
    enabled: enabled && !!provider,
  })
}

export const useInfiniteMangaBrowse = (
  params: Omit<MangaBrowseParams, 'page'>,
  size: number = 14
) => {
  const { provider, query, sort, status, type, rating, mature } = params
  return useInfiniteQuery<MangaBrowseResult>({
    queryKey: ['mangaBrowseInfinite', provider, query, sort, status, type, rating, mature, size],
    queryFn: ({ pageParam = 1 }) => {
      return trpcClient.manga.search.query({
        provider,
        q: query.trim() || undefined,
        page: pageParam as number,
        limit: size,
        sort: sort || undefined,
        status: status || undefined,
        type: type || undefined,
        rating: rating || undefined,
        mature: mature ? '1' : undefined,
      }) as Promise<MangaBrowseResult>
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => (lastPage.hasNext ? allPages.length + 1 : undefined),
    staleTime: STALE_5_MIN,
    enabled: !!provider,
  })
}

export const useMangaDetail = (
  provider: MangaProviderName | null,
  id: string | null,
  rating = 'safe',
  mature = false
) => {
  return useQuery({
    queryKey: ['mangaDetail', provider, id, rating, mature],
    queryFn: () => {
      return trpcClient.manga.info.query({
        provider: provider || '',
        id: id || '',
        rating,
        mature: mature ? '1' : undefined,
      }) as Promise<MangaDetail>
    },
    enabled: !!provider && !!id,
    staleTime: STALE_5_MIN,
  })
}

export const useMangaPages = (
  provider: MangaProviderName | null,
  chapterId: string | null,
  enabled: boolean
) => {
  return useQuery({
    queryKey: ['mangaPages', provider, chapterId],
    queryFn: () =>
      trpcClient.manga.pages.query({
        provider: provider || '',
        id: chapterId || '',
      }) as Promise<{ pages: string[] }>,
    enabled: enabled && !!provider && !!chapterId,
    staleTime: 30 * 60 * 1000,
  })
}

export interface MangaTrendingItem {
  id: string
  title: string
  description: string
  tags: string[]
  year: number | null
  status: string | null
  cover: string
}

export const useMangaTrending = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.manga.trending.queryOptions(),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
}

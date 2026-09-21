import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchApi } from '../lib/fetchApi'
import type { MangaProviderName, MangaCard } from './useManga'

export type MangaLibraryStatus = 'Reading' | 'Completed' | 'On-Hold' | 'Dropped' | 'Planned'

export const MANGA_LIBRARY_STATUSES: MangaLibraryStatus[] = [
  'Reading',
  'Completed',
  'On-Hold',
  'Dropped',
  'Planned',
]

export interface MangaLibraryItem {
  id: string
  provider: string
  mangaId: string
  title: string
  cover: string
  status: string
  author?: string | null
  altTitle?: string | null
  contentRating?: string | null
  lastChapterId?: string | null
  lastChapterNumber?: string | null
  lastPage?: number | null
  updatedAt?: number | null
}

export interface MangaProgressItem {
  mangaId: string
  chapterId: string
  chapterNumber: string
  page: number
  pageCount: number
  updatedAt: number
}

export interface ContinueReadingItem extends MangaLibraryItem {
  chapterId?: string | null
  chapterNumber?: string | null
  page?: number | null
  pageCount?: number | null
  progressAt?: number | null
}

interface PaginatedMangaLibrary {
  data: MangaLibraryItem[]
  total: number
  page: number
  limit: number
}

export const mangaLibraryId = (provider: string, mangaId: string) =>
  `${provider.toLowerCase()}:${mangaId}`

export const useMangaLibrary = (status: string = 'All', page: number = 1, limit: number = 24) => {
  return useQuery<PaginatedMangaLibrary>({
    queryKey: ['manga-library', status, page, limit],
    queryFn: () => {
      const p = new URLSearchParams()
      p.set('status', status)
      p.set('page', String(page))
      p.set('limit', String(limit))
      return fetchApi(`/api/manga/library?${p.toString()}`)
    },
  })
}

export const useMangaLibraryIds = () => {
  return useQuery<{ ids: string[] }>({
    queryKey: ['manga-library-ids'],
    queryFn: () => fetchApi('/api/manga/library/ids'),
    staleTime: 1000 * 60,
  })
}

export const useMangaLibraryCheck = (id?: string) => {
  return useQuery<{ inLibrary: boolean; status: string | null }>({
    queryKey: ['manga-library-check', id],
    queryFn: () => fetchApi(`/api/manga/library/check/${encodeURIComponent(id || '')}`),
    enabled: !!id,
    staleTime: 1000 * 60,
  })
}

export const useMangaContinueReading = (limit: number = 24) => {
  return useQuery<{ data: ContinueReadingItem[]; total: number }>({
    queryKey: ['manga-continue-reading', limit],
    queryFn: () => fetchApi(`/api/manga/continue-reading?limit=${limit}`),
  })
}

export const useMangaProgress = (mangaId?: string) => {
  return useQuery<{ progress: MangaProgressItem[] }>({
    queryKey: ['manga-progress', mangaId],
    queryFn: () => fetchApi(`/api/manga/progress/${encodeURIComponent(mangaId || '')}`),
    enabled: !!mangaId,
  })
}

export const useAddMangaBookmark = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: {
      provider: MangaProviderName
      mangaId: string
      title: string
      cover?: string
      status?: string
      author?: string
      altTitle?: string
      contentRating?: string
      silent?: boolean
    }) => {
      const { silent: _silent, ...body } = item
      return fetchApi('/api/manga/library/add', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<{ success: boolean; id: string }>
    },
    onSuccess: (_data, variables) => {
      if (!variables.silent) toast.success('Bookmarked')
      queryClient.invalidateQueries({ queryKey: ['manga-library'] })
      queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
      queryClient.invalidateQueries({
        queryKey: ['manga-library-check', mangaLibraryId(variables.provider, variables.mangaId)],
      })
    },
    onError: (error: Error) => {
      toast.error(`Failed to bookmark: ${error.message}`)
    },
  })
}

export const useRemoveMangaBookmark = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await fetchApi('/api/manga/library/remove', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
    },
    onSuccess: (_data, id) => {
      toast.success('Bookmark removed')
      queryClient.invalidateQueries({ queryKey: ['manga-library'] })
      queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
      queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
      queryClient.invalidateQueries({ queryKey: ['manga-library-check', id] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove: ${error.message}`)
    },
  })
}

export const useUpdateMangaStatus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await fetchApi('/api/manga/library/status', {
        method: 'POST',
        body: JSON.stringify({ id, status }),
      })
    },
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['manga-library'] })
      queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to update status: ${error.message}`)
    },
  })
}

export const useSaveMangaProgress = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (progress: {
      mangaId: string
      chapterId: string
      chapterNumber?: string
      page: number
      pageCount?: number
    }) => {
      await fetchApi('/api/manga/progress', {
        method: 'POST',
        body: JSON.stringify(progress),
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['manga-progress', variables.mangaId] })
      queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
      queryClient.invalidateQueries({ queryKey: ['manga-library'] })
      queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
    },
  })
}

export const useRemoveMangaProgress = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ mangaId, chapterId }: { mangaId: string; chapterId?: string }) => {
      await fetchApi('/api/manga/progress/remove', {
        method: 'POST',
        body: JSON.stringify({ mangaId, chapterId }),
      })
    },
    onSuccess: () => {
      toast.success('Progress reset')
      queryClient.invalidateQueries({ queryKey: ['manga-progress'] })
      queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
      queryClient.invalidateQueries({ queryKey: ['manga-library'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset progress: ${error.message}`)
    },
  })
}

export const useToggleMangaBookmark = () => {
  const add = useAddMangaBookmark()
  const remove = useRemoveMangaBookmark()
  const { data: idsData } = useMangaLibraryIds()
  const bookmarkedIds = useMemo(() => new Set(idsData?.ids || []), [idsData])

  const toggle = (
    item: Pick<MangaCard, 'id' | 'provider' | 'title' | 'cover'> & {
      contentRating?: string
      altTitle?: string
    }
  ) => {
    const libId = mangaLibraryId(item.provider, item.id)
    if (bookmarkedIds.has(libId)) {
      remove.mutate(libId)
    } else {
      add.mutate({
        provider: item.provider,
        mangaId: item.id,
        title: item.title,
        cover: item.cover,
        altTitle: item.altTitle,
        contentRating: item.contentRating,
      })
    }
  }

  return { toggle, bookmarkedIds, pending: add.isPending || remove.isPending }
}

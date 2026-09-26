import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useTRPC } from '../lib/trpc'
import type { MangaCard } from './useManga'

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

export const mangaLibraryId = (provider: string, mangaId: string) =>
  `${provider.toLowerCase()}:${mangaId}`

export const useMangaLibrary = (status: string = 'All', page: number = 1, limit: number = 24) => {
  const trpc = useTRPC()
  return useQuery(trpc.mangaLibrary.list.queryOptions({ status, page, limit }))
}

export const useMangaLibraryIds = () => {
  const trpc = useTRPC()
  return useQuery({ ...trpc.mangaLibrary.ids.queryOptions(), staleTime: 1000 * 60 })
}

export const useMangaLibraryCheck = (id?: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.mangaLibrary.check.queryOptions({ id: id ?? '' }),
    enabled: !!id,
    staleTime: 1000 * 60,
  })
}

export const useMangaLibraryEntry = (id?: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.mangaLibrary.entry.queryOptions({ id: id ?? '' }),
    enabled: !!id,
    staleTime: 1000 * 60,
  })
}

export const useLinkMangaAnilist = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaLibrary.link.mutationOptions({
      onSuccess: (data) => {
        toast.success(
          data?.progressMigrated
            ? 'Linked — chapter progress carried over'
            : 'Linked to AniList entry'
        )
        void queryClient.invalidateQueries(trpc.mangaLibrary.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
        queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library-check'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library-entry'] })
      },
      onError: (error) => {
        toast.error(`Failed to link: ${error.message}`)
      },
    })
  )
}

export const useMangaContinueReading = (limit: number = 24) => {
  const trpc = useTRPC()
  return useQuery(trpc.mangaProgress.continueReading.queryOptions({ limit }))
}

export const useMangaProgress = (mangaId?: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.mangaProgress.byManga.queryOptions({ mangaId: mangaId ?? '' }),
    enabled: !!mangaId,
  })
}

export const useAddMangaBookmark = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaLibrary.add.mutationOptions({
      onSuccess: (_data, variables) => {
        if (!variables.silent) toast.success('Bookmarked')
        void queryClient.invalidateQueries(trpc.mangaLibrary.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
        queryClient.invalidateQueries({
          queryKey: [
            'manga-library-check',
            mangaLibraryId(variables.provider ?? '', variables.mangaId ?? ''),
          ],
        })
      },
      onError: (error) => {
        toast.error(`Failed to bookmark: ${error.message}`)
      },
    })
  )
}

export const useRemoveMangaBookmark = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaLibrary.remove.mutationOptions({
      onSuccess: (_data, id) => {
        toast.success('Bookmark removed')
        void queryClient.invalidateQueries(trpc.mangaLibrary.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
        queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library-check', id] })
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useUpdateMangaStatus = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaLibrary.setStatus.mutationOptions({
      onSuccess: () => {
        toast.success('Status updated')
        void queryClient.invalidateQueries(trpc.mangaLibrary.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
      },
      onError: (error) => {
        toast.error(`Failed to update status: ${error.message}`)
      },
    })
  )
}

export const useSaveMangaProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaProgress.save.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: ['manga-progress', variables.mangaId] })
        queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
        void queryClient.invalidateQueries(trpc.mangaProgress.pathFilter())
      },
    })
  )
}

export const useRemoveMangaProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaProgress.remove.mutationOptions({
      onSuccess: () => {
        toast.success('Progress reset')
        queryClient.invalidateQueries({ queryKey: ['manga-progress'] })
        queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        void queryClient.invalidateQueries(trpc.mangaProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to reset progress: ${error.message}`)
      },
    })
  )
}

export const useBatchUpdateMangaStatus = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaLibrary.batchStatus.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Status updated for ${data.updated ?? 0} items`)
        void queryClient.invalidateQueries(trpc.mangaLibrary.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
      },
      onError: (error) => {
        toast.error(`Failed to update statuses: ${error.message}`)
      },
    })
  )
}

export const useBatchRemoveManga = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaLibrary.removeMany.mutationOptions({
      onSuccess: (data) => {
        const count = data.removed ?? 0
        toast.success(`Removed ${count} ${count === 1 ? 'item' : 'items'} from reading list`)
        void queryClient.invalidateQueries(trpc.mangaLibrary.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library-ids'] })
        queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useBatchRemoveMangaProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.mangaProgress.removeMany.mutationOptions({
      onSuccess: (data) => {
        const count = data.removed ?? 0
        toast.success(`Reset progress for ${count} ${count === 1 ? 'item' : 'items'}`)
        queryClient.invalidateQueries({ queryKey: ['manga-progress'] })
        queryClient.invalidateQueries({ queryKey: ['manga-continue-reading'] })
        queryClient.invalidateQueries({ queryKey: ['manga-library'] })
        void queryClient.invalidateQueries(trpc.mangaProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to reset progress: ${error.message}`)
      },
    })
  )
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

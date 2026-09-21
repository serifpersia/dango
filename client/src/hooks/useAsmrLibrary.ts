import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchApi } from '../lib/fetchApi'
import { buildAsmrId } from '../lib/asmr'

export type AsmrLibraryStatus = 'Listening' | 'Completed' | 'On-Hold' | 'Dropped' | 'Planned'

export const ASMR_LIBRARY_STATUSES: AsmrLibraryStatus[] = [
  'Listening',
  'Completed',
  'On-Hold',
  'Dropped',
  'Planned',
]

export interface AsmrLibraryItem {
  id: string
  rjCode: string
  title: string
  thumbnail: string
  status: string
  isAdult?: number | null
  lastTrackIndex?: number | null
  lastTrackLabel?: string | null
  lastPosition?: number | null
  updatedAt?: number | null
}

export interface AsmrProgressItem {
  workId: string
  trackIndex: number
  trackLabel: string
  currentTime: number
  duration: number
  updatedAt: number
}

export interface ContinueListeningItem extends AsmrLibraryItem {
  trackIndex?: number | null
  trackLabel?: string | null
  currentTime?: number | null
  duration?: number | null
  progressAt?: number | null
}

interface PaginatedAsmrLibrary {
  data: AsmrLibraryItem[]
  total: number
  page: number
  limit: number
}

export const asmrLibraryId = (rjCode: string) => buildAsmrId(rjCode)

export const useAsmrLibrary = (status: string = 'All', page: number = 1, limit: number = 24) => {
  return useQuery<PaginatedAsmrLibrary>({
    queryKey: ['asmr-library', status, page, limit],
    queryFn: () => {
      const p = new URLSearchParams()
      p.set('status', status)
      p.set('page', String(page))
      p.set('limit', String(limit))
      return fetchApi(`/api/asmr/library?${p.toString()}`)
    },
  })
}

export const useAsmrLibraryIds = () => {
  return useQuery<{ ids: string[] }>({
    queryKey: ['asmr-library-ids'],
    queryFn: () => fetchApi('/api/asmr/library/ids'),
    staleTime: 1000 * 60,
  })
}

export const useAsmrLibraryCheck = (id?: string) => {
  return useQuery<{ inLibrary: boolean; status: string | null }>({
    queryKey: ['asmr-library-check', id],
    queryFn: () => fetchApi(`/api/asmr/library/check/${encodeURIComponent(id || '')}`),
    enabled: !!id,
    staleTime: 1000 * 60,
  })
}

export const useAsmrContinueListening = (limit: number = 24) => {
  return useQuery<{ data: ContinueListeningItem[]; total: number }>({
    queryKey: ['asmr-continue-listening', limit],
    queryFn: () => fetchApi(`/api/asmr/continue-listening?limit=${limit}`),
  })
}

export const useAsmrProgress = (workId?: string) => {
  return useQuery<{ progress: AsmrProgressItem[] }>({
    queryKey: ['asmr-progress', workId],
    queryFn: () => fetchApi(`/api/asmr/progress/${encodeURIComponent(workId || '')}`),
    enabled: !!workId,
  })
}

export const useAsmrTrackProgress = (workId?: string, trackIndex?: number) => {
  const query = useAsmrProgress(workId)
  const row =
    trackIndex !== undefined
      ? (query.data?.progress ?? []).find((p) => p.trackIndex === trackIndex)
      : undefined
  return { ...query, row }
}

export const useAddAsmrBookmark = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (item: {
      rjCode: string
      title: string
      thumbnail?: string
      status?: string
      isAdult?: boolean
      silent?: boolean
    }) => {
      const { silent: _silent, ...body } = item
      return fetchApi('/api/asmr/library/add', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as Promise<{ success: boolean; id: string }>
    },
    onSuccess: (_data, variables) => {
      if (!variables.silent) toast.success('Added to listening list')
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-library-ids'] })
      queryClient.invalidateQueries({
        queryKey: ['asmr-library-check', asmrLibraryId(variables.rjCode)],
      })
    },
    onError: (error: Error) => {
      toast.error(`Failed to add: ${error.message}`)
    },
  })
}

export const useRemoveAsmrBookmark = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      await fetchApi('/api/asmr/library/remove', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
    },
    onSuccess: (_data, id) => {
      toast.success('Removed from listening list')
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-library-ids'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-library-check', id] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove: ${error.message}`)
    },
  })
}

export const useUpdateAsmrStatus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await fetchApi('/api/asmr/library/status', {
        method: 'POST',
        body: JSON.stringify({ id, status }),
      })
    },
    onSuccess: () => {
      toast.success('Status updated')
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to update status: ${error.message}`)
    },
  })
}

export const useSaveAsmrProgress = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (progress: {
      workId: string
      trackIndex: number
      trackLabel?: string
      currentTime: number
      duration?: number
      title?: string
      thumbnail?: string
      rjCode?: string
      isAdult?: number
    }) => {
      await fetchApi('/api/asmr/progress', {
        method: 'POST',
        body: JSON.stringify(progress),
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['asmr-progress', variables.workId] })
      queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-library-ids'] })
    },
  })
}

export const useRemoveAsmrProgress = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ workId, trackIndex }: { workId: string; trackIndex?: number }) => {
      await fetchApi('/api/asmr/progress/remove', {
        method: 'POST',
        body: JSON.stringify({ workId, trackIndex }),
      })
    },
    onSuccess: () => {
      toast.success('Progress reset')
      queryClient.invalidateQueries({ queryKey: ['asmr-progress'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset progress: ${error.message}`)
    },
  })
}

export const useBatchUpdateAsmrStatus = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ ids, status }: { ids: string[]; status: string }) => {
      return fetchApi('/api/asmr/library/batch-status', {
        method: 'POST',
        body: JSON.stringify({ ids, status }),
      }) as Promise<{ success: boolean; updated: number }>
    },
    onSuccess: (data) => {
      toast.success(`Status updated for ${data.updated ?? 0} items`)
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to update statuses: ${error.message}`)
    },
  })
}

export const useBatchRemoveAsmr = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      return fetchApi('/api/asmr/library/remove-many', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }) as Promise<{ success: boolean; removed: number }>
    },
    onSuccess: (data) => {
      const count = data.removed ?? 0
      toast.success(`Removed ${count} ${count === 1 ? 'item' : 'items'} from listening list`)
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-library-ids'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove: ${error.message}`)
    },
  })
}

export const useBatchRemoveAsmrProgress = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ids: string[]) => {
      return fetchApi('/api/asmr/progress/remove-many', {
        method: 'POST',
        body: JSON.stringify({ ids }),
      }) as Promise<{ success: boolean; removed: number }>
    },
    onSuccess: (data) => {
      const count = data.removed ?? 0
      toast.success(`Reset progress for ${count} ${count === 1 ? 'item' : 'items'}`)
      queryClient.invalidateQueries({ queryKey: ['asmr-progress'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to reset progress: ${error.message}`)
    },
  })
}

export const useToggleAsmrBookmark = () => {
  const add = useAddAsmrBookmark()
  const remove = useRemoveAsmrBookmark()
  const { data: idsData } = useAsmrLibraryIds()
  const bookmarkedIds = useMemo(() => new Set(idsData?.ids || []), [idsData])

  const toggle = (item: {
    rjCode: string
    title: string
    thumbnail?: string
    isAdult?: boolean
  }) => {
    const libId = asmrLibraryId(item.rjCode)
    if (bookmarkedIds.has(libId)) {
      remove.mutate(libId)
    } else {
      add.mutate({ ...item, thumbnail: item.thumbnail || '' })
    }
  }

  return { toggle, bookmarkedIds, pending: add.isPending || remove.isPending }
}

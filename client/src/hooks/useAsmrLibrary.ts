import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { buildAsmrId } from '../lib/asmr'
import { trpcClient, useTRPC } from '../lib/trpc'

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

export interface ContinueListeningItem extends AsmrLibraryItem {
  trackIndex?: number | null
  trackLabel?: string | null
  currentTime?: number | null
  duration?: number | null
  progressAt?: number | null
}

export const asmrLibraryId = (rjCode: string) => buildAsmrId(rjCode)

export const useAsmrLibrary = (status: string = 'All', page: number = 1, limit: number = 24) => {
  const trpc = useTRPC()
  return useQuery(trpc.asmrLibrary.list.queryOptions({ status, page, limit }))
}

export const useAsmrLibraryIds = () => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.asmrLibrary.ids.queryOptions(),
    staleTime: 1000 * 60,
  })
}

export const useAsmrLibraryCheck = (id?: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.asmrLibrary.check.queryOptions({ id: id || '' }),
    enabled: !!id,
    staleTime: 1000 * 60,
  })
}

export const useAsmrContinueListening = (limit: number = 24) => {
  const trpc = useTRPC()
  return useQuery(trpc.asmrProgress.continueListening.queryOptions({ limit }))
}

export const useAsmrProgress = (workId?: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.asmrProgress.getByWork.queryOptions({ workId: workId || '' }),
    enabled: !!workId,
  })
}

export const useAddAsmrBookmark = () => {
  const trpc = useTRPC()
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
      return trpcClient.asmrLibrary.add.mutate(body)
    },
    onSuccess: (_data, variables) => {
      if (!variables.silent) toast.success('Added to listening list')
      queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
      void queryClient.invalidateQueries(trpc.asmrLibrary.pathFilter())
    },
    onError: (error: Error) => {
      toast.error(`Failed to add: ${error.message}`)
    },
  })
}

export const useRemoveAsmrBookmark = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.asmrLibrary.remove.mutationOptions({
      onSuccess: () => {
        toast.success('Removed from listening list')
        queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
        void queryClient.invalidateQueries(trpc.asmrLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.asmrProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useUpdateAsmrStatus = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.asmrLibrary.setStatus.mutationOptions({
      onSuccess: () => {
        toast.success('Status updated')
        queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
        void queryClient.invalidateQueries(trpc.asmrLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.asmrProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to update status: ${error.message}`)
      },
    })
  )
}

export const useSaveAsmrProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.asmrProgress.save.mutationOptions({
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: ['asmr-progress', variables.workId] })
        queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
        void queryClient.invalidateQueries(trpc.asmrLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.asmrProgress.pathFilter())
      },
    })
  )
}

export const useRemoveAsmrProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.asmrProgress.remove.mutationOptions({
      onSuccess: () => {
        toast.success('Progress reset')
        queryClient.invalidateQueries({ queryKey: ['asmr-progress'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
        void queryClient.invalidateQueries(trpc.asmrLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.asmrProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to reset progress: ${error.message}`)
      },
    })
  )
}

export const useBatchUpdateAsmrStatus = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.asmrLibrary.batchStatus.mutationOptions({
      onSuccess: (data) => {
        toast.success(`Status updated for ${data.updated ?? 0} items`)
        queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
        void queryClient.invalidateQueries(trpc.asmrLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.asmrProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to update statuses: ${error.message}`)
      },
    })
  )
}

export const useBatchRemoveAsmr = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.asmrLibrary.removeMany.mutationOptions({
      onSuccess: (data) => {
        const count = data.removed ?? 0
        toast.success(`Removed ${count} ${count === 1 ? 'item' : 'items'} from listening list`)
        queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
        void queryClient.invalidateQueries(trpc.asmrLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.asmrProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to remove: ${error.message}`)
      },
    })
  )
}

export const useBatchRemoveAsmrProgress = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.asmrProgress.removeMany.mutationOptions({
      onSuccess: (data) => {
        const count = data.removed ?? 0
        toast.success(`Reset progress for ${count} ${count === 1 ? 'item' : 'items'}`)
        queryClient.invalidateQueries({ queryKey: ['asmr-progress'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-continue-listening'] })
        queryClient.invalidateQueries({ queryKey: ['asmr-library'] })
        void queryClient.invalidateQueries(trpc.asmrLibrary.pathFilter())
        void queryClient.invalidateQueries(trpc.asmrProgress.pathFilter())
      },
      onError: (error) => {
        toast.error(`Failed to reset progress: ${error.message}`)
      },
    })
  )
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
      remove.mutate({ id: libId })
    } else {
      add.mutate({ ...item, thumbnail: item.thumbnail || '' })
    }
  }

  return { toggle, bookmarkedIds, pending: add.isPending || remove.isPending }
}

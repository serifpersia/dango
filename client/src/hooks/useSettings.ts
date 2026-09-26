import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { useTRPC } from '../lib/trpc'

export const useSetting = (key: string) => {
  const trpc = useTRPC()
  return useQuery({
    ...trpc.settings.getByKey.queryOptions({ key }),
    select: (data) => data.value as unknown,
  })
}

export const useUpdateSetting = () => {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useMutation(
    trpc.settings.set.mutationOptions({
      onSuccess: () => {
        toast.success('Setting updated!')
        void queryClient.invalidateQueries(trpc.settings.pathFilter())
        queryClient.invalidateQueries({ queryKey: ['settings'] })
      },
      onError: (error) => {
        toast.error(`Failed to update setting: ${error.message}`)
      },
    })
  )
}

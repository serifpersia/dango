import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { fetchApi } from '../lib/fetchApi'

const fetchSettings = async (key: string) => {
  const data = await fetchApi(`/api/settings?key=${key}`)
  return data.value
}

const updateSettings = async ({ key, value }: { key: string; value: unknown }) => {
  return fetchApi('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ key, value }),
  })
}

export const useSetting = (key: string) => {
  return useQuery<unknown>({
    queryKey: ['settings', key],
    queryFn: () => fetchSettings(key),
  })
}

export const useUpdateSetting = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: updateSettings,
    onSuccess: () => {
      toast.success('Setting updated!')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (error) => {
      toast.error(`Failed to update setting: ${error.message}`)
    },
  })
}

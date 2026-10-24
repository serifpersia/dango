import type { CurrentProfile } from '../../../server/src/profile.types'
import { fetchApi } from '../lib/fetchApi'
import { qk } from '../lib/queryKeys'

export const profileQuery = {
  queryKey: [qk.syncProfile],
  queryFn: (): Promise<CurrentProfile> => fetchApi('/api/profiles/current'),
  staleTime: 30000,
}

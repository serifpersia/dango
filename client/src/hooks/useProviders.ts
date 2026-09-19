import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchApi } from '../lib/fetchApi'
import {
  type BrowseCaps,
  type BrowseFacets,
  type ProviderOption,
  type SubType,
  type ProviderTier,
} from '../components/player/providers'

export interface ProviderMeta {
  id: string
  label: string
  version: string
  mature: boolean
  kind?: 'anime' | 'asmr' | 'tv'
  sub?: SubType
  tier?: ProviderTier
  browse?: BrowseCaps
  facets?: BrowseFacets
  modes?: ('sub' | 'dub')[]
  servers?: string[]
  enabledByDefault?: boolean
  loaded: boolean
  remote: boolean
  error?: string
}

const STALE_5_MIN = 5 * 60 * 1000

function toOption(m: ProviderMeta): ProviderOption {
  return {
    value: m.id,
    label: m.label,
    mature: m.mature,
    kind: m.kind,
    sub: m.sub,
    tier: m.tier,
    browse: m.browse,
    facets: m.facets,
    servers: m.servers,
  }
}

export const useProviders = () => {
  const query = useQuery({
    queryKey: ['providers'],
    queryFn: () => fetchApi('/api/providers') as Promise<ProviderMeta[]>,
    staleTime: STALE_5_MIN,
    retry: 1,
  })
  const server = Array.isArray(query.data) ? query.data : null
  const options: ProviderOption[] = useMemo(
    () => (server && server.length > 0 ? server.filter((p) => p.loaded).map(toOption) : []),
    [server]
  )
  return { ...query, options, isFallback: !server || server.length === 0 }
}

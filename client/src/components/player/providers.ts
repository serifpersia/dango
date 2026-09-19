export type ProviderId = string

export interface ProviderOption {
  value: string
  label: string
  mature: boolean
  kind?: 'anime' | 'asmr' | 'tv'
  sub?: SubType
  tier?: ProviderTier
  browse?: BrowseCaps
  facets?: BrowseFacets
  servers?: string[]
}

export interface BrowseCaps {
  genre?: boolean
  order?: boolean
  studio?: boolean
  sort?: boolean
  pageSize?: number
}

export interface BrowseFacets {
  genres?: string[]
  orders?: string[]
}

export type SubType = 'soft' | 'hard' | 'mixed'

export type ProviderTier = 'direct' | 'embed' | 'cookie'

export const SUB_LABEL: Record<SubType, string> = {
  soft: 'Softsub',
  hard: 'Hardsub',
  mixed: 'Mixed',
}

export const TIER_LABEL: Record<ProviderTier, string> = {
  direct: 'Direct',
  embed: 'Embed',
  cookie: 'Needs cookie',
}

export const TIER_ORDER: ProviderTier[] = ['direct', 'cookie', 'embed']

export const PROVIDER_OPTIONS: ProviderOption[] = []

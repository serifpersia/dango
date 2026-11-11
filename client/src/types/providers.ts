export type ProviderKind = 'anime' | 'manga' | 'asmr' | 'tv' | 'hentai' | 'adult'

export type SubType = 'soft' | 'hard' | 'mixed'

export type ProviderTier = 'direct' | 'embed' | 'cookie'

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
  sorts?: string[]
}

export interface ProviderAuthSpec {
  type: 'cookie' | 'browser_verify'
  label?: string
  siteUrl?: string
  cookieName?: string
  needsUa?: boolean
  instructions?: string
}

export interface ProviderOption {
  id: string
  label: string
  version: string
  mature: boolean
  kind?: ProviderKind
  sub?: SubType
  tier?: ProviderTier
  browse?: BrowseCaps
  facets?: BrowseFacets
  modes?: ('sub' | 'dub')[]
  servers?: string[]
  auth?: ProviderAuthSpec
  enabledByDefault?: boolean
  loaded: boolean
  remote: boolean
  error?: string
}

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

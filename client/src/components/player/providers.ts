export type ProviderId =
  | 'anilight'
  | 'kaa'
  | 'megaplay'
  | 'animepahe'
  | 'animeya'
  | '123anime'
  | 'wh'
  | 'hn'
  | 'ht'
  | 'op'
  | 'anibd'
  | 'animedunya'
  | 'animegg'
  | 'justanime'

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

export const PROVIDER_OPTIONS: {
  value: ProviderId
  label: string
  mature: boolean
  sub?: SubType
  tier?: ProviderTier
}[] = [
  { value: 'megaplay', label: 'MegaPlay', mature: false, sub: 'soft', tier: 'direct' },
  { value: 'justanime', label: 'JustAnime', mature: false, sub: 'mixed', tier: 'direct' },
  { value: 'anibd', label: 'AniBD', mature: false, sub: 'hard', tier: 'direct' },
  { value: 'animegg', label: 'AnimeGG', mature: false, sub: 'hard', tier: 'direct' },
  { value: 'kaa', label: 'KAA', mature: false, sub: 'soft', tier: 'direct' },
  { value: 'anilight', label: 'Anilight', mature: false, sub: 'mixed', tier: 'direct' },
  { value: 'animepahe', label: 'AnimePahe', mature: false, sub: 'hard', tier: 'cookie' },
  { value: 'animeya', label: 'Animeya', mature: false, sub: 'mixed', tier: 'embed' },
  { value: '123anime', label: '123Anime', mature: false, sub: 'hard', tier: 'embed' },
  { value: 'animedunya', label: 'AnimeDunya', mature: false, sub: 'soft', tier: 'embed' },
  { value: 'wh', label: 'WH', mature: true },
  { value: 'hn', label: 'HN', mature: true },
  { value: 'ht', label: 'HT', mature: true },
  { value: 'op', label: 'OP', mature: true },
]

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
  | 'anineko'

export const PROVIDER_OPTIONS: { value: ProviderId; label: string; mature: boolean }[] = [
  { value: 'megaplay', label: 'MegaPlay', mature: false },
  { value: 'kaa', label: 'KAA', mature: false },
  { value: 'anibd', label: 'AniBD', mature: false },
  { value: 'anilight', label: 'Anilight', mature: false },
  { value: 'animedunya', label: 'AnimeDunya', mature: false },
  { value: 'animegg', label: 'AnimeGG', mature: false },
  { value: 'animepahe', label: 'AnimePahe', mature: false },
  { value: 'animeya', label: 'Animeya', mature: false },
  { value: '123anime', label: '123Anime', mature: false },
  { value: 'anineko', label: 'AniNeko', mature: false },
  { value: 'wh', label: 'WH', mature: true },
  { value: 'hn', label: 'HN', mature: true },
  { value: 'ht', label: 'HT', mature: true },
  { value: 'op', label: 'OP', mature: true },
]

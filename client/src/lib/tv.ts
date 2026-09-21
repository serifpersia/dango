export type TvMediaType = 'movie' | 'tv'

export const normalizeTvMediaType = (raw: unknown): TvMediaType =>
  String(raw).toLowerCase() === 'movie' ? 'movie' : 'tv'

export const buildTvId = (mediaType: string, tmdbId: number | string): string =>
  `${normalizeTvMediaType(mediaType)}:${tmdbId}`

export const parseTvId = (id: string): { mediaType: TvMediaType; tmdbId: number } | null => {
  const sep = id.indexOf(':')
  if (sep < 0) return null
  const mediaType = normalizeTvMediaType(id.slice(0, sep))
  const tmdbId = Number(id.slice(sep + 1))
  if (!tmdbId) return null
  return { mediaType, tmdbId }
}

export const tvDetailPath = (mediaType: string, tmdbId: number | string): string => {
  const t = normalizeTvMediaType(mediaType)
  return `/tv/${tmdbId}?type=${t}`
}

export const tvWatchPath = (
  mediaType: string,
  tmdbId: number | string,
  season?: number,
  episode?: number
): string => {
  const params = new URLSearchParams()
  params.set('type', normalizeTvMediaType(mediaType))
  if (season !== undefined) params.set('s', String(season))
  if (episode !== undefined) params.set('e', String(episode))
  return `/tv/${tmdbId}/watch?${params.toString()}`
}

export const isTvAdult = (item: { adult?: boolean | number | null }): boolean =>
  item.adult === true || item.adult === 1

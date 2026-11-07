import type { Show } from '../../providers/provider.interface.js'
import type { OfflineEntry } from '../offline-db/index.js'
import { stripHtml } from '../html.js'
import type { AnilistMedia } from './types.js'

export function fromAnilistMedia(m: AnilistMedia): Show {
  const id = m.id < 0 ? `mal-${Math.abs(m.id)}` : m.id.toString()
  const title = m.title
  const name = title?.romaji || title?.english || title?.native || 'Unknown'

  const nextEpisodeAirDate =
    m.nextAiringEpisode?.airingAt != null
      ? new Date(m.nextAiringEpisode.airingAt * 1000).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        })
      : undefined

  return {
    _id: id,
    id,
    anilistId: m.id > 0 ? m.id : undefined,
    name,
    englishName: title?.english,
    nativeName: title?.native,
    names: {
      romaji: title?.romaji,
      english: title?.english,
      native: title?.native,
      synonyms: m.synonyms,
    },
    thumbnail: m.coverImage?.extraLarge || m.coverImage?.large || '',
    bannerImage: m.bannerImage || undefined,
    description: stripHtml(m.description),
    genres: (m.genres?.slice(0, 6) || []).map((g) => ({ name: g })),
    score: m.averageScore != null ? Number((m.averageScore / 10).toFixed(1)) : undefined,
    type: m.format,
    status: m.status,
    episodeCount: m.episodes ?? undefined,
    year: m.seasonYear ?? undefined,
    season: m.season
      ? { season: m.season, title: m.season, year: m.seasonYear ?? undefined }
      : undefined,
    nextAiring: m.nextAiringEpisode
      ? {
          episode: m.nextAiringEpisode.episode,
          timeUntilAiring: m.nextAiringEpisode.timeUntilAiring,
          airingAt: m.nextAiringEpisode.airingAt,
        }
      : undefined,
    nextEpisodeAirDate,
    studios: m.studios?.nodes?.map((n) => ({ name: n.name })),
    isAdult: m.isAdult,
    tags: m.tags?.map((t) => ({ name: t.name })),
    averageScore: m.averageScore ?? undefined,
    country: m.countryOfOrigin ?? undefined,
    airedStart: m.startDate
      ? {
          year: m.startDate.year ?? undefined,
          month: m.startDate.month ?? undefined,
          date: m.startDate.day ?? undefined,
        }
      : undefined,
    airedEnd: m.endDate
      ? {
          year: m.endDate.year ?? undefined,
          month: m.endDate.month ?? undefined,
          date: m.endDate.day ?? undefined,
        }
      : undefined,
  }
}

export function showFromOfflineEntry(entry: OfflineEntry): Show {
  const id = String(entry.anilistId)
  const name = entry.title || 'Unknown'
  let genres: { name: string }[] | undefined
  if (entry.genres) {
    try {
      const parsed: unknown = JSON.parse(entry.genres)
      if (Array.isArray(parsed)) {
        const names = parsed.filter((g): g is string => typeof g === 'string')
        if (names.length > 0) genres = names.map((g) => ({ name: g }))
      }
    } catch {
      // ignore
    }
  }
  return {
    _id: id,
    id,
    anilistId: entry.anilistId,
    name,
    names: { romaji: entry.title || undefined },
    thumbnail: entry.thumbnail || '',
    genres,
    type: entry.type,
  }
}

export function extractEpisodes(result: {
  episodes?: number | null
  status?: string
  nextAiringEpisode?: { episode: number; airingAt: number } | null
  airingSchedule?: { nodes?: { episode: number; airingAt: number }[] }
}): string[] {
  const { status, episodes: total, nextAiringEpisode, airingSchedule } = result

  if (status === 'FINISHED' && total) {
    return Array.from({ length: total }, (_, i) => (i + 1).toString())
  }

  if (status === 'RELEASING' && nextAiringEpisode?.episode) {
    const airedCount = nextAiringEpisode.episode - 1
    if (airedCount > 0) {
      return Array.from({ length: airedCount }, (_, i) => (i + 1).toString())
    }
  }

  if (airingSchedule?.nodes) {
    const now = Date.now() / 1000
    const aired = airingSchedule.nodes.filter((n) => n.airingAt < now)
    if (aired.length > 0) {
      const max = Math.max(...aired.map((n) => n.episode))
      return Array.from({ length: max }, (_, i) => (i + 1).toString())
    }
  }

  if (total) {
    return Array.from({ length: total }, (_, i) => (i + 1).toString())
  }

  return []
}

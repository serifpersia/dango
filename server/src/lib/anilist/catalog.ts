import { getShowMetaById } from './meta.js'
import { anilistUnavailable, isAnilistRateLimited } from './client.js'
import type { AnilistMedia } from './types.js'
import { mediaFields, mediaFieldsLight } from './queries.js'
import { getAdultLatest } from './fallback.js'
import type { Show } from '../../providers/provider.interface.js'
import logger from '../../logger.js'
import { findTmdbDefaultBackdrop } from '../tmdb.js'
import { getScheduleFromAniSchedule, withScheduleFields } from '../anischedule.js'
import { kitsuTrending, kitsuSeasonal, kitsuLatestReleases } from '../kitsu/index.js'
import { malSeasonal, malTop, malLatestReleases } from '../mal/index.js'
import { malCacheStore } from '../../repositories/mal-cache.repository.js'
import type { AnilistSort } from './types.js'
import { anilistRequest } from './client.js'
import { fromAnilistMedia } from './mappers.js'
import { tryFallback } from './fallback.js'
import { fetchAnilistMedia } from './queries.js'

export async function getLatestReleases(
  format: string = 'TV',
  page: number = 1,
  size: number = 12
): Promise<Show[]> {
  if (format === 'ADULT') {
    return getAdultLatest(page, size)
  }

  const now = Math.floor(Date.now() / 1000)
  const thirtyDaysAgo = now - 30 * 86400
  const needed = page * size
  const accumulated: Show[] = []
  const seen = new Set<number>()
  let anilistPage = 1
  let apiFailed = false

  while (accumulated.length < needed && anilistPage <= 10) {
    const query = `
      query ($page: Int, $perPage: Int, $airingAtGt: Int, $airingAtLt: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { hasNextPage }
          airingSchedules(sort: TIME_DESC, airingAt_lesser: $airingAtLt, airingAt_greater: $airingAtGt) {
            id episode airingAt
            media {
              ${mediaFieldsLight()}
            }
          }
        }
      }
    `

    const result = await anilistRequest<{
      Page: {
        pageInfo: { hasNextPage: boolean }
        airingSchedules?: {
          id: number
          episode: number
          airingAt: number
          media?: AnilistMedia
        }[]
      }
    }>(query, { page: anilistPage, perPage: 50, airingAtLt: now, airingAtGt: thirtyDaysAgo })

    if (!result?.data) {
      apiFailed = true
      break
    }

    const schedules = result?.data?.Page?.airingSchedules
    if (!schedules || schedules.length === 0) break

    for (const s of schedules) {
      if (!s.media) continue
      if (format !== 'ALL' && s.media.format !== format) continue
      if (s.media.isAdult) continue
      if (!s.media.id || seen.has(s.media.id)) continue
      seen.add(s.media.id)
      accumulated.push(fromAnilistMedia(s.media))
      if (accumulated.length >= needed) break
    }

    if (!result.data?.Page?.pageInfo?.hasNextPage) break
    anilistPage++
  }

  if (apiFailed) {
    return (
      await tryFallback(
        () => malLatestReleases(malCacheStore(), format, page, size),
        () => kitsuLatestReleases(format, page, size)
      )
    ).map(fromAnilistMedia)
  }

  const start = (page - 1) * size
  return accumulated.slice(start, start + size)
}

export async function getSeasonal(
  page: number = 1,
  size: number = 14,
  format?: string,
  full: boolean = false
): Promise<Show[]> {
  if (format === 'ADULT') {
    return getAdultLatest(page, size)
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const currentSeason =
    month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL'

  const query = `
    query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int, $format: MediaFormat) {
      Page(page: $page, perPage: $perPage) {
        pageInfo { hasNextPage total }
        media(season: $season, seasonYear: $seasonYear, type: ANIME, format: $format, isAdult: false, sort: [POPULARITY_DESC, SCORE_DESC]) {
          ${full ? mediaFields() : mediaFieldsLight()}
        }
      }
    }
  `

  const formatVar = format && format !== 'ALL' ? format.toUpperCase() : undefined
  const result = await anilistRequest<{
    Page: {
      pageInfo: { hasNextPage: boolean; total: number }
      media?: AnilistMedia[]
    }
  }>(query, { page, perPage: size, season: currentSeason, seasonYear: year, format: formatVar })

  if (!result?.data) {
    if (anilistUnavailable()) {
      return (
        await tryFallback(
          () => malSeasonal(malCacheStore(), currentSeason, year, format, page, size),
          () => kitsuSeasonal(currentSeason, year, format, page, size)
        )
      ).map(fromAnilistMedia)
    }
    return []
  }

  const media = result?.data?.Page?.media
  if (!media) return []

  return media.map(fromAnilistMedia)
}

export async function getTrending(
  page: number = 1,
  perPage: number = 20,
  sort: AnilistSort = 'TRENDING_DESC',
  status?: string
): Promise<Show[]> {
  const media = await fetchAnilistMedia(page, perPage, sort, status)
  if (media && media.length > 0) {
    return media.map(fromAnilistMedia)
  }

  if (anilistUnavailable()) {
    return (
      await tryFallback<AnilistMedia>(
        async () => {
          if (status === 'RELEASING') return malTop(malCacheStore(), 'airing', page)
          switch (sort) {
            case 'POPULARITY_DESC':
            case 'FAVOURITES_DESC':
              return malTop(malCacheStore(), 'bypopularity', page)
            case 'SCORE_DESC':
              return malTop(malCacheStore(), null, page)
            default:
              return malTop(malCacheStore(), 'airing', page)
          }
        },
        () => kitsuTrending(page, perPage)
      )
    ).map(fromAnilistMedia)
  }

  return []
}

export function pickSpotlightShows(shows: Show[]): Show[] {
  const withBanner: Show[] = []
  const rest: Show[] = []
  for (const show of shows) {
    if (withBanner.length >= 6 && rest.length >= 6) break
    if (show.bannerImage) {
      if (withBanner.length < 6) withBanner.push(show)
    } else if (rest.length < 6) {
      rest.push(show)
    }
  }
  const results = [...withBanner]
  for (const show of rest) {
    if (results.length >= 6) break
    if (show.thumbnail) results.push({ ...show, bannerImage: show.thumbnail })
  }
  return results
}

export async function getSpotlightBanners(page: number = 1, perPage: number = 20): Promise<Show[]> {
  const media = await fetchAnilistMedia(page, perPage)

  if (media) {
    return pickSpotlightShows(media.map(fromAnilistMedia))
  }

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const currentSeason =
    month <= 3 ? 'WINTER' : month <= 6 ? 'SPRING' : month <= 9 ? 'SUMMER' : 'FALL'
  const source = await tryFallback<AnilistMedia>(
    () => malTop(malCacheStore(), 'airing', 1),
    () => kitsuSeasonal(currentSeason, year, 'TV', 1, 20)
  )
  if (!source || source.length === 0) {
    return []
  }

  const withTimeout = <T>(p: Promise<T>, ms = 4000): Promise<T | null> =>
    Promise.race([
      p,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]) as Promise<T | null>

  const shuffled = [...source].sort(() => Math.random() - 0.5)
  const enriched = await Promise.allSettled(
    shuffled.slice(0, 10).map((m) =>
      withTimeout(
        findTmdbDefaultBackdrop({
          english: m.title?.english,
          romaji: m.title?.romaji,
          native: m.title?.native,
        })
      ).then((artwork) => ({ m, artwork }))
    )
  )
  const results: Show[] = []
  for (const r of enriched) {
    if (results.length >= 6) break
    if (r.status !== 'fulfilled' || !r.value?.artwork) continue
    const show = fromAnilistMedia(r.value.m)
    results.push({
      ...show,
      bannerImage: r.value.artwork.backdrop,
      description: show.description || r.value.artwork.overview || '',
    })
  }
  if (results.length < 6) {
    const seen = new Set(results.map((s) => s._id))
    for (const m of shuffled) {
      if (results.length >= 6) break
      const show = fromAnilistMedia(m)
      if (seen.has(show._id) || !show.thumbnail) continue
      seen.add(show._id)
      results.push({ ...show, bannerImage: show.thumbnail })
    }
  }
  return results
}

export async function getSchedule(date: Date, format?: string, adult = false): Promise<Show[]> {
  if (format === 'ADULT') {
    adult = true
    format = undefined
  }
  try {
    const result = await getScheduleFromAniSchedule(date, format, adult)
    const shows = result.entries
      .filter((e) => e.show)
      .map((e) => withScheduleFields(e.show as Show, e.episode, e.airingAt))

    if (result.missingMeta.length > 0) {
      for (const entry of result.missingMeta) {
        try {
          const meta = await getShowMetaById(String(entry.id))
          if (!meta) continue
          if (adult ? !meta.isAdult : meta.isAdult) continue
          shows.push(withScheduleFields(meta, entry.episode, entry.airingAt))
        } catch {
          // ignore
        }
      }
    }

    return shows
  } catch (e) {
    logger.warn({ err: e }, 'AniSchedule schedule failed, falling back to AniList')
    if (isAnilistRateLimited()) return []
    return getScheduleFromAnilist(date, format, adult)
  }
}

async function getScheduleFromAnilist(date: Date, format?: string, adult = false): Promise<Show[]> {
  const dayStart = Math.floor(date.getTime() / 1000)
  const dayEnd = dayStart + 86400

  const query = `
    query ($dayStart: Int, $dayEnd: Int) {
      Page(perPage: 50) {
        airingSchedules(airingAt_greater: $dayStart, airingAt_lesser: $dayEnd) {
          episode
          airingAt
          media {
            ${mediaFields()}
          }
        }
      }
    }
  `

  const result = await anilistRequest<{
    Page: {
      airingSchedules?: {
        episode: number
        airingAt: number
        media?: AnilistMedia
      }[]
    }
  }>(query, { dayStart, dayEnd })

  const schedules = result?.data?.Page?.airingSchedules
  if (!schedules || schedules.length === 0) return []

  const seen = new Set<number>()
  const results: Show[] = []
  const now = Math.floor(Date.now() / 1000)
  for (const entry of schedules) {
    const media = entry.media
    if (!media) continue
    if (format && format !== 'ALL' && media.format !== format) continue
    const isAdultShow = !!media.isAdult
    if (adult ? !isAdultShow : isAdultShow) continue
    const key = media.idMal ?? media.id
    if (seen.has(key)) continue
    seen.add(key)
    const show = fromAnilistMedia(media)
    show.episodeNumber = entry.episode
    show.aired = entry.airingAt <= now
    show.nextAiring = {
      episode: entry.episode,
      timeUntilAiring: entry.airingAt - now,
      airingAt: entry.airingAt,
    }
    show.nextEpisodeAirDate = new Date(entry.airingAt * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
    show.airTime = new Date(entry.airingAt * 1000).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    })
    results.push(show)
  }

  return results
}

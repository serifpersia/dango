import { mediaFields } from './queries.js'
import { hasPoster, parseMalId, type PosterExpectation } from './poster.js'
import { fromAnilistMedia, showFromOfflineEntry } from './mappers.js'
import { backfillKitsuShowFromMal } from './fallback.js'
import { anilistRequest, anilistUnavailable, isAnilistRateLimited } from './client.js'
import type { AnilistMedia } from './types.js'
import type { Show } from '../../providers/provider.interface.js'
import {
  kitsuMetaByAnilistId,
  kitsuMetaByMalId,
  kitsuEpisodes,
  kitsuBatchGetStatuses,
} from '../kitsu/index.js'
import { malAnimeDetail } from '../mal/index.js'
import { malCacheStore } from '../../repositories/mal-cache.repository.js'
import { offlineDb } from '../offline-db/index.js'
import { getCachedAnilist, setCachedAnilist } from './client.js'
import { getShowMetaByMalId } from './fallback.js'
import { withPosterBackfill } from './poster.js'
import { extractEpisodes } from './mappers.js'

export async function getShowMetaById(id: string): Promise<Show | null> {
  const malId = parseMalId(id)
  if (malId) return getShowMetaByMalId(malId)

  const numericId = parseInt(id)
  if (isNaN(numericId)) return null
  if (numericId < 0) return getShowMetaByMalId(Math.abs(numericId))

  const fields = mediaFields()
  const cacheKey = `meta:v2:${id}`
  const legacyCached = getCachedAnilist<Show>(`meta:${id}`)
  const cached = getCachedAnilist<Show>(cacheKey) ?? legacyCached
  if (cached && hasPoster(cached)) {
    setCachedAnilist(cacheKey, cached)
    return cached
  }
  const expected: PosterExpectation = { anilistId: numericId, titles: [] }

  const query = `query ($id: Int) { Media(id: $id, type: ANIME) { ${fields} } }`
  const queryMal = `query ($id: Int) { Media(idMal: $id, type: ANIME) { ${fields} } }`

  const byId = await anilistRequest<{ Media?: AnilistMedia | null }>(query, { id: numericId })
  if (byId?.data?.Media) {
    const show = fromAnilistMedia(byId.data.Media)
    return withPosterBackfill(show, cacheKey, expected)
  }

  const byMal = await anilistRequest<{ Media?: AnilistMedia | null }>(queryMal, { id: numericId })
  if (byMal?.data?.Media) {
    const show = fromAnilistMedia(byMal.data.Media)
    return withPosterBackfill(show, cacheKey, expected)
  }

  const apiFailed = !byId?.data && !byMal?.data
  if (apiFailed && anilistUnavailable()) {
    const offline = offlineDb.getByAnilistId(numericId) ?? offlineDb.getByMalId(numericId)
    const offlineShow = offline ? showFromOfflineEntry(offline) : null
    if (offlineShow && hasPoster(offlineShow)) {
      setCachedAnilist(cacheKey, offlineShow)
      return offlineShow
    }
    const fb = (await kitsuMetaByAnilistId(numericId)) ?? (await kitsuMetaByMalId(numericId))
    if (fb) {
      const show = fromAnilistMedia(fb)
      if (hasPoster(show)) {
        if (fb.idMal) {
          await backfillKitsuShowFromMal(show, fb.idMal)
        }
        setCachedAnilist(cacheKey, show)
        return show
      }
      return withPosterBackfill(show, cacheKey, expected)
    }
    if (offlineShow) {
      setCachedAnilist(cacheKey, offlineShow)
      return offlineShow
    }
  }

  if (cached && !hasPoster(cached)) {
    return withPosterBackfill(cached, cacheKey, expected)
  }

  return null
}

export async function batchGetShowStatuses(ids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  if (ids.length === 0) return result

  if (!isAnilistRateLimited()) {
    const BATCH = 10
    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH)
      const aliases = batch
        .map((_id, idx) => `a${idx}: Media(id: $id${idx}, type: ANIME) { id status }`)
        .join('\n')
      const variables: Record<string, unknown> = {}
      batch.forEach((id, idx) => {
        variables[`id${idx}`] = id
      })

      try {
        const resp = await anilistRequest<Record<string, { id: number; status: string }>>(
          `query (${batch.map((_, idx) => `$id${idx}: Int`).join(', ')}) { ${aliases} }`,
          variables
        )

        for (let j = 0; j < batch.length; j++) {
          const alias = `a${j}`
          const media = resp?.data?.[alias]
          if (media?.status) result.set(media.id, media.status)
        }
      } catch {
        break
      }
    }
    if (result.size === ids.length) return result
  }

  const missing = ids.filter((id) => !result.has(id))
  if (missing.length > 0) {
    try {
      const kitsuStatuses = await kitsuBatchGetStatuses(missing)
      for (const [id, status] of kitsuStatuses) {
        result.set(id, status)
      }
    } catch {
      // ignore
    }
  }

  return result
}

export async function batchGetShowsByIds(ids: string[]): Promise<Map<string, Show>> {
  const result = new Map<string, Show>()
  if (ids.length === 0) return result

  const entries = ids
    .map((id) => {
      const malId = parseMalId(id)
      const numericId = malId ?? parseInt(id, 10)
      return { id, malId, numericId }
    })
    .filter((entry) => Number.isFinite(entry.numericId) && entry.numericId > 0)

  const missing: typeof entries = []
  for (const entry of entries) {
    const cached = getCachedAnilist<Show>(`meta:v2:${entry.id}`)
    if (cached) result.set(entry.id, cached)
    else missing.push(entry)
  }
  if (missing.length === 0 || isAnilistRateLimited()) return result

  const fields = mediaFields()
  const BATCH = 6
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH)
    const aliases = batch
      .map((entry, idx) =>
        entry.malId != null
          ? `a${idx}: Media(idMal: ${entry.malId}, type: ANIME) { ${fields} }`
          : `a${idx}: Media(id: ${entry.numericId}, type: ANIME) { ${fields} }`
      )
      .join('\n')

    try {
      const resp = await anilistRequest<Record<string, AnilistMedia | null>>(`query { ${aliases} }`)
      batch.forEach((entry, idx) => {
        const media = resp?.data?.[`a${idx}`]
        if (media) {
          const show = fromAnilistMedia(media)
          result.set(entry.id, show)
          setCachedAnilist(`meta:v2:${entry.id}`, show)
        }
      })
    } catch {
      break
    }
  }

  return result
}

export async function getAnilistEpisodes(id: string): Promise<string[]> {
  const malId = parseMalId(id)
  if (malId) return getEpisodesByMalId(malId)

  const numericId = parseInt(id)
  if (isNaN(numericId)) return []
  if (numericId < 0) return getEpisodesByMalId(Math.abs(numericId))

  const cacheKey = `eps:${id}`
  const cached = getCachedAnilist<string[]>(cacheKey)
  if (cached) return cached

  const subquery = `id episodes status nextAiringEpisode { episode airingAt } airingSchedule(perPage: 100) { nodes { episode airingAt } }`
  const query = `query ($id: Int) { Media(id: $id, type: ANIME) { ${subquery} } }`
  const queryMal = `query ($id: Int) { Media(idMal: $id, type: ANIME) { ${subquery} } }`

  const byId = await anilistRequest<{
    Media?: {
      id: number
      episodes?: number | null
      status?: string
      nextAiringEpisode?: { episode: number; airingAt: number } | null
      airingSchedule?: { nodes?: { episode: number; airingAt: number }[] }
    } | null
  }>(query, { id: numericId })
  const media = byId?.data?.Media
  if (!media) {
    const byMal = await anilistRequest<{
      Media?: {
        id: number
        episodes?: number | null
        status?: string
        nextAiringEpisode?: { episode: number; airingAt: number } | null
        airingSchedule?: { nodes?: { episode: number; airingAt: number }[] }
      } | null
    }>(queryMal, { id: numericId })
    if (!byMal?.data) {
      if (anilistUnavailable()) {
        const episodes = await kitsuEpisodes(numericId, numericId)
        if (episodes.length > 0) {
          setCachedAnilist(cacheKey, episodes)
          return episodes
        }
      }
      return []
    }
    if (!byMal?.data?.Media) return []
    const episodes = extractEpisodes(byMal.data.Media)
    setCachedAnilist(cacheKey, episodes)
    return episodes
  }
  const episodes = extractEpisodes(media)
  setCachedAnilist(cacheKey, episodes)
  return episodes
}

async function getEpisodesByMalId(malId: number): Promise<string[]> {
  const cacheKey = `eps:-${malId}`
  const cached = getCachedAnilist<string[]>(cacheKey)
  if (cached) return cached

  try {
    const episodes = await kitsuEpisodes(0, malId)
    if (episodes.length > 0) {
      setCachedAnilist(cacheKey, episodes)
      return episodes
    }
  } catch {
    // ignore
  }

  try {
    const d = await malAnimeDetail(malCacheStore(), malId)
    const total = d.detail?.episodes
    if (total && total > 0 && total <= 2000) {
      const episodes = Array.from({ length: total }, (_, i) => (i + 1).toString())
      setCachedAnilist(cacheKey, episodes)
      return episodes
    }
  } catch {
    // ignore
  }

  return []
}

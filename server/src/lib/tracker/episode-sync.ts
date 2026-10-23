import type { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { dbGet } from '../../utils/db-utils.js'
import { offlineDb } from '../offline-db/index.js'
import { parseMalId } from '../anilist/index.js'
import { AniListTracker } from './anilist-tracker.js'

// Imported/manual watched markers have no playback duration. Partial playback must not count.
export async function completedProgress(db: DatabaseWrapper, showId: string): Promise<number> {
  const episodes = await WatchedEpisodesRepository.getByShow(db, showId)
  return Math.max(
    0,
    ...episodes
      .filter(
        (ep) =>
          /^\d+$/.test(ep.episodeNumber) &&
          Number(ep.episodeNumber) > 0 &&
          ((ep.duration === 0 && ep.currentTime === 0) ||
            (ep.duration > 0 && ep.currentTime >= ep.duration * 0.8))
      )
      .map((ep) => Number(ep.episodeNumber))
  )
}

export async function trackerIds(db: DatabaseWrapper, showId: string) {
  const meta = dbGet<{ anilistId?: number }>(db, 'SELECT anilistId FROM shows_meta WHERE id = ?', [
    showId,
  ])
  const anilistId =
    meta?.anilistId && meta.anilistId > 0
      ? meta.anilistId
      : /^\d+$/.test(showId)
        ? Number(showId)
        : undefined
  let malId =
    parseMalId(showId) ||
    Number((await SettingsRepository.getByKey(db, `tracker_mal_link_${showId}`))?.value) ||
    undefined
  if (!malId && anilistId) malId = offlineDb.getByAnilistId(anilistId)?.malId
  if (!malId && anilistId) {
    const data = await new AniListTracker().request<{ Media: { idMal?: number } | null }>(
      'query ($id: Int) { Media(id: $id, type: ANIME) { idMal } }',
      { id: anilistId },
      { retries: 0 }
    )
    malId = data.Media?.idMal
    if (malId) await SettingsRepository.upsert(db, `tracker_mal_link_${showId}`, String(malId))
  }
  return { anilistId, malId }
}

import type { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { completedProgress, trackerIds } from './episode-sync.js'
import { readTrackerSyncState } from './sync-state.js'
import { performWriteTransactionAsync } from '../../db/transaction.js'
import { AniListTracker } from './anilist-tracker.js'
import { MalTracker } from './mal-tracker.js'
import { clearRewatching, isRewatching, readRewatchMarkers, setRewatching } from './rewatch.js'
import { withTrackerWrite } from './tracker-activity.js'
import logger from '../../logger.js'

const TOKEN_KEY = 'tracker_anilist_token'
const MAL_TOKENS_KEY = 'tracker_mal_tokens'

const inFlight = new Map<string, number>()
const TTL_MS = 5 * 60 * 1000

function canFire(key: string): boolean {
  const now = Date.now()
  for (const [k, t] of inFlight) {
    if (now - t > TTL_MS) inFlight.delete(k)
  }
  if (inFlight.has(key)) return false
  inFlight.set(key, now)
  return true
}

export async function pushCompletedEpisode(
  db: DatabaseWrapper,
  showId: string,
  episodeNumber: string
): Promise<void> {
  if (!/^\d+$/.test(episodeNumber)) return
  const key = `${showId}:${episodeNumber}`
  if (!canFire(key)) return

  try {
    const { anilistId, malId } = await trackerIds(db, showId)
    const item = await WatchlistRepository.getById(db, showId)
    const meta = (await ShowsMetaRepository.getById(db, showId)) as {
      episodeCount?: number | null
    } | null
    const episodeCount = meta?.episodeCount ?? 0
    const completed = await completedProgress(db, showId)
    const epNum = Number(episodeNumber)

    const anilistToken = (await SettingsRepository.getByKey(db, TOKEN_KEY))?.value
    const malTokensRaw = (await SettingsRepository.getByKey(db, MAL_TOKENS_KEY))?.value
    const malConnected = !!malTokensRaw

    const activeRaw =
      (await SettingsRepository.getByKey(db, 'active_tracker_provider'))?.value || ''
    const activeProvider =
      activeRaw === 'mal' && malConnected
        ? 'mal'
        : activeRaw === 'anilist' && anilistToken
          ? 'anilist'
          : malConnected && !anilistToken
            ? 'mal'
            : 'anilist'
    const pushAnilist = activeProvider === 'anilist' && !!anilistToken && !!anilistId
    const pushMal = activeProvider === 'mal' && malConnected && !!malId

    const markers = await readRewatchMarkers(db)
    let isRewatch = isRewatching(markers, 'anilist', showId) || isRewatching(markers, 'mal', showId)

    if (!isRewatch && item?.status === 'Completed' && epNum === 1) {
      isRewatch = true
      if (pushAnilist) await setRewatching(db, 'anilist', showId)
      if (pushMal) await setRewatching(db, 'mal', showId)
      if (item) await WatchlistRepository.updateStatus(db, showId, 'Watching')
    }

    const finishing = isRewatch && episodeCount > 0 && epNum >= episodeCount

    if (finishing) {
      if (pushAnilist) await clearRewatching(db, 'anilist', showId)
      if (pushMal) await clearRewatching(db, 'mal', showId)
      if (item) await WatchlistRepository.updateStatus(db, showId, 'Completed')
    }

    const status = finishing
      ? 'Completed'
      : isRewatch
        ? 'Watching'
        : item?.status && item.status !== 'Planned'
          ? item.status
          : completed >= episodeCount && episodeCount > 0
            ? 'Completed'
            : 'Watching'

    const progress = isRewatch ? epNum : completed
    if (status === 'Completed' && item && item.status !== 'Completed') {
      await WatchlistRepository.updateStatus(db, showId, 'Completed')
    }

    if (pushAnilist) {
      try {
        await withTrackerWrite(db, 'anilist', async () => {
          const tracker = new AniListTracker(anilistToken)
          await tracker.updateMediaEntry({
            mediaId: anilistId,
            status: isRewatch ? 'Rewatching' : status,
            progress,
          })
        })
        const now = Math.floor(Date.now() / 1000)
        const state = await readTrackerSyncState(db, 'tracker_anilist_sync_state')
        state[showId] = { lastSyncedAt: now, remoteUpdatedAt: now }
        await performWriteTransactionAsync(db, async (tx) => {
          await SettingsRepository.upsert(tx, 'tracker_anilist_sync_state', JSON.stringify(state))
        })
      } catch (err) {
        logger.warn({ err, showId }, '[AutoSync] AniList push failed')
      }
    }

    if (pushMal) {
      try {
        const tracker = new MalTracker(db)
        await tracker.update(malId, progress, status === 'Completed' ? 'Completed' : 'Watching', {
          rewatching: isRewatch && !finishing,
        })
        const now = Math.floor(Date.now() / 1000)
        const state = await readTrackerSyncState(db, 'tracker_mal_sync_state')
        state[String(malId)] = { lastSyncedAt: now, remoteUpdatedAt: now }
        await performWriteTransactionAsync(db, async (tx) => {
          await SettingsRepository.upsert(tx, 'tracker_mal_sync_state', JSON.stringify(state))
        })
      } catch (err) {
        logger.warn({ err, showId }, '[AutoSync] MAL push failed')
      }
    }
  } catch (err) {
    logger.warn({ err, showId }, '[AutoSync] pushCompletedEpisode failed')
  }
}

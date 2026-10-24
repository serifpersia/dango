import type { DatabaseWrapper } from '../../db.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { completedProgress, trackerIds } from './episode-sync.js'
import { readTrackerSyncState, resolveStatus } from './sync-state.js'
import { performWriteTransactionAsync } from '../../db/transaction.js'
import { AniListTracker, ANILIST_TO_DANGO_STATUS } from './anilist-tracker.js'
import { MalTracker, MAL_TO_DANGO } from './mal-tracker.js'
import { clearRewatching, isRewatching, readRewatchMarkers, setRewatching } from './rewatch.js'
import { withTrackerWrite } from './tracker-activity.js'
import { withTrackerLock } from './sync-lock.js'
import logger from '../../logger.js'

export async function activeTracker(db: DatabaseWrapper) {
  const token = (await SettingsRepository.getByKey(db, 'tracker_anilist_token'))?.value
  const mal = (await SettingsRepository.getByKey(db, 'tracker_mal_tokens'))?.value
  const selected = (await SettingsRepository.getByKey(db, 'active_tracker_provider'))?.value
  const provider =
    selected === 'mal' && mal
      ? 'mal'
      : selected === 'anilist' && token
        ? 'anilist'
        : mal && !token
          ? 'mal'
          : token
            ? 'anilist'
            : undefined
  return { provider, token } as const
}

const pending = new WeakMap<DatabaseWrapper, Set<string>>()
const attempts = new WeakMap<DatabaseWrapper, Map<string, { done: boolean; at: number }>>()

export async function pushCompletedEpisode(
  db: DatabaseWrapper,
  showId: string,
  episodeNumber?: string
): Promise<void> {
  if (episodeNumber !== undefined && !/^[1-9]\d*$/.test(episodeNumber)) return
  let keys = pending.get(db)
  if (!keys) pending.set(db, (keys = new Set()))
  const key = `${showId}:${episodeNumber ?? 'status'}`
  let history = attempts.get(db)
  if (!history) attempts.set(db, (history = new Map()))
  if (episodeNumber) {
    const previous = history.get(key)
    if (keys.has(key) || (previous && Date.now() - previous.at < (previous.done ? 300000 : 30000)))
      return
    keys.add(key)
    if (history.size >= 1000) history.delete(history.keys().next().value!)
    history.set(key, { done: false, at: Date.now() })
  } else {
    for (const k of history.keys()) if (k.startsWith(`${showId}:`)) history.delete(k)
  }
  try {
    const { provider, token } = await activeTracker(db)
    if (!provider) return
    await withTrackerLock(db, provider, async () => {
      const { anilistId, malId } = await trackerIds(db, showId, provider)
      const mediaId = provider === 'mal' ? malId : anilistId
      if (!mediaId) return
      let item = await WatchlistRepository.getById(db, showId)
      if (!item && episodeNumber === undefined) return
      const anilist = new AniListTracker(token)
      const mal = new MalTracker(db)
      const a = provider === 'anilist' ? await anilist.getMediaEntry(mediaId) : null
      const m = provider === 'mal' ? await mal.getAnime(mediaId) : null
      if (provider === 'anilist' && !a) return
      const latest = await WatchlistRepository.getById(db, showId)
      const statusChanged = !!item && !!latest && item.status !== latest.status
      if (item && !latest) return
      item = latest
      const remote = a?.mediaListEntry ?? m?.my_list_status
      if (!item && !remote) return
      const remoteStatus = a?.mediaListEntry
        ? ANILIST_TO_DANGO_STATUS[a.mediaListEntry.status]
        : m?.my_list_status
          ? MAL_TO_DANGO[m.my_list_status.status]
          : undefined
      const remoteProgress =
        a?.mediaListEntry?.progress ?? m?.my_list_status?.num_episodes_watched ?? 0
      const remoteUpdated =
        a?.mediaListEntry?.updatedAt ??
        (Date.parse(m?.my_list_status?.updated_at ?? '') / 1000 || 0)
      const remoteRewatch =
        a?.mediaListEntry?.status === 'REPEATING' || m?.my_list_status?.is_rewatching === true
      if (!item) {
        await performWriteTransactionAsync(db, async (tx) => {
          await WatchlistRepository.upsert(tx, {
            id: showId,
            name: a?.title.english || a?.title.romaji || m?.title || showId,
            thumbnail: a?.coverImage?.large || m?.main_picture?.large || '',
            status: remoteStatus || 'Watching',
            nativeName: a?.title.native || '',
            englishName: a?.title.english || '',
            type: 'TV',
          })
        })
        item = await WatchlistRepository.getById(db, showId)
      }
      if (!item) return
      const stateKey = `tracker_${provider}_sync_state`
      const stateId = provider === 'mal' ? String(mediaId) : showId
      const state = await readTrackerSyncState(db, stateKey)
      const markers = await readRewatchMarkers(db)
      let rewatch = isRewatching(markers, provider, showId) || remoteRewatch
      const ep = Number(episodeNumber)
      if (episodeNumber && !rewatch && item.status === 'Completed' && ep === 1) rewatch = true
      if (episodeNumber === undefined || statusChanged) rewatch = false
      const meta = (await ShowsMetaRepository.getById(db, showId)) as
        { episodeCount?: number } | undefined
      const finishing = rewatch && !!meta?.episodeCount && ep >= meta.episodeCount
      let status =
        episodeNumber === undefined || statusChanged
          ? item.status
          : rewatch
            ? finishing
              ? 'Completed'
              : 'Watching'
            : remoteStatus
              ? resolveStatus(
                  item.status,
                  remoteStatus,
                  remoteUpdated,
                  state[stateId]?.lastSyncedAt || 0
                ).status
              : item.status
      if (episodeNumber && status === 'Planned') status = 'Watching'
      let progress = rewatch ? ep : Math.max(await completedProgress(db, showId), remoteProgress)
      let removed = false
      await performWriteTransactionAsync(db, async (tx) => {
        const current = await WatchlistRepository.getById(tx, showId)
        if (!current) {
          removed = true
          return
        }
        if (current.status !== item.status) {
          status = current.status
          rewatch = false
          progress = Math.max(await completedProgress(tx, showId), remoteProgress)
        }
        if (!rewatch && remoteProgress > 0) {
          for (let n = 1; n <= remoteProgress; n++) {
            await WatchedEpisodesRepository.markCompleted(tx, { showId, episodeNumber: String(n) })
          }
        }
        if (rewatch && !finishing) await setRewatching(tx, provider, showId)
        else await clearRewatching(tx, provider, showId)
        if (status !== item.status) await WatchlistRepository.updateStatus(tx, showId, status)
      })
      if (removed) return
      if (
        !remote ||
        progress !== remoteProgress ||
        status !== remoteStatus ||
        remoteRewatch !== (rewatch && !finishing)
      ) {
        if (provider === 'mal')
          await mal.update(mediaId, progress, status, { rewatching: rewatch && !finishing })
        else
          await withTrackerWrite(db, provider, () =>
            anilist.updateMediaEntry({
              mediaId,
              progress,
              status: rewatch && !finishing ? 'Rewatching' : status,
            })
          )
      }
      const now = Math.floor(Date.now() / 1000)
      state[stateId] = { lastSyncedAt: now, remoteUpdatedAt: now }
      await performWriteTransactionAsync(db, async (tx) => {
        await SettingsRepository.upsert(tx, stateKey, JSON.stringify(state))
      })
      if (episodeNumber) history.set(key, { done: true, at: Date.now() })
    })
  } catch (err) {
    logger.warn({ err, showId }, '[AutoSync] Entry sync failed; local progress kept')
  } finally {
    keys.delete(key)
  }
}

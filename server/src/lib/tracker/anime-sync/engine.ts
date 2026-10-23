export const TOKEN_KEY = 'tracker_anilist_token'
export const SYNC_STATE_KEY = 'tracker_anilist_sync_state'
export function toSqliteDatetime(unixSeconds?: number): string | undefined {
  if (!unixSeconds || unixSeconds <= 0) return undefined
  return new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

export function DANGO_STATUS_OR_FALLBACK(status: string): string | undefined {
  const known = ['Watching', 'Completed', 'On-Hold', 'Dropped', 'Planned']
  return known.includes(status) ? status : undefined
}
import { AniListTracker } from '../anilist-tracker.js'
import type { RemoteMediaEntry } from '../anilist-tracker.js'
import { WatchlistRepository } from '../../../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../../../repositories/watched-episodes.repository.js'
import { ShowsMetaRepository } from '../../../repositories/shows-meta.repository.js'
import { SettingsRepository } from '../../../repositories/settings.repository.js'
import { NotificationsRepository } from '../../../repositories/notifications.repository.js'
import { performWriteTransactionAsync } from '../../../db/transaction.js'
import { DatabaseWrapper } from '../../../db.js'
import { completedProgress } from '../episode-sync.js'
import { withTrackerLock } from '../sync-lock.js'
import logger from '../../../logger.js'
import { readTrackerSyncState, resolveStatus } from '../sync-state.js'
import type { TrackerSyncState, TrackerSyncStateEntry } from '../sync-state.js'
import { assertDeleteCap, collectMediaIds, pushRemoteChanges } from '../sync-engine.js'
import { clearRewatchForShow, isRewatching, readRewatchMarkers, setRewatching } from '../rewatch.js'

export interface SyncOptions {
  deletions?: boolean
}

export interface SyncSummary {
  pushed: number
  pulled: number
  merged: number
  unchanged: number
  errors: string[]
}

async function getWatchedCount(db: DatabaseWrapper, showId: string): Promise<number> {
  return completedProgress(db, showId)
}

export function syncAniList(db: DatabaseWrapper, opts: SyncOptions = {}): Promise<SyncSummary> {
  return withTrackerLock(db, 'anilist', () => syncAniListEntries(db, opts.deletions === true))
}

async function syncAniListEntries(
  db: DatabaseWrapper,
  includeDeletions: boolean
): Promise<SyncSummary> {
  const tokenRow = await SettingsRepository.getByKey(db, TOKEN_KEY)
  const token = tokenRow?.value
  if (!token) throw new Error('AniList is not connected. Please log in first.')

  const tracker = new AniListTracker(token)
  const viewer = await tracker.getViewer()
  const remoteEntries = await tracker.fetchUserAnimeList(viewer.id)

  const localItems = await WatchlistRepository.getAll(db)
  const rawSyncState = await readTrackerSyncState(db, SYNC_STATE_KEY)
  const syncState = localItems.length === 0 ? {} : rawSyncState
  const rewatchMarkers = await readRewatchMarkers(db)

  const remoteByMediaId = new Map<number, RemoteMediaEntry>()
  for (const entry of remoteEntries) remoteByMediaId.set(entry.mediaId, entry)

  const localByMediaId = new Map<number, (typeof localItems)[number]>()
  for (const item of localItems) {
    const meta = (await ShowsMetaRepository.getById(db, item.id)) as {
      anilistId?: number | null
    } | null
    const anilistId = meta?.anilistId
    if (anilistId == null || !Number.isFinite(anilistId) || String(anilistId) !== String(item.id)) {
      continue
    }
    if (!localByMediaId.has(anilistId)) {
      localByMediaId.set(anilistId, item)
    }
  }

  const allMediaIds = collectMediaIds(localByMediaId.keys(), remoteByMediaId.keys(), syncState)

  const summary: SyncSummary = { pushed: 0, pulled: 0, merged: 0, unchanged: 0, errors: [] }

  interface WatchlistUpsert {
    id: string
    name: string
    thumbnail: string
    status: string
    nativeName: string
    englishName: string
    type: string
  }
  const watchlistUpserts: WatchlistUpsert[] = []
  const metaUpserts: {
    id: string
    name?: string
    thumbnail?: string
    nativeName?: string
    englishName?: string
    episodeCount?: number
    anilistId?: number
    episodeDuration?: number
  }[] = []
  const watchedInserts: { showId: string; from: number; to: number; updatedAt?: number }[] = []
  const stateUpdates: Record<string, TrackerSyncStateEntry | undefined> = {}
  const watchlistDeletes: string[] = []
  const pushUpdates: { mediaId: number; status: string | undefined; progress: number }[] = []
  const remoteDeleteEntryIds: { showId: string; entryId: number }[] = []

  const now = Math.floor(Date.now() / 1000)

  for (const mediaId of allMediaIds) {
    const local = localByMediaId.get(mediaId)
    const remote = remoteByMediaId.get(mediaId)
    const showId = String(mediaId)

    try {
      if (local && !remote) {
        if (syncState[showId] && remoteEntries.length > 0) {
          if (!includeDeletions || isRewatching(rewatchMarkers, 'anilist', showId)) {
            summary.unchanged++
            continue
          }
          watchlistDeletes.push(showId)
          stateUpdates[showId] = undefined
          await clearRewatchForShow(db, showId)
          summary.pulled++
          continue
        }
        const watchedCount = await getWatchedCount(db, showId)
        pushUpdates.push({
          mediaId,
          status: DANGO_STATUS_OR_FALLBACK(local.status),
          progress: watchedCount,
        })
        stateUpdates[showId] = { lastSyncedAt: now, remoteUpdatedAt: now }
        summary.pushed++
        continue
      }

      if (!local && remote) {
        if (syncState[showId]) {
          if (!includeDeletions || remote.rewatching) {
            summary.unchanged++
            continue
          }
          if (remote.entryId) {
            remoteDeleteEntryIds.push({ showId, entryId: remote.entryId })
            stateUpdates[showId] = undefined
            await clearRewatchForShow(db, showId)
            summary.pushed++
            continue
          }
          stateUpdates[showId] = undefined
          await clearRewatchForShow(db, showId)
          summary.pushed++
          continue
        }
        if (remote.rewatching) await setRewatching(db, 'anilist', showId)
        logger.debug(
          { mediaId, remoteStatus: remote.status },
          '[AniList Sync] Remote only -> pulling to local'
        )
        const title = remote.title.english || remote.title.romaji || `Anime #${mediaId}`
        watchlistUpserts.push({
          id: showId,
          name: title,
          thumbnail: remote.coverImage ?? '',
          status: remote.status,
          nativeName: remote.title.native ?? '',
          englishName: remote.title.english ?? '',
          type: 'TV',
        })
        metaUpserts.push({
          id: showId,
          name: title,
          thumbnail: remote.coverImage,
          nativeName: remote.title.native,
          englishName: remote.title.english,
          episodeCount: remote.totalEpisodes,
          anilistId: mediaId,
          episodeDuration: remote.episodeDuration,
        })
        if (remote.progress > 0) {
          watchedInserts.push({ showId, from: 1, to: remote.progress, updatedAt: remote.updatedAt })
        }
        stateUpdates[showId] = { lastSyncedAt: now, remoteUpdatedAt: remote.updatedAt }
        summary.pulled++
        continue
      }

      if (!local && !remote && syncState[showId]) {
        stateUpdates[showId] = undefined
        await clearRewatchForShow(db, showId)
        continue
      }

      if (local && remote) {
        if (remote.rewatching) {
          await setRewatching(db, 'anilist', showId)
          stateUpdates[showId] = { lastSyncedAt: now, remoteUpdatedAt: remote.updatedAt }
          summary.unchanged++
          continue
        }
        if (isRewatching(rewatchMarkers, 'anilist', showId)) {
          stateUpdates[showId] = { lastSyncedAt: now, remoteUpdatedAt: remote.updatedAt }
          summary.unchanged++
          continue
        }
        const watchedCount = await getWatchedCount(db, showId)
        const localLastSync = syncState[showId]?.lastSyncedAt ?? 0
        const remoteUpdated = remote.updatedAt || 0

        const targetProgress = Math.max(watchedCount, remote.progress)
        const shouldPushProgress = watchedCount > remote.progress
        const shouldPullProgress = remote.progress > watchedCount

        const { status: targetStatus, pull: pullStatus } = resolveStatus(
          local.status,
          remote.status,
          remoteUpdated,
          localLastSync
        )

        const statusDiffers = remote.status !== local.status
        if (shouldPushProgress || (!pullStatus && statusDiffers)) {
          pushUpdates.push({
            mediaId,
            status: targetStatus,
            progress: targetProgress,
          })
          if (targetStatus !== local.status) {
            watchlistUpserts.push({
              id: showId,
              name: local.name,
              thumbnail: local.thumbnail ?? '',
              status: targetStatus,
              nativeName: local.nativeName ?? '',
              englishName: local.englishName ?? '',
              type: local.type ?? '',
            })
          }
          if (shouldPullProgress) {
            watchedInserts.push({
              showId,
              from: watchedCount + 1,
              to: targetProgress,
              updatedAt: remoteUpdated,
            })
          }
          stateUpdates[showId] = { lastSyncedAt: now, remoteUpdatedAt: now }
          summary.merged++
        } else if (pullStatus || shouldPullProgress) {
          if (targetStatus !== local.status) {
            watchlistUpserts.push({
              id: showId,
              name: local.name,
              thumbnail: local.thumbnail ?? '',
              status: targetStatus,
              nativeName: local.nativeName ?? '',
              englishName: local.englishName ?? '',
              type: local.type ?? '',
            })
          }
          if (shouldPullProgress) {
            watchedInserts.push({
              showId,
              from: watchedCount + 1,
              to: targetProgress,
              updatedAt: remoteUpdated,
            })
          }
          stateUpdates[showId] = { lastSyncedAt: now, remoteUpdatedAt: remoteUpdated }
          summary.merged++
        } else {
          summary.unchanged++
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err, mediaId }, '[AniList Sync] Entry failed')
      summary.errors.push(`${local?.name ?? `Media ${mediaId}`}: ${message}`)
    }
  }

  if (pushUpdates.length > 0 || remoteDeleteEntryIds.length > 0 || watchlistDeletes.length > 0) {
    assertDeleteCap({
      totalDeletes: watchlistDeletes.length + remoteDeleteEntryIds.length,
      localItemCount: localItems.length,
      fetched: remoteEntries.length,
      message: `AniList sync would delete ${watchlistDeletes.length + remoteDeleteEntryIds.length} shows but only ${remoteEntries.length} were fetched. Aborting to protect your library - if you really removed that many shows on AniList, delete them locally first and sync again.`,
    })
  }

  await pushRemoteChanges(db, tracker, pushUpdates, remoteDeleteEntryIds)

  if (
    watchlistUpserts.length > 0 ||
    metaUpserts.length > 0 ||
    watchedInserts.length > 0 ||
    watchlistDeletes.length > 0 ||
    Object.keys(stateUpdates).length > 0
  ) {
    await performWriteTransactionAsync(db, async (tx) => {
      for (const item of watchlistUpserts) {
        await WatchlistRepository.upsert(tx, item)
      }
      for (const meta of metaUpserts) {
        await ShowsMetaRepository.upsert(tx, meta)
      }
      for (const w of watchedInserts) {
        for (let ep = w.from; ep <= w.to; ep++) {
          await WatchedEpisodesRepository.markCompleted(tx, {
            showId: w.showId,
            episodeNumber: String(ep),
            watchedAt: toSqliteDatetime(w.updatedAt),
          })
        }
      }
      for (const id of watchlistDeletes) {
        await WatchlistRepository.delete(tx, id)
        await WatchedEpisodesRepository.deleteByShow(tx, id)
        await NotificationsRepository.deleteByShow(tx, id)
      }
      const mergedState: TrackerSyncState = { ...syncState }
      for (const [k, v] of Object.entries(stateUpdates)) {
        if (v === undefined) delete mergedState[k]
        else mergedState[k] = v
      }
      await SettingsRepository.upsert(tx, SYNC_STATE_KEY, JSON.stringify(mergedState))
    })
  }

  return summary
}

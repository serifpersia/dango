import { AniListTracker, RemoteMediaEntry } from './anilist-tracker.js'
import { WatchlistRepository } from '../../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../../repositories/watched-episodes.repository.js'
import { ShowsMetaRepository } from '../../repositories/shows-meta.repository.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { NotificationsRepository } from '../../repositories/notifications.repository.js'
import { performWriteTransaction } from '../../sync.js'
import { DatabaseWrapper } from '../../db.js'
import { dbGet } from '../../utils/db-utils.js'
import logger from '../../logger.js'
import { fetchMalUserList, type MalUserListEntry } from '../mal.js'
import { offlineDb } from '../offline-db.js'
import {
  getShowMetaById,
  getShowMetaByMalId,
  isAnilistRateLimited,
  searchAnilistByTitle,
} from '../anilist.js'
import { kitsuSearchAnime } from '../kitsu.js'

const TOKEN_KEY = 'tracker_anilist_token'
const USER_KEY = 'tracker_anilist_user'
const SYNC_STATE_KEY = 'tracker_anilist_sync_state'

export interface SyncSummary {
  pushed: number
  pulled: number
  merged: number
  unchanged: number
  errors: string[]
}

interface SyncStateEntry {
  lastSyncedAt: number
  remoteUpdatedAt: number
}

type SyncState = Record<string, SyncStateEntry>

async function readSyncState(db: DatabaseWrapper): Promise<SyncState> {
  const row = await SettingsRepository.getByKey(db, SYNC_STATE_KEY)
  if (!row?.value) return {}
  try {
    return JSON.parse(row.value) as SyncState
  } catch {
    return {}
  }
}

async function getWatchedCount(db: DatabaseWrapper, showId: string): Promise<number> {
  const row = await dbGet<{ total: number }>(
    db,
    'SELECT COUNT(DISTINCT episodeNumber) as total FROM watched_episodes WHERE showId = ?',
    [showId]
  )
  return row?.total ?? 0
}

function resolveStatus(
  localStatus: string,
  remoteStatus: string,
  remoteUpdated: number,
  localLastSync: number
): { status: string; pull: boolean } {
  if (remoteUpdated > localLastSync && remoteStatus !== localStatus) {
    return { status: remoteStatus, pull: true }
  }
  if (remoteStatus !== localStatus) {
    return { status: localStatus, pull: false }
  }
  return { status: localStatus, pull: false }
}

export async function syncAniList(db: DatabaseWrapper): Promise<SyncSummary> {
  const tokenRow = await SettingsRepository.getByKey(db, TOKEN_KEY)
  const token = tokenRow?.value
  if (!token) throw new Error('AniList is not connected. Please log in first.')

  const tracker = new AniListTracker(token)
  const viewer = await tracker.getViewer()
  const remoteEntries = await tracker.fetchUserAnimeList(viewer.id)

  const localItems = await WatchlistRepository.getAll(db)
  const syncState = await readSyncState(db)

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

  const allMediaIds = new Set<number>([
    ...localByMediaId.keys(),
    ...remoteByMediaId.keys(),
    ...Object.keys(syncState)
      .map((k) => Number.parseInt(k, 10))
      .filter((n) => Number.isFinite(n)),
  ])

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
  const stateUpdates: Record<string, SyncStateEntry | undefined> = {}
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
          watchlistDeletes.push(showId)
          stateUpdates[showId] = undefined
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
          if (remote.entryId) {
            remoteDeleteEntryIds.push({ showId, entryId: remote.entryId })
            stateUpdates[showId] = undefined
            summary.pushed++
            continue
          }
          stateUpdates[showId] = undefined
          summary.pushed++
          continue
        }
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
        continue
      }

      if (local && remote) {
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
    const deleteCap = Math.max(5, Math.ceil(localItems.length * 0.1))
    const totalDeletes = watchlistDeletes.length + remoteDeleteEntryIds.length
    if (totalDeletes > deleteCap) {
      throw new Error(
        `AniList sync would delete ${totalDeletes} shows but only ${remoteEntries.length} were fetched. Aborting to protect your library — if you really removed that many shows on AniList, delete them locally first and sync again.`
      )
    }
  }

  if (pushUpdates.length > 0) {
    const batchSize = 10
    for (let i = 0; i < pushUpdates.length; i += batchSize) {
      const batch = pushUpdates.slice(i, i + batchSize)
      await tracker.batchUpdateMediaEntries(batch)
    }
  }

  if (remoteDeleteEntryIds.length > 0) {
    const deleteBatch = remoteDeleteEntryIds.map((r) => r.entryId)
    const batchSize = 10
    for (let i = 0; i < deleteBatch.length; i += batchSize) {
      const batch = deleteBatch.slice(i, i + batchSize)
      await tracker.batchDeleteMediaEntries(batch)
    }
  }

  if (
    watchlistUpserts.length > 0 ||
    metaUpserts.length > 0 ||
    watchedInserts.length > 0 ||
    watchlistDeletes.length > 0 ||
    Object.keys(stateUpdates).length > 0
  ) {
    await performWriteTransaction(db, (tx) => {
      for (const item of watchlistUpserts) {
        WatchlistRepository.upsert(tx, item)
      }
      for (const meta of metaUpserts) {
        ShowsMetaRepository.upsert(tx, meta)
      }
      for (const w of watchedInserts) {
        for (let ep = w.from; ep <= w.to; ep++) {
          WatchedEpisodesRepository.insertIfMissing(tx, {
            showId: w.showId,
            episodeNumber: String(ep),
            watchedAt: toSqliteDatetime(w.updatedAt),
          })
        }
      }
      for (const id of watchlistDeletes) {
        WatchlistRepository.delete(tx, id)
        WatchedEpisodesRepository.deleteByShow(tx, id)
        NotificationsRepository.deleteByShow(tx, id)
      }
      const mergedState: SyncState = { ...syncState }
      for (const [k, v] of Object.entries(stateUpdates)) {
        if (v === undefined) delete mergedState[k]
        else mergedState[k] = v
      }
      SettingsRepository.upsert(tx, SYNC_STATE_KEY, JSON.stringify(mergedState))
    })
  }

  return summary
}

function toSqliteDatetime(unixSeconds?: number): string | undefined {
  if (!unixSeconds || unixSeconds <= 0) return undefined
  return new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

function DANGO_STATUS_OR_FALLBACK(status: string): string | undefined {
  const known = ['Watching', 'Completed', 'On-Hold', 'Dropped', 'Planned']
  return known.includes(status) ? status : undefined
}

export async function importFromUsername(
  db: DatabaseWrapper,
  username: string,
  erase = false
): Promise<number> {
  const tokenRow = await SettingsRepository.getByKey(db, TOKEN_KEY)
  const token = tokenRow?.value

  const tracker = new AniListTracker(token)
  let entries: RemoteMediaEntry[]

  if (token) {
    const viewer = await tracker.getViewer()
    entries = await tracker.fetchUserAnimeList(viewer.id)
  } else {
    entries = await tracker.fetchUserAnimeList(username)
  }

  if (entries.length === 0) return 0

  const now = Math.floor(Date.now() / 1000)
  const syncState = await readSyncState(db)

  await performWriteTransaction(db, (tx) => {
    if (erase) SettingsRepository.clearWatchlist(tx)
    for (const remote of entries) {
      const showId = String(remote.mediaId)
      const title = remote.title.english || remote.title.romaji || `Anime #${remote.mediaId}`

      WatchlistRepository.upsert(tx, {
        id: showId,
        name: title,
        thumbnail: remote.coverImage ?? '',
        status: remote.status,
        nativeName: remote.title.native ?? '',
        englishName: remote.title.english ?? '',
        type: 'TV',
      })

      ShowsMetaRepository.upsert(tx, {
        id: showId,
        name: title,
        thumbnail: remote.coverImage,
        nativeName: remote.title.native,
        englishName: remote.title.english,
        episodeCount: remote.totalEpisodes,
        anilistId: remote.mediaId,
      })

      if (remote.progress > 0) {
        for (let ep = 1; ep <= remote.progress; ep++) {
          WatchedEpisodesRepository.insertIfMissing(tx, {
            showId,
            episodeNumber: String(ep),
            watchedAt: toSqliteDatetime(remote.updatedAt),
          })
        }
      }

      syncState[showId] = { lastSyncedAt: now, remoteUpdatedAt: remote.updatedAt }
    }

    SettingsRepository.upsert(tx, SYNC_STATE_KEY, JSON.stringify(syncState))
  })

  return entries.length
}

function mapMalListStatus(status: number): string | null {
  switch (status) {
    case 1:
      return 'Watching'
    case 2:
      return 'Completed'
    case 3:
      return 'On-Hold'
    case 4:
      return 'Dropped'
    case 6:
      return 'Planned'
    default:
      return null
  }
}

async function searchTitleForMalImport(title: string): Promise<number | null> {
  const result = await searchAnilistByTitle(title)
  if (result) return result.id
  if (isAnilistRateLimited()) {
    try {
      const fb = await kitsuSearchAnime({ query: title, page: 1, perPage: 5 })
      if (fb.length > 0) return fb[0].id > 0 ? fb[0].id : null
    } catch {
      // ignore
    }
  }
  return null
}

interface MalShowToInsert {
  id: string
  name: string
  thumbnail?: string
  status: string
  nativeName?: string
  englishName?: string
  type?: string
}

export interface MalUsernameImportOptions {
  erase?: boolean
  useOfflineDb?: boolean
  skipFallback?: boolean
}

export async function importFromMalUsername(
  db: DatabaseWrapper,
  username: string,
  options: MalUsernameImportOptions = {}
): Promise<number> {
  const { erase = false, useOfflineDb = true, skipFallback = false } = options
  const entries = await fetchMalUserList(username)
  if (entries.length === 0) return 0

  const shows: MalShowToInsert[] = []
  const metas: { id: string; thumbnail?: string; type?: string; genres?: string }[] = []
  const watched: { showId: string; progress: number }[] = []
  const fallbackQueue: MalUserListEntry[] = []

  for (const entry of entries) {
    const status = mapMalListStatus(entry.status)
    if (!status) continue
    const offline = useOfflineDb ? offlineDb.getByMalId(entry.malId) : null
    if (offline) {
      const showId = String(offline.anilistId)
      const title = offline.title || entry.titleEnglish || entry.title || `MAL #${entry.malId}`
      shows.push({
        id: showId,
        name: title,
        thumbnail: offline.thumbnail ?? entry.imageUrl ?? undefined,
        status,
        englishName: entry.titleEnglish ?? undefined,
        type: offline.type ?? entry.type ?? undefined,
      })
      if (offline.thumbnail || offline.type || offline.genres) {
        metas.push({
          id: showId,
          thumbnail: offline.thumbnail,
          type: offline.type,
          genres: offline.genres,
        })
      }
      if (entry.watchedEpisodes > 0) watched.push({ showId, progress: entry.watchedEpisodes })
    } else {
      fallbackQueue.push(entry)
    }
  }

  if (fallbackQueue.length > 0 && !skipFallback) {
    const BATCH_SIZE = 5
    for (let i = 0; i < fallbackQueue.length; i += BATCH_SIZE) {
      const batch = fallbackQueue.slice(i, i + BATCH_SIZE)
      const results = await Promise.allSettled(
        batch.map(async (entry) => {
          const byMal = await getShowMetaByMalId(entry.malId).catch(() => null)
          if (byMal?.anilistId) return byMal
          const title = entry.titleEnglish || entry.title
          if (!title) return null
          const id = await searchTitleForMalImport(title)
          if (!id) return null
          return getShowMetaById(String(id)).catch(() => null)
        })
      )
      results.forEach((r, idx) => {
        if (r.status !== 'fulfilled' || !r.value) return
        const meta = r.value
        const entry = batch[idx]
        const status = mapMalListStatus(entry.status)
        if (!status) return
        const showId = meta.anilistId ? String(meta.anilistId) : meta._id
        const title =
          meta.names?.english ||
          meta.names?.romaji ||
          entry.titleEnglish ||
          entry.title ||
          `MAL #${entry.malId}`
        shows.push({
          id: showId,
          name: title,
          thumbnail: meta.thumbnail || entry.imageUrl || undefined,
          status,
          englishName: entry.titleEnglish ?? undefined,
          type: meta.type ?? entry.type ?? 'TV',
        })
        if (meta.thumbnail || meta.type) {
          metas.push({ id: showId, thumbnail: meta.thumbnail, type: meta.type })
        }
        if (entry.watchedEpisodes > 0) watched.push({ showId, progress: entry.watchedEpisodes })
      })
    }
  }

  if (shows.length > 0 || erase) {
    await performWriteTransaction(db, (tx) => {
      if (erase) SettingsRepository.clearWatchlist(tx)
      for (const show of shows) {
        WatchlistRepository.upsert(tx, {
          id: show.id,
          name: show.name,
          thumbnail: show.thumbnail ?? '',
          status: show.status,
          nativeName: '',
          englishName: show.englishName ?? '',
          type: show.type ?? 'TV',
        })
      }
      for (const meta of metas) {
        if (meta.thumbnail || meta.type || meta.genres) {
          ShowsMetaRepository.upsert(tx, {
            id: meta.id,
            thumbnail: meta.thumbnail,
            type: meta.type,
            genres: meta.genres,
          })
        }
      }
      for (const w of watched) {
        for (let ep = 1; ep <= w.progress; ep++) {
          WatchedEpisodesRepository.insertIfMissing(tx, {
            showId: w.showId,
            episodeNumber: String(ep),
          })
        }
      }
    })
  }

  return shows.length
}

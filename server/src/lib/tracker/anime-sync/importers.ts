import { SYNC_STATE_KEY, TOKEN_KEY, toSqliteDatetime } from './engine.js'
import { getShowMetaById, getShowMetaByMalId, isAnilistRateLimited } from '../../anilist/index.js'
import { fetchMalUserList, type MalUserListEntry } from '../../mal/index.js'
import { kitsuSearchAnime } from '../../kitsu/index.js'
import { offlineDb } from '../../offline-db/index.js'
import { AniListTracker } from '../anilist-tracker.js'
import type { RemoteMediaEntry } from '../anilist-tracker.js'
import { WatchlistRepository } from '../../../repositories/watchlist.repository.js'
import { WatchedEpisodesRepository } from '../../../repositories/watched-episodes.repository.js'
import { ShowsMetaRepository } from '../../../repositories/shows-meta.repository.js'
import { SettingsRepository } from '../../../repositories/settings.repository.js'
import { performWriteTransactionAsync } from '../../../db/transaction.js'
import { DatabaseWrapper } from '../../../db.js'
import { searchAnilistByTitle } from '../../anilist/index.js'
import { readTrackerSyncState } from '../sync-state.js'

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
  const syncState = await readTrackerSyncState(db, SYNC_STATE_KEY)

  await performWriteTransactionAsync(db, async (tx) => {
    if (erase) await SettingsRepository.clearWatchlist(tx)
    for (const remote of entries) {
      const showId = String(remote.mediaId)
      const title = remote.title.english || remote.title.romaji || `Anime #${remote.mediaId}`

      await WatchlistRepository.upsert(tx, {
        id: showId,
        name: title,
        thumbnail: remote.coverImage ?? '',
        status: remote.status,
        nativeName: remote.title.native ?? '',
        englishName: remote.title.english ?? '',
        type: 'TV',
      })

      await ShowsMetaRepository.upsert(tx, {
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
          await WatchedEpisodesRepository.markCompleted(tx, {
            showId,
            episodeNumber: String(ep),
            watchedAt: toSqliteDatetime(remote.updatedAt),
          })
        }
      }

      syncState[showId] = { lastSyncedAt: now, remoteUpdatedAt: remote.updatedAt }
    }

    await SettingsRepository.upsert(tx, SYNC_STATE_KEY, JSON.stringify(syncState))
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
    await performWriteTransactionAsync(db, async (tx) => {
      if (erase) await SettingsRepository.clearWatchlist(tx)
      for (const show of shows) {
        await WatchlistRepository.upsert(tx, {
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
          await ShowsMetaRepository.upsert(tx, {
            id: meta.id,
            thumbnail: meta.thumbnail,
            type: meta.type,
            genres: meta.genres,
          })
        }
      }
      for (const w of watched) {
        for (let ep = 1; ep <= w.progress; ep++) {
          await WatchedEpisodesRepository.markCompleted(tx, {
            showId: w.showId,
            episodeNumber: String(ep),
          })
        }
      }
    })
  }

  return shows.length
}

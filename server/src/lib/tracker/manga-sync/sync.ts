import {
  MANGA_PROVIDER,
  MANGA_SYNC_STATE_KEY,
  TOKEN_KEY,
  MAX_TITLE_LOOKUPS_PER_SYNC,
} from './resolve.js'
import { AniListTracker } from '../anilist-tracker.js'
import type { RemoteMangaEntry } from '../anilist-tracker.js'
import {
  MangaLibraryRepository,
  MangaProgressRepository,
} from '../../../repositories/manga.repository.js'
import { SettingsRepository } from '../../../repositories/settings.repository.js'
import {
  performMangaWriteTransactionAsync,
  performWriteTransactionAsync,
} from '../../../db/transaction.js'
import { DatabaseWrapper } from '../../../db.js'
import logger from '../../../logger.js'
import { searchAnilistMangaByTitle } from '../../anilist/index.js'
import { readTrackerSyncState, resolveStatus } from '../sync-state.js'
import type { TrackerSyncState, TrackerSyncStateEntry } from '../sync-state.js'
import { assertDeleteCap, collectMediaIds, pushRemoteChanges } from '../sync-engine.js'
import { clearRewatchForShow, isRewatching, readRewatchMarkers, setRewatching } from '../rewatch.js'
import {
  buildAnilistMangaId,
  buildSyntheticChapterId,
  getLocalChapterProgress,
  isExactTitleMatch,
  matchesStrippedBaseTitle,
  mangaStatusOrFallback,
  parseAnilistMangaId,
} from './resolve.js'
import type {
  MangaSyncDetail,
  MangaSyncDirection,
  MangaSyncOptions,
  MangaSyncResult,
  MangaSyncSummary,
} from './resolve.js'

export async function syncAniListManga(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  opts: MangaSyncOptions = {}
): Promise<MangaSyncResult> {
  const direction: MangaSyncDirection = opts.direction === 'pull-only' ? 'pull-only' : 'two-way'
  const pullOnly = direction === 'pull-only'
  const includeDeletions = opts.deletions === true && !pullOnly
  const tokenRow = await SettingsRepository.getByKey(db, TOKEN_KEY)
  const token = tokenRow?.value
  if (!token) throw new Error('AniList is not connected. Please log in first.')

  const tracker = new AniListTracker(token)
  const viewer = await tracker.getViewer()
  const remoteEntries = await tracker.fetchUserMangaList(viewer.id)

  const localItems = await MangaLibraryRepository.getAll(mangaDb)
  const rawSyncState = await readTrackerSyncState(db, MANGA_SYNC_STATE_KEY)
  const syncState = localItems.length === 0 ? {} : rawSyncState
  const rewatchMarkers = await readRewatchMarkers(db)

  const remoteByMediaId = new Map<number, RemoteMangaEntry>()
  for (const entry of remoteEntries) remoteByMediaId.set(entry.mediaId, entry)

  const localByMediaId = new Map<number, (typeof localItems)[number]>()
  const newLinks: { id: string; anilistId: number }[] = []
  const searchedMediaIds = new Set<number>()
  const preexistingLinks = new Map<
    number,
    { title: string; altTitle?: string | null; source: string | null }
  >()
  let titleLookups = 0
  let unresolved = 0
  const details: MangaSyncDetail[] = []
  const record = (detail: MangaSyncDetail) => {
    details.push(detail)
  }
  const pendingWarnings: string[] = []
  for (const item of localItems) {
    let anilistId = typeof item.anilistId === 'number' ? item.anilistId : null
    const fromColumn = anilistId != null
    const columnSource = fromColumn ? ((item.anilistIdSource as string | null) ?? null) : null
    let preexisting = fromColumn
    if (anilistId == null) {
      anilistId = parseAnilistMangaId(item.id)
      preexisting = anilistId != null
    }
    if (anilistId == null && item.provider && item.mangaId) {
      const fromParts =
        String(item.provider).toLowerCase() === MANGA_PROVIDER &&
        /^\d+$/.test(String(item.mangaId).trim())
          ? Number.parseInt(String(item.mangaId).trim(), 10)
          : null
      if (fromParts != null) {
        anilistId = fromParts
        preexisting = true
      }
    }
    if (anilistId == null) {
      if (titleLookups >= MAX_TITLE_LOOKUPS_PER_SYNC || !item.title) {
        unresolved++
        record({
          title: item.title || item.id,
          action: 'unresolved',
          note: 'No AniList link yet - skipped so nothing is written to the wrong series.',
        })
        continue
      }
      titleLookups++
      try {
        const match = await searchAnilistMangaByTitle(item.title)
        if (match && isExactTitleMatch(item, match.title)) {
          anilistId = match.id
          preexisting = false
          newLinks.push({ id: item.id, anilistId: match.id })
          searchedMediaIds.add(match.id)
        } else {
          unresolved++
          record({
            title: item.title,
            action: 'unresolved',
            note: match
              ? `Closest AniList match ("${match.title.english || match.title.romaji || match.title.native}") is not an exact title match - skipped so nothing is written to the wrong series.`
              : 'No AniList match found - skipped.',
          })
          continue
        }
      } catch (err) {
        logger.warn({ err, mangaId: item.id }, '[AniList Manga Sync] Title lookup failed')
        unresolved++
        record({
          title: item.title || item.id,
          action: 'unresolved',
          note: 'Title lookup failed - skipped.',
        })
        continue
      }
    }
    if (!localByMediaId.has(anilistId)) {
      localByMediaId.set(anilistId, item)
      if (preexisting && fromColumn && !searchedMediaIds.has(anilistId)) {
        preexistingLinks.set(anilistId, {
          title: item.title,
          altTitle: item.altTitle,
          source: columnSource,
        })
      }
    }
  }

  const suspectMediaIds = new Set<number>()
  for (const [mediaId, link] of preexistingLinks) {
    const remote = remoteByMediaId.get(mediaId)
    if (!remote) continue
    if (link.source === 'manual' || link.source === 'anilist' || link.source === 'search') continue
    if (isExactTitleMatch(link, remote.title)) continue
    if (matchesStrippedBaseTitle(link, remote.title)) continue
    suspectMediaIds.add(mediaId)
    const remoteLabel =
      remote.title.english || remote.title.romaji || remote.title.native || `Manga #${mediaId}`
    pendingWarnings.push(
      `"${link.title}" is linked to AniList #${mediaId} ("${remoteLabel}") by an older automatic match and the titles do not match - skipped in both directions to protect your AniList list.`
    )
    record({
      mediaId,
      title: link.title,
      action: 'suspicious',
      remoteStatus: remote.status,
      remoteProgress: remote.progress,
      note: `Linked AniList title is "${remoteLabel}".`,
    })
  }

  const allMediaIds = collectMediaIds(localByMediaId.keys(), remoteByMediaId.keys(), syncState)

  const summary: MangaSyncSummary = {
    pushed: 0,
    pulled: 0,
    merged: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
    warnings: pendingWarnings,
  }

  interface MangaLibraryUpsert {
    id: string
    provider: string
    mangaId: string
    title: string
    cover: string
    status: string
    anilistId: number
    anilistIdSource?: string
  }
  const libraryUpserts: MangaLibraryUpsert[] = []
  const progressPointers: { id: string; chapterNumber: string }[] = []
  const progressRows: {
    mangaId: string
    chapterId: string
    chapterNumber: string
    title: string
    cover: string
    provider: string
  }[] = []
  const libraryDeletes: string[] = []
  const stateUpdates: Record<string, TrackerSyncStateEntry | undefined> = {}
  const pushUpdates: { mediaId: number; status: string | undefined; progress: number }[] = []
  const remoteDeleteEntryIds: { showId: string; entryId: number }[] = []

  const now = Math.floor(Date.now() / 1000)

  for (const mediaId of allMediaIds) {
    if (suspectMediaIds.has(mediaId)) continue
    const local = localByMediaId.get(mediaId)
    const remote = remoteByMediaId.get(mediaId)
    const stateKey = String(mediaId)
    const localId = local?.id ?? buildAnilistMangaId(mediaId)

    try {
      if (local && !remote) {
        if (syncState[stateKey] && remoteEntries.length > 0) {
          if (pullOnly) {
            summary.skipped++
            record({
              mediaId,
              title: local.title,
              action: 'skipped',
              localStatus: local.status,
              note: 'Pull-only mode - local entry kept, nothing deleted.',
            })
            continue
          }
          if (!includeDeletions || isRewatching(rewatchMarkers, 'anilist', local.id)) {
            summary.skipped++
            record({
              mediaId,
              title: local.title,
              action: 'skipped',
              localStatus: local.status,
              note: 'Deletions only run from the manual sync.',
            })
            continue
          }
          await clearRewatchForShow(db, local.id)
          libraryDeletes.push(local.id)
          stateUpdates[stateKey] = undefined
          summary.pulled++
          record({ mediaId, title: local.title, action: 'delete-local', localStatus: local.status })
          continue
        }
        const chapters = await getLocalChapterProgress(mangaDb, local.id, local.lastChapterNumber)
        if (pullOnly) {
          summary.skipped++
          record({
            mediaId,
            title: local.title,
            action: 'skipped',
            localStatus: local.status,
            localChapters: chapters,
            note: 'Pull-only mode - not pushed to AniList.',
          })
          continue
        }
        const status = mangaStatusOrFallback(local.status)
        if (!status || (status === 'Planned' && chapters === 0)) {
          summary.skipped++
          record({
            mediaId,
            title: local.title,
            action: 'skipped',
            localStatus: local.status,
            localChapters: chapters,
            note: 'Bookmark with no chapters read - not pushed to AniList.',
          })
          continue
        }
        pushUpdates.push({
          mediaId,
          status,
          progress: chapters,
        })
        stateUpdates[stateKey] = { lastSyncedAt: now, remoteUpdatedAt: now }
        summary.pushed++
        record({
          mediaId,
          title: local.title,
          action: 'push',
          localStatus: local.status,
          localChapters: chapters,
        })
        continue
      }

      if (!local && remote) {
        if (syncState[stateKey] && !pullOnly) {
          if (
            !includeDeletions ||
            remote.rewatching ||
            isRewatching(rewatchMarkers, 'anilist', localId)
          ) {
            summary.skipped++
            record({
              mediaId,
              title: remote.title.english || remote.title.romaji || `Manga #${mediaId}`,
              action: 'skipped',
              remoteStatus: remote.status,
              note: 'Deletions only run from the manual sync.',
            })
            continue
          }
          await clearRewatchForShow(db, localId)
          if (remote.entryId) {
            remoteDeleteEntryIds.push({ showId: stateKey, entryId: remote.entryId })
            stateUpdates[stateKey] = undefined
            summary.pushed++
            record({
              mediaId,
              title: remote.title.english || remote.title.romaji || `Manga #${mediaId}`,
              action: 'delete-remote',
              remoteStatus: remote.status,
              remoteProgress: remote.progress,
              note: 'Removed locally after a previous sync - delete propagated to AniList.',
            })
            continue
          }
          stateUpdates[stateKey] = undefined
          summary.pushed++
          record({ mediaId, title: `Manga #${mediaId}`, action: 'delete-remote' })
          continue
        }
        if (remote.rewatching) await setRewatching(db, 'anilist', localId)
        logger.debug(
          { mediaId, remoteStatus: remote.status },
          '[AniList Manga Sync] Remote only -> pulling to local'
        )
        const title = remote.title.english || remote.title.romaji || `Manga #${mediaId}`
        libraryUpserts.push({
          id: buildAnilistMangaId(mediaId),
          provider: MANGA_PROVIDER,
          mangaId: String(mediaId),
          title,
          cover: remote.coverImage ?? '',
          status: remote.status,
          anilistId: mediaId,
          anilistIdSource: 'anilist',
        })
        if (remote.progress > 0) {
          progressPointers.push({
            id: buildAnilistMangaId(mediaId),
            chapterNumber: String(remote.progress),
          })
          progressRows.push({
            mangaId: buildAnilistMangaId(mediaId),
            chapterId: buildSyntheticChapterId(remote.progress),
            chapterNumber: String(remote.progress),
            title,
            cover: remote.coverImage ?? '',
            provider: MANGA_PROVIDER,
          })
        }
        stateUpdates[stateKey] = { lastSyncedAt: now, remoteUpdatedAt: remote.updatedAt }
        summary.pulled++
        record({
          mediaId,
          title,
          action: 'pull',
          remoteStatus: remote.status,
          remoteProgress: remote.progress,
        })
        continue
      }

      if (!local && !remote && syncState[stateKey]) {
        stateUpdates[stateKey] = undefined
        await clearRewatchForShow(db, localId)
        continue
      }

      if (local && remote) {
        if (remote.rewatching || isRewatching(rewatchMarkers, 'anilist', local.id)) {
          if (remote.rewatching) await setRewatching(db, 'anilist', local.id)
          stateUpdates[stateKey] = { lastSyncedAt: now, remoteUpdatedAt: remote.updatedAt }
          summary.skipped++
          record({
            mediaId,
            title: local.title,
            action: 'skipped',
            localStatus: local.status,
            remoteStatus: remote.status,
            note: 'Rewatching on AniList - left untouched.',
          })
          continue
        }
        const localChapters = await getLocalChapterProgress(
          mangaDb,
          local.id,
          local.lastChapterNumber
        )
        const localLastSync = syncState[stateKey]?.lastSyncedAt ?? 0
        const remoteUpdated = remote.updatedAt || 0

        const targetProgress = Math.max(localChapters, remote.progress)
        const shouldPushProgress = localChapters > remote.progress
        const shouldPullProgress = remote.progress > localChapters

        const { status: targetStatus, pull: pullStatus } = resolveStatus(
          local.status,
          remote.status,
          remoteUpdated,
          localLastSync
        )

        const statusDiffers = remote.status !== local.status
        if (pullOnly) {
          if (pullStatus || shouldPullProgress) {
            if (pullStatus && targetStatus !== local.status) {
              libraryUpserts.push({
                id: local.id,
                provider: local.provider,
                mangaId: local.mangaId,
                title: local.title,
                cover: local.cover ?? '',
                status: targetStatus,
                anilistId: mediaId,
              })
            }
            if (shouldPullProgress) {
              progressPointers.push({ id: localId, chapterNumber: String(targetProgress) })
              progressRows.push({
                mangaId: localId,
                chapterId: buildSyntheticChapterId(targetProgress),
                chapterNumber: String(targetProgress),
                title: local.title,
                cover: local.cover ?? '',
                provider: local.provider,
              })
            }
            stateUpdates[stateKey] = { lastSyncedAt: now, remoteUpdatedAt: remoteUpdated }
            summary.merged++
            record({
              mediaId,
              title: local.title,
              action: 'merge-pull',
              localStatus: local.status,
              remoteStatus: targetStatus,
              localChapters: localChapters,
              remoteProgress: targetProgress,
            })
          } else if (shouldPushProgress || statusDiffers) {
            summary.skipped++
            record({
              mediaId,
              title: local.title,
              action: 'skipped',
              localStatus: local.status,
              remoteStatus: remote.status,
              localChapters: localChapters,
              remoteProgress: remote.progress,
              note: 'Local is ahead - not pushed in pull-only mode.',
            })
          } else {
            summary.unchanged++
          }
        } else if (shouldPushProgress || (!pullStatus && statusDiffers)) {
          pushUpdates.push({
            mediaId,
            status: targetStatus,
            progress: targetProgress,
          })
          if (targetStatus !== local.status) {
            libraryUpserts.push({
              id: local.id,
              provider: local.provider,
              mangaId: local.mangaId,
              title: local.title,
              cover: local.cover ?? '',
              status: targetStatus,
              anilistId: mediaId,
            })
          }
          stateUpdates[stateKey] = { lastSyncedAt: now, remoteUpdatedAt: now }
          summary.merged++
          record({
            mediaId,
            title: local.title,
            action: 'merge-push',
            localStatus: targetStatus,
            remoteStatus: remote.status,
            localChapters: targetProgress,
            remoteProgress: remote.progress,
          })
        } else if (pullStatus || shouldPullProgress) {
          if (targetStatus !== local.status) {
            libraryUpserts.push({
              id: local.id,
              provider: local.provider,
              mangaId: local.mangaId,
              title: local.title,
              cover: local.cover ?? '',
              status: targetStatus,
              anilistId: mediaId,
            })
          }
          if (shouldPullProgress) {
            progressPointers.push({ id: localId, chapterNumber: String(targetProgress) })
            progressRows.push({
              mangaId: localId,
              chapterId: buildSyntheticChapterId(targetProgress),
              chapterNumber: String(targetProgress),
              title: local.title,
              cover: local.cover ?? '',
              provider: local.provider,
            })
          }
          stateUpdates[stateKey] = { lastSyncedAt: now, remoteUpdatedAt: remoteUpdated }
          summary.merged++
          record({
            mediaId,
            title: local.title,
            action: 'merge-pull',
            localStatus: local.status,
            remoteStatus: targetStatus,
            localChapters: localChapters,
            remoteProgress: targetProgress,
          })
        } else {
          summary.unchanged++
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err, mediaId }, '[AniList Manga Sync] Entry failed')
      summary.errors.push(`${local?.title ?? `Manga ${mediaId}`}: ${message}`)
      record({
        mediaId,
        title: local?.title ?? `Manga #${mediaId}`,
        action: 'error',
        note: message,
      })
    }
  }

  if (pushUpdates.length > 0 || remoteDeleteEntryIds.length > 0 || libraryDeletes.length > 0) {
    assertDeleteCap({
      totalDeletes: libraryDeletes.length + remoteDeleteEntryIds.length,
      localItemCount: localItems.length,
      fetched: remoteEntries.length,
      message: `AniList manga sync would delete ${libraryDeletes.length + remoteDeleteEntryIds.length} titles but only ${remoteEntries.length} were fetched. Aborting to protect your library - if you really removed that many manga on AniList, delete them locally first and sync again.`,
    })
  }

  await pushRemoteChanges(db, tracker, pushUpdates, remoteDeleteEntryIds)

  if (
    libraryUpserts.length > 0 ||
    progressPointers.length > 0 ||
    progressRows.length > 0 ||
    libraryDeletes.length > 0 ||
    newLinks.length > 0
  ) {
    await performMangaWriteTransactionAsync(mangaDb, async (tx) => {
      for (const item of libraryUpserts) {
        await MangaLibraryRepository.upsert(tx, item)
      }
      for (const link of newLinks) {
        await MangaLibraryRepository.setAnilistId(tx, link.id, link.anilistId, 'search')
      }
      for (const p of progressPointers) {
        await MangaLibraryRepository.setProgressPointer(tx, p.id, p.chapterNumber)
      }
      for (const p of progressRows) {
        await MangaProgressRepository.deleteSyntheticChapters(tx, p.mangaId, p.chapterId)
        await MangaProgressRepository.upsert(tx, {
          mangaId: p.mangaId,
          chapterId: p.chapterId,
          chapterNumber: p.chapterNumber,
          page: 0,
          pageCount: 0,
          title: p.title,
          cover: p.cover,
          provider: p.provider,
        })
      }
      for (const id of libraryDeletes) {
        await MangaLibraryRepository.delete(tx, id)
        await MangaProgressRepository.deleteByKey(tx, id)
      }
    })
  }

  if (Object.keys(stateUpdates).length > 0) {
    try {
      const mergedState: TrackerSyncState = { ...syncState }
      for (const [k, v] of Object.entries(stateUpdates)) {
        if (v === undefined) delete mergedState[k]
        else mergedState[k] = v
      }
      const snapshot = JSON.stringify(mergedState)
      await performWriteTransactionAsync(db, async (tx) => {
        await SettingsRepository.upsert(tx, MANGA_SYNC_STATE_KEY, snapshot)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err }, '[AniList Manga Sync] Failed to persist sync state')
      summary.errors.push(`Sync state was not saved, next sync will re-compare: ${message}`)
    }
  }

  if (unresolved > 0) {
    summary.errors.push(
      `${unresolved} local title${unresolved === 1 ? ' was' : 's were'} not matched to AniList (no link yet) - they were skipped and will be retried on the next sync.`
    )
  }

  return { summary, details }
}

import { AniListTracker, RemoteMangaEntry } from './anilist-tracker.js'
import {
  MangaLibraryRepository,
  MangaProgressRepository,
} from '../../repositories/manga.repository.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import { performMangaWriteTransaction, performWriteTransaction } from '../../sync.js'
import { DatabaseWrapper } from '../../db.js'
import logger from '../../logger.js'
import { searchAnilistMangaByTitle, getMangaMetaById, getMangaMetaByMalId } from '../anilist.js'
import { fetchMalMangaList, mapMalMangaStatusCode } from '../mal.js'

const TOKEN_KEY = 'tracker_anilist_token'
const MANGA_SYNC_STATE_KEY = 'tracker_anilist_manga_sync_state'

const MANGA_PROVIDER = 'anilist'
const MAX_TITLE_LOOKUPS_PER_SYNC = 25

export interface MangaSyncSummary {
  pushed: number
  pulled: number
  merged: number
  unchanged: number
  skipped: number
  errors: string[]
  warnings: string[]
}

export type MangaSyncAction =
  | 'push'
  | 'pull'
  | 'merge-push'
  | 'merge-pull'
  | 'delete-local'
  | 'delete-remote'
  | 'unchanged'
  | 'skipped'
  | 'unresolved'
  | 'suspicious'
  | 'error'

export interface MangaSyncDetail {
  mediaId?: number
  title: string
  action: MangaSyncAction
  localStatus?: string
  remoteStatus?: string
  localChapters?: number
  remoteProgress?: number
  note?: string
}

export interface MangaSyncResult {
  summary: MangaSyncSummary
  details: MangaSyncDetail[]
}

export type MangaSyncDirection = 'two-way' | 'pull-only'

export interface MangaSyncOptions {
  direction?: MangaSyncDirection
}

interface MangaSyncStateEntry {
  lastSyncedAt: number
  remoteUpdatedAt: number
}

type MangaSyncState = Record<string, MangaSyncStateEntry>

async function readMangaSyncState(db: DatabaseWrapper): Promise<MangaSyncState> {
  const row = await SettingsRepository.getByKey(db, MANGA_SYNC_STATE_KEY)
  if (!row?.value) return {}
  try {
    return JSON.parse(row.value) as MangaSyncState
  } catch {
    return {}
  }
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

function parseChapterProgress(value: unknown): number {
  if (value == null) return 0
  const matches = String(value).match(/(\d+(?:\.\d+)?)/g)
  if (!matches) return 0
  let best = 0
  for (const m of matches) {
    const n = Number(m)
    if (Number.isFinite(n)) best = Math.max(best, Math.floor(n))
  }
  return best
}

async function getLocalChapterProgress(
  mangaDb: DatabaseWrapper,
  libraryId: string,
  lastChapterNumber?: string | null
): Promise<number> {
  let best = parseChapterProgress(lastChapterNumber)
  try {
    const rows = await MangaProgressRepository.getByManga(mangaDb, libraryId)
    for (const row of rows ?? []) {
      best = Math.max(best, parseChapterProgress(row.chapterNumber))
    }
  } catch {
    // ignore
  }
  return best
}

function buildAnilistMangaId(mediaId: number): string {
  return `${MANGA_PROVIDER}:${mediaId}`
}

function buildSyntheticChapterId(progress: number): string {
  return `${MANGA_PROVIDER}:ch:${progress}`
}

function parseAnilistMangaId(id: string): number | null {
  const match = /^anilist:(\d+)$/i.exec(id.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 10)
  return Number.isFinite(n) ? n : null
}

function mangaStatusOrFallback(status: string): string | undefined {
  const known = ['Reading', 'Completed', 'On-Hold', 'Dropped', 'Planned']
  return known.includes(status) ? status : undefined
}

function normalizeTitle(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titlesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeTitle(a)
  return na.length > 0 && na === normalizeTitle(b)
}

function stripEditionSuffix(value: unknown): string {
  let s = String(value ?? '').trim()
  let prev = ''
  while (prev !== s) {
    prev = s
    s = s.replace(/\s*\([^()]*\)$/, '').trim()
  }
  return s
}

function matchesStrippedBaseTitle(
  item: { title?: string | null; altTitle?: string | null },
  match: { romaji?: string; english?: string; native?: string }
): boolean {
  const candidates = [item.title, item.altTitle]
    .filter((c): c is string => !!c)
    .map(stripEditionSuffix)
    .filter((c) => c.length > 0)
  const remotes = [match.romaji, match.english, match.native]
    .filter((r): r is string => !!r)
    .map(stripEditionSuffix)
    .filter((r) => r.length > 0)
  return candidates.some((c) => remotes.some((r) => titlesEqual(c, r)))
}

function isExactTitleMatch(
  item: { title?: string | null; altTitle?: string | null },
  match: { romaji?: string; english?: string; native?: string }
): boolean {
  const candidates = [item.title, item.altTitle]
  const remotes = [match.romaji, match.english, match.native]
  return candidates.some((c) => !!c && remotes.some((r) => !!r && titlesEqual(c, r)))
}

export async function syncAniListManga(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  opts: MangaSyncOptions = {}
): Promise<MangaSyncResult> {
  const direction: MangaSyncDirection = opts.direction === 'pull-only' ? 'pull-only' : 'two-way'
  const pullOnly = direction === 'pull-only'
  const tokenRow = await SettingsRepository.getByKey(db, TOKEN_KEY)
  const token = tokenRow?.value
  if (!token) throw new Error('AniList is not connected. Please log in first.')

  const tracker = new AniListTracker(token)
  const viewer = await tracker.getViewer()
  const remoteEntries = await tracker.fetchUserMangaList(viewer.id)

  const localItems = await MangaLibraryRepository.getAll(mangaDb)
  const syncState = await readMangaSyncState(db)

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
          note: 'No AniList link yet — skipped so nothing is written to the wrong series.',
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
              ? `Closest AniList match ("${match.title.english || match.title.romaji || match.title.native}") is not an exact title match — skipped so nothing is written to the wrong series.`
              : 'No AniList match found — skipped.',
          })
          continue
        }
      } catch (err) {
        logger.warn({ err, mangaId: item.id }, '[AniList Manga Sync] Title lookup failed')
        unresolved++
        record({
          title: item.title || item.id,
          action: 'unresolved',
          note: 'Title lookup failed — skipped.',
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
      `"${link.title}" is linked to AniList #${mediaId} ("${remoteLabel}") by an older automatic match and the titles do not match — skipped in both directions to protect your AniList list.`
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

  const allMediaIds = new Set<number>([
    ...localByMediaId.keys(),
    ...remoteByMediaId.keys(),
    ...Object.keys(syncState)
      .map((k) => Number.parseInt(k, 10))
      .filter((n) => Number.isFinite(n)),
  ])

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
  const stateUpdates: Record<string, MangaSyncStateEntry | undefined> = {}
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
              note: 'Pull-only mode — local entry kept, nothing deleted.',
            })
            continue
          }
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
            note: 'Pull-only mode — not pushed to AniList.',
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
            note: 'Bookmark with no chapters read — not pushed to AniList.',
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
              note: 'Removed locally after a previous sync — delete propagated to AniList.',
            })
            continue
          }
          stateUpdates[stateKey] = undefined
          summary.pushed++
          record({ mediaId, title: `Manga #${mediaId}`, action: 'delete-remote' })
          continue
        }
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
        continue
      }

      if (local && remote) {
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
              note: 'Local is ahead — not pushed in pull-only mode.',
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
    const deleteCap = Math.max(5, Math.ceil(localItems.length * 0.1))
    const totalDeletes = libraryDeletes.length + remoteDeleteEntryIds.length
    if (totalDeletes > deleteCap) {
      throw new Error(
        `AniList manga sync would delete ${totalDeletes} titles but only ${remoteEntries.length} were fetched. Aborting to protect your library — if you really removed that many manga on AniList, delete them locally first and sync again.`
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
    libraryUpserts.length > 0 ||
    progressPointers.length > 0 ||
    progressRows.length > 0 ||
    libraryDeletes.length > 0 ||
    newLinks.length > 0
  ) {
    await performMangaWriteTransaction(mangaDb, (tx) => {
      for (const item of libraryUpserts) {
        MangaLibraryRepository.upsert(tx, item)
      }
      for (const link of newLinks) {
        MangaLibraryRepository.setAnilistId(tx, link.id, link.anilistId, 'search')
      }
      for (const p of progressPointers) {
        MangaLibraryRepository.setProgressPointer(tx, p.id, p.chapterNumber)
      }
      for (const p of progressRows) {
        MangaProgressRepository.deleteSyntheticChapters(tx, p.mangaId, p.chapterId)
        MangaProgressRepository.upsert(tx, {
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
        MangaLibraryRepository.delete(tx, id)
        MangaProgressRepository.deleteByManga(tx, id)
      }
    })
  }

  if (Object.keys(stateUpdates).length > 0) {
    try {
      const mergedState: MangaSyncState = { ...syncState }
      for (const [k, v] of Object.entries(stateUpdates)) {
        if (v === undefined) delete mergedState[k]
        else mergedState[k] = v
      }
      const snapshot = JSON.stringify(mergedState)
      await performWriteTransaction(db, (tx) => {
        SettingsRepository.upsert(tx, MANGA_SYNC_STATE_KEY, snapshot)
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn({ err }, '[AniList Manga Sync] Failed to persist sync state')
      summary.errors.push(`Sync state was not saved, next sync will re-compare: ${message}`)
    }
  }

  if (unresolved > 0) {
    summary.errors.push(
      `${unresolved} local title${unresolved === 1 ? ' was' : 's were'} not matched to AniList (no link yet) — they were skipped and will be retried on the next sync.`
    )
  }

  return { summary, details }
}

export interface MangaImportItem {
  mediaId: number
  title: string
  cover?: string
  status: string
  progress: number
  remoteUpdatedAt?: number
}

function mangaImportStatusOrDefault(status: string): string {
  return mangaStatusOrFallback(status) ?? 'Planned'
}

export async function insertMangaImportEntries(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  items: MangaImportItem[],
  eraseAnilistRows: boolean
): Promise<number> {
  if (items.length === 0) return 0

  const now = Math.floor(Date.now() / 1000)
  const syncState = await readMangaSyncState(db)

  await performMangaWriteTransaction(mangaDb, (tx) => {
    if (eraseAnilistRows) {
      for (const row of MangaLibraryRepository.getAll(tx)) {
        if (String(row.provider).toLowerCase() === MANGA_PROVIDER) {
          MangaLibraryRepository.delete(tx, row.id)
          MangaProgressRepository.deleteByManga(tx, row.id)
        }
      }
    }
    for (const item of items) {
      const id = buildAnilistMangaId(item.mediaId)
      const status = mangaImportStatusOrDefault(item.status)
      MangaLibraryRepository.upsert(tx, {
        id,
        provider: MANGA_PROVIDER,
        mangaId: String(item.mediaId),
        title: item.title,
        cover: item.cover ?? '',
        status,
        anilistId: item.mediaId,
        anilistIdSource: 'anilist',
      })
      if (item.progress > 0) {
        MangaLibraryRepository.setProgressPointer(tx, id, String(item.progress))
        const chapterId = buildSyntheticChapterId(item.progress)
        MangaProgressRepository.deleteSyntheticChapters(tx, id, chapterId)
        MangaProgressRepository.upsert(tx, {
          mangaId: id,
          chapterId,
          chapterNumber: String(item.progress),
          page: 0,
          pageCount: 0,
          title: item.title,
          cover: item.cover ?? '',
          provider: MANGA_PROVIDER,
        })
      }
      syncState[String(item.mediaId)] = {
        lastSyncedAt: now,
        remoteUpdatedAt: item.remoteUpdatedAt ?? now,
      }
    }
  })

  try {
    const snapshot = JSON.stringify(syncState)
    await performWriteTransaction(db, (tx) => {
      SettingsRepository.upsert(tx, MANGA_SYNC_STATE_KEY, snapshot)
    })
  } catch (err) {
    logger.warn({ err }, '[AniList Manga Sync] Failed to persist sync state after import')
  }

  return items.length
}

export async function importFromUsernameManga(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  username: string,
  erase = false
): Promise<number> {
  const tokenRow = await SettingsRepository.getByKey(db, TOKEN_KEY)
  const token = tokenRow?.value

  const tracker = new AniListTracker(token)
  let entries: RemoteMangaEntry[]

  if (token) {
    const viewer = await tracker.getViewer()
    entries = await tracker.fetchUserMangaList(viewer.id)
  } else {
    entries = await tracker.fetchUserMangaList(username)
  }

  if (entries.length === 0) return 0

  return insertMangaImportEntries(
    db,
    mangaDb,
    entries.map((remote) => ({
      mediaId: remote.mediaId,
      title: remote.title.english || remote.title.romaji || `Manga #${remote.mediaId}`,
      cover: remote.coverImage,
      status: remote.status,
      progress: remote.progress,
      remoteUpdatedAt: remote.updatedAt,
    })),
    erase
  )
}

async function resolveMalMangaToAnilist(
  malId: number,
  title: string,
  titleEnglish: string | null
): Promise<{ id: number; title: string; cover?: string } | null> {
  if (malId) {
    try {
      const byMal = await getMangaMetaByMalId(malId)
      if (byMal) {
        return {
          id: byMal.id,
          title: byMal.title.english || byMal.title.romaji || title,
          cover: byMal.cover,
        }
      }
    } catch {
      // ignore
    }
  }
  const query = titleEnglish || title
  if (!query) return null
  try {
    const found = await searchAnilistMangaByTitle(query)
    if (!found) return null
    const meta = await getMangaMetaById(found.id)
    return {
      id: found.id,
      title:
        meta?.title.english ||
        meta?.title.romaji ||
        found.title.english ||
        found.title.romaji ||
        query,
      cover: meta?.cover,
    }
  } catch {
    return null
  }
}

export interface MalMangaImportResult {
  imported: number
  skipped: number
}

export async function importMangaFromMalUsername(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  username: string,
  erase = false
): Promise<MalMangaImportResult> {
  const entries = await fetchMalMangaList(username)
  if (entries.length === 0) return { imported: 0, skipped: 0 }

  const items: MangaImportItem[] = []
  let skipped = 0
  const BATCH_SIZE = 5
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((e) => resolveMalMangaToAnilist(e.malId, e.title, e.titleEnglish))
    )
    results.forEach((r, idx) => {
      const entry = batch[idx]
      const status = mapMalMangaStatusCode(entry.status)
      if (r.status !== 'fulfilled' || !r.value || !status) {
        skipped++
        return
      }
      items.push({
        mediaId: r.value.id,
        title: r.value.title,
        cover: r.value.cover,
        status,
        progress: Math.max(entry.chaptersRead, 0),
      })
    })
  }

  const imported = await insertMangaImportEntries(db, mangaDb, items, erase)
  return { imported, skipped }
}

export interface MalXmlMangaItem {
  malId: number
  title: string
  status: string
  chapters: number
}

export async function importMangaFromMalXmlItems(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  list: MalXmlMangaItem[],
  erase = false
): Promise<MalMangaImportResult> {
  if (list.length === 0) return { imported: 0, skipped: 0 }

  const items: MangaImportItem[] = []
  let skipped = 0
  const BATCH_SIZE = 5
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map((e) => resolveMalMangaToAnilist(e.malId, e.title, null))
    )
    results.forEach((r, idx) => {
      const entry = batch[idx]
      if (r.status !== 'fulfilled' || !r.value) {
        skipped++
        return
      }
      items.push({
        mediaId: r.value.id,
        title: r.value.title,
        cover: r.value.cover,
        status: entry.status,
        progress: Math.max(entry.chapters, 0),
      })
    })
  }

  const imported = await insertMangaImportEntries(db, mangaDb, items, erase)
  return { imported, skipped }
}

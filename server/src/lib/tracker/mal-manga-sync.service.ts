import type { DatabaseWrapper } from '../../db.js'
import logger from '../../logger.js'
import {
  performMangaWriteTransactionAsync,
  performWriteTransactionAsync,
} from '../../db/transaction.js'
import { SettingsRepository } from '../../repositories/settings.repository.js'
import {
  MangaLibraryRepository,
  MangaProgressRepository,
  type MangaLibraryRow,
} from '../../repositories/manga.repository.js'
import { MalTracker, MAL_MANGA_TO_DANGO, type MalManga } from './mal-tracker.js'
import { readTrackerSyncState, resolveStatus, type TrackerSyncState } from './sync-state.js'
import {
  getLocalChapterProgress,
  mangaStatusOrFallback,
  normalizeTitle,
  stripEditionSuffix,
  type MangaSyncSummary,
} from './manga-sync/resolve.js'
import { withTrackerLock } from './sync-lock.js'
import { assertDeleteCap } from './sync-engine.js'
import { clearRewatchForShow, isRewatching, readRewatchMarkers, setRewatching } from './rewatch.js'

const SYNC_STATE_KEY = 'tracker_mal_manga_sync_state'
const LINK_PREFIX = 'tracker_mal_manga_link_'
const MAX_TITLE_LOOKUPS = 25
const PROVIDER = 'mal'

export function parseMalMangaId(id: string): number | null {
  const match = /^mal:(\d+)$/i.exec(id.trim())
  if (!match) return null
  const value = Number.parseInt(match[1], 10)
  return Number.isFinite(value) ? value : null
}

function titleKeys(...titles: (string | null | undefined)[]): string[] {
  return titles
    .filter((t): t is string => !!t)
    .map((t) => normalizeTitle(stripEditionSuffix(t)))
    .filter(Boolean)
}

function remoteTitleKeys(candidate: MalManga): string[] {
  return titleKeys(
    candidate.title,
    candidate.alternative_titles?.en,
    candidate.alternative_titles?.ja,
    ...(candidate.alternative_titles?.synonyms ?? [])
  )
}

function matchesTitle(item: MangaLibraryRow, candidate: MalManga): boolean {
  const remote = new Set(remoteTitleKeys(candidate))
  return titleKeys(item.title, item.altTitle).some((key) => remote.has(key))
}

export interface MalMangaSyncOptions {
  deletions?: boolean
}

const syncing = new WeakMap<DatabaseWrapper, Promise<MangaSyncSummary>>()
export function syncMyAnimeListManga(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  opts: MalMangaSyncOptions = {}
): Promise<MangaSyncSummary> {
  const existing = syncing.get(db)
  if (existing) return existing
  const run = withTrackerLock(db, 'mal', () => sync(db, mangaDb, opts.deletions === true)).finally(
    () => syncing.delete(db)
  )
  syncing.set(db, run)
  return run
}

interface LibraryUpsert {
  id: string
  provider: string
  mangaId: string
  title: string
  cover: string
  status: string
}

async function sync(
  db: DatabaseWrapper,
  mangaDb: DatabaseWrapper,
  includeDeletions: boolean
): Promise<MangaSyncSummary> {
  const tracker = new MalTracker(db)
  const remote = await tracker.fetchMangaList()
  const local = await MangaLibraryRepository.getAll(mangaDb)
  const summary: MangaSyncSummary = {
    pushed: 0,
    pulled: 0,
    merged: 0,
    unchanged: 0,
    skipped: 0,
    errors: [],
    warnings: [],
  }
  const rawState = await readTrackerSyncState(db, SYNC_STATE_KEY)
  const state = local.length === 0 ? {} : rawState
  const nextState: TrackerSyncState = { ...state }
  const rewatchMarkers = await readRewatchMarkers(db)

  const malIdByLocal = new Map<string, number>()
  for (const item of local) {
    const parsed = parseMalMangaId(item.id)
    if (parsed) malIdByLocal.set(item.id, parsed)
  }
  for (const item of local) {
    if (malIdByLocal.has(item.id)) continue
    const stored = Number((await SettingsRepository.getByKey(db, LINK_PREFIX + item.id))?.value)
    if (stored > 0) malIdByLocal.set(item.id, stored)
  }

  // Match unlinked entries by exact title. The already-fetched list is free, so try it
  // first; only title with chapters read are worth a MAL search.
  const remoteNodes = remote.map((entry) => entry.node)
  const remoteByTitle = new Map<string, MalManga>()
  for (const node of remoteNodes)
    for (const key of remoteTitleKeys(node))
      if (!remoteByTitle.has(key)) remoteByTitle.set(key, node)
  const claimed = new Set(malIdByLocal.values())
  const linkWrites: { key: string; value: string }[] = []
  let lookups = 0
  for (const item of local) {
    if (malIdByLocal.has(item.id)) continue
    const existing = titleKeys(item.title, item.altTitle)
      .map((key) => remoteByTitle.get(key))
      .find((node): node is MalManga => !!node && !claimed.has(node.id))
    if (existing) {
      claimed.add(existing.id)
      malIdByLocal.set(item.id, existing.id)
      linkWrites.push({ key: LINK_PREFIX + item.id, value: String(existing.id) })
      continue
    }
    if (lookups >= MAX_TITLE_LOOKUPS) continue
    if ((await getLocalChapterProgress(mangaDb, item.id, item.lastChapterNumber)) === 0) continue
    lookups++
    try {
      const match = (await tracker.searchManga(item.title)).find(
        (candidate) => !claimed.has(candidate.id) && matchesTitle(item, candidate)
      )
      if (!match) {
        summary.warnings.push(`${item.title}: no exact MyAnimeList manga match; skipped.`)
        continue
      }
      claimed.add(match.id)
      malIdByLocal.set(item.id, match.id)
      linkWrites.push({ key: LINK_PREFIX + item.id, value: String(match.id) })
    } catch (err) {
      logger.warn({ err, title: item.title }, '[MyAnimeList Manga Sync] Title lookup failed')
      summary.warnings.push(`${item.title}: MyAnimeList search failed; skipped.`)
    }
  }

  const localByMalId = new Map<number, MangaLibraryRow>()
  for (const item of local) {
    const malId = malIdByLocal.get(item.id)
    if (malId) localByMalId.set(malId, item)
  }

  const libraryUpserts: LibraryUpsert[] = []
  const pointers: { id: string; chapterNumber: string }[] = []
  const progressRows: {
    mangaId: string
    chapterId: string
    chapterNumber: string
    page: number
    pageCount: number
    title: string
    cover: string
    provider: string
  }[] = []
  const libraryDeletes: string[] = []
  const remoteDeletes: { malId: number; libraryId: string }[] = []
  const now = Math.floor(Date.now() / 1000)

  for (const entry of remote) {
    const malId = entry.node.id
    const item = localByMalId.get(malId)
    localByMalId.delete(malId)
    const libraryId = item?.id ?? `mal:${malId}`
    const cover =
      item?.cover || entry.node.main_picture?.large || entry.node.main_picture?.medium || ''
    const remoteRewatching = entry.list_status.is_rewatching === true
    try {
      const remoteStatus = MAL_MANGA_TO_DANGO[entry.list_status.status]
      if (!remoteStatus) continue
      const remoteUpdated = Math.floor(Date.parse(entry.list_status.updated_at || '') / 1000) || 0
      if (!item && includeDeletions && state[String(malId)] && !remoteRewatching) {
        remoteDeletes.push({ malId, libraryId })
        delete nextState[String(malId)]
        summary.pushed++
        continue
      }
      if (remoteRewatching) await setRewatching(db, 'mal', libraryId)
      if (item && (remoteRewatching || isRewatching(rewatchMarkers, 'mal', item.id))) {
        nextState[String(malId)] = { lastSyncedAt: now, remoteUpdatedAt: remoteUpdated }
        summary.unchanged++
        continue
      }
      const localProgress = item
        ? await getLocalChapterProgress(mangaDb, item.id, item.lastChapterNumber)
        : 0
      const remoteProgress = entry.list_status.num_chapters_read || 0
      const progress = Math.max(localProgress, remoteProgress)
      const { status: resolvedStatus } = item
        ? resolveStatus(
            item.status,
            remoteStatus,
            remoteUpdated,
            state[String(malId)]?.lastSyncedAt || 0
          )
        : { status: remoteStatus }
      const status = mangaStatusOrFallback(resolvedStatus) ?? remoteStatus
      if (progress > remoteProgress || status !== remoteStatus)
        await tracker.updateManga(malId, progress, status)
      if (!item)
        libraryUpserts.push({
          id: libraryId,
          provider: PROVIDER,
          mangaId: String(malId),
          title: entry.node.title,
          cover,
          status,
        })
      else if (status !== item.status)
        libraryUpserts.push({
          id: libraryId,
          provider: item.provider,
          mangaId: item.mangaId,
          title: item.title,
          cover,
          status,
        })
      if (progress > localProgress) {
        pointers.push({ id: libraryId, chapterNumber: String(progress) })
        progressRows.push({
          mangaId: libraryId,
          chapterId: `mal:ch:${progress}`,
          chapterNumber: String(progress),
          page: 0,
          pageCount: 0,
          title: item?.title || entry.node.title,
          cover,
          provider: item?.provider || PROVIDER,
        })
      }
      nextState[String(malId)] = { lastSyncedAt: now, remoteUpdatedAt: remoteUpdated }
      if (!item) summary.pulled++
      else if (localProgress !== remoteProgress || status !== item.status) summary.merged++
      else summary.unchanged++
    } catch (err) {
      logger.warn({ err, malId }, '[MyAnimeList Manga Sync] Entry failed')
      summary.errors.push(`${entry.node.title}: Sync failed. Your local progress has been kept.`)
    }
  }

  for (const [malId, item] of localByMalId) {
    try {
      if (isRewatching(rewatchMarkers, 'mal', item.id)) {
        summary.unchanged++
        continue
      }
      if (includeDeletions && state[String(malId)]) {
        libraryDeletes.push(item.id)
        delete nextState[String(malId)]
        summary.pulled++
        continue
      }
      const status = mangaStatusOrFallback(item.status)
      if (!status) {
        summary.skipped++
        continue
      }
      await tracker.updateManga(
        malId,
        await getLocalChapterProgress(mangaDb, item.id, item.lastChapterNumber),
        status
      )
      summary.pushed++
    } catch {
      summary.errors.push(`${item.title}: Could not send to MyAnimeList.`)
    }
  }

  if (includeDeletions && libraryDeletes.length + remoteDeletes.length > 0) {
    assertDeleteCap({
      totalDeletes: libraryDeletes.length + remoteDeletes.length,
      localItemCount: local.length,
      fetched: remote.length,
      message: `MyAnimeList manga sync would delete ${libraryDeletes.length + remoteDeletes.length} titles but only ${remote.length} were fetched. Aborting to protect your library - if you really removed that many manga on MyAnimeList, delete them locally first and sync again.`,
    })
  }

  for (const deletion of remoteDeletes) {
    try {
      await tracker.deleteManga(deletion.malId)
      await clearRewatchForShow(db, deletion.libraryId)
    } catch {
      summary.errors.push(`Could not delete "${deletion.libraryId}" from MyAnimeList.`)
    }
  }

  if (
    libraryUpserts.length > 0 ||
    pointers.length > 0 ||
    progressRows.length > 0 ||
    libraryDeletes.length > 0 ||
    remoteDeletes.length > 0
  ) {
    await performMangaWriteTransactionAsync(mangaDb, async (tx) => {
      for (const item of libraryUpserts) await MangaLibraryRepository.upsert(tx, item)
      for (const pointer of pointers)
        await MangaLibraryRepository.setProgressPointer(tx, pointer.id, pointer.chapterNumber)
      for (const row of progressRows) {
        await MangaProgressRepository.deleteSyntheticChapters(
          tx,
          row.mangaId,
          row.chapterId,
          'mal:ch'
        )
        await MangaProgressRepository.upsert(tx, row)
      }
      for (const id of libraryDeletes) {
        await MangaLibraryRepository.delete(tx, id)
        await MangaProgressRepository.deleteByKey(tx, id)
      }
    })
    for (const id of libraryDeletes) await clearRewatchForShow(db, id)
  }

  if (linkWrites.length > 0 || JSON.stringify(nextState) !== JSON.stringify(state)) {
    await performWriteTransactionAsync(db, async (tx) => {
      for (const link of linkWrites) await SettingsRepository.upsert(tx, link.key, link.value)
      await SettingsRepository.upsert(tx, SYNC_STATE_KEY, JSON.stringify(nextState))
    })
  }
  return summary
}

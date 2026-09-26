import { XMLParser } from 'fast-xml-parser'
import { searchAnilistByTitle, isAnilistRateLimited, getShowMetaById } from './anilist.js'
import { kitsuSearchAnime } from './kitsu.js'
import { offlineDb } from './offline-db.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository.js'
import { performWriteTransaction } from '../sync.js'
import type { DatabaseWrapper } from '../db.js'
import logger from '../logger.js'

interface MalAnimeItem {
  series_title: string | string[]
  series_animedb_id?: string | string[]
  my_status: string | string[]
}

interface ShowToInsert {
  id: string
  name: string
  thumbnail?: string
  status: string
}

type ImportPhase = 'offline' | 'fallback' | 'done'

interface ActiveImportStatus {
  running: boolean
  current: number
  total: number
  phase: ImportPhase
  source: 'offline' | 'anilist' | 'kitsu' | null
  title?: string
  matchedTitle?: string | null
  status?: string
  found?: boolean
  imported?: number
  skipped?: number
}

let activeImportStatus: ActiveImportStatus = {
  running: false,
  current: 0,
  total: 0,
  phase: 'done',
  source: null,
}
let activeImportCancelled = false

export function getMalImportStatus(): ActiveImportStatus {
  return activeImportStatus
}

export function requestMalImportCancel(): { success: boolean; message: string } {
  if (!activeImportStatus.running) {
    return { success: true, message: 'No import running' }
  }
  activeImportCancelled = true
  return { success: true, message: 'Import cancellation requested' }
}

export type MalImportFlags = {
  erase: unknown
  useOfflineDb: unknown
  skipFallback: unknown
}

export type PreparedMalImport = {
  animeList: MalAnimeItem[]
  erase: unknown
  offlineEnabled: boolean
  shouldSkipFallback: boolean
}

export function prepareMalImport(
  fileBuffer: Buffer | undefined,
  flags: MalImportFlags
): { ok: true; import: PreparedMalImport } | { ok: false; status: 400 | 409; body: unknown } {
  if (activeImportStatus.running) {
    return { ok: false, status: 409, body: { error: 'An import is already in progress' } }
  }
  if (!fileBuffer) return { ok: false, status: 400, body: { error: 'No file' } }
  const { erase, useOfflineDb, skipFallback } = flags
  const offlineEnabled = useOfflineDb !== 'false' && useOfflineDb !== false && useOfflineDb !== '0'
  const shouldSkipFallback =
    skipFallback === 'true' || skipFallback === true || skipFallback === '1'

  let result: { myanimelist?: { anime?: MalAnimeItem[] } }
  try {
    result = malXmlParser.parse(fileBuffer.toString()) as {
      myanimelist?: { anime?: MalAnimeItem[] }
    }
  } catch {
    return { ok: false, status: 400, body: { error: 'Invalid XML' } }
  }

  const animeList: MalAnimeItem[] = result?.myanimelist?.anime || []

  if (animeList.length === 0) {
    return { ok: false, status: 400, body: { error: 'No anime found in XML' } }
  }

  activeImportCancelled = false
  activeImportStatus = {
    running: true,
    current: 0,
    total: animeList.length,
    phase: 'offline',
    source: 'offline',
  }
  return { ok: true, import: { animeList, erase, offlineEnabled, shouldSkipFallback } }
}

export async function executeMalImport(
  db: DatabaseWrapper,
  prepared: PreparedMalImport,
  sendEvent: (event: string, data: unknown) => void
): Promise<void> {
  const { animeList, erase, offlineEnabled, shouldSkipFallback } = prepared
  const total = animeList.length

  let skippedCount = 0
  const offlineShows: ShowToInsert[] = []
  const offlineMeta: { id: string; thumbnail?: string; type?: string; genres?: string }[] = []
  const fallbackQueue: MalAnimeItem[] = []

  for (const item of animeList) {
    const malTitle = xmlText(item.series_title)
    const status = mapMalStatus(xmlText(item.my_status))
    let matched = false
    if (offlineEnabled) {
      const malId = parseInt(xmlText(item.series_animedb_id), 10)
      if (malId && !Number.isNaN(malId)) {
        const entry = offlineDb.getByMalId(malId)
        if (entry) {
          matched = true
          const showId = String(entry.anilistId)
          const title = entry.title || malTitle
          offlineShows.push({ id: showId, name: title, thumbnail: entry.thumbnail, status })
          if (entry.thumbnail || entry.type || entry.genres) {
            offlineMeta.push({
              id: showId,
              thumbnail: entry.thumbnail,
              type: entry.type,
              genres: entry.genres,
            })
          }
          activeImportStatus = {
            running: true,
            current: offlineShows.length,
            total,
            phase: 'offline',
            source: 'offline',
            title: malTitle,
            matchedTitle: title,
            status,
            found: true,
            imported: offlineShows.length,
          }
          sendEvent('progress', {
            current: offlineShows.length,
            total,
            title: malTitle,
            matchedTitle: title,
            status,
            source: 'offline',
            found: true,
          })
        }
      }
    }
    if (!matched) fallbackQueue.push(item)
  }

  if (offlineShows.length > 0 || erase) {
    try {
      await performWriteTransaction(db, (tx) => {
        if (erase) SettingsRepository.clearWatchlist(tx)
        SettingsRepository.upsertWatchlistBatch(tx, offlineShows)
        for (const meta of offlineMeta) {
          if (meta.thumbnail || meta.type || meta.genres) {
            ShowsMetaRepository.upsert(tx, {
              id: meta.id,
              thumbnail: meta.thumbnail,
              type: meta.type,
              genres: meta.genres,
            })
          }
        }
      })
    } catch (dbErr) {
      logger.error({ err: dbErr }, 'Failed to commit offline import matches')
    }
  }

  let fallbackImported = 0
  if (shouldSkipFallback || activeImportCancelled) {
    skippedCount += fallbackQueue.length
  } else if (fallbackQueue.length > 0) {
    activeImportStatus = { ...activeImportStatus, phase: 'fallback', source: null }
    const BATCH_SIZE = 5
    for (let i = 0; i < fallbackQueue.length; i += BATCH_SIZE) {
      if (activeImportCancelled) {
        skippedCount += fallbackQueue.length - i
        break
      }
      const batch = fallbackQueue.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.allSettled(
        batch.map((item) => searchByTitleForMal(xmlText(item.series_title)))
      )
      const batchShows: ShowToInsert[] = []
      const batchMeta: { id: string; thumbnail?: string; type?: string }[] = []
      const metaPromises: Promise<void>[] = []

      batchResults.forEach((r, idx) => {
        const malTitle = xmlText(batch[idx].series_title)
        const status = mapMalStatus(xmlText(batch[idx].my_status))
        const current = offlineShows.length + fallbackImported + idx + 1
        if (r.status === 'fulfilled' && r.value) {
          const show = r.value
          const title = show.title?.english || show.title?.romaji || malTitle
          batchShows.push({ id: String(show.id), name: title, status })
          activeImportStatus = {
            running: true,
            current,
            total,
            phase: 'fallback',
            source: show.source,
            title: malTitle,
            matchedTitle: title,
            status,
            found: true,
            imported: offlineShows.length + fallbackImported + 1,
          }
          sendEvent('progress', {
            current,
            total,
            title: malTitle,
            matchedTitle: title,
            status,
            source: show.source,
            found: true,
          })
          metaPromises.push(
            getShowMetaById(String(show.id))
              .then((meta) => {
                if (meta) {
                  batchMeta.push({
                    id: String(show.id),
                    thumbnail: meta.thumbnail || undefined,
                    type: meta.type || undefined,
                  })
                }
              })
              .catch(() => {})
          )
        } else {
          skippedCount++
          activeImportStatus = {
            running: true,
            current,
            total,
            phase: 'fallback',
            source: null,
            title: malTitle,
            matchedTitle: null,
            status,
            found: false,
            imported: offlineShows.length + fallbackImported,
          }
          sendEvent('progress', {
            current,
            total,
            title: malTitle,
            matchedTitle: null,
            status,
            source: null,
            found: false,
          })
        }
      })

      await Promise.allSettled(metaPromises)
      if (batchShows.length > 0) {
        try {
          await performWriteTransaction(db, (tx) => {
            SettingsRepository.upsertWatchlistBatch(tx, batchShows)
            for (const meta of batchMeta) {
              if (meta.thumbnail) {
                ShowsMetaRepository.upsert(tx, {
                  id: meta.id,
                  thumbnail: meta.thumbnail,
                  type: meta.type,
                })
              }
            }
          })
          fallbackImported += batchShows.length
        } catch (dbErr) {
          logger.error({ err: dbErr }, 'Failed to commit fallback import batch')
          skippedCount += batchShows.length
        }
      }
    }
  }

  const imported = offlineShows.length + fallbackImported
  activeImportStatus = {
    running: false,
    current: total,
    total,
    phase: 'done',
    source: null,
    imported,
    skipped: skippedCount,
  }
  sendEvent('complete', { imported, skipped: skippedCount })
}

type XmlVal = string | string[] | undefined

function xmlText(value: XmlVal): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return String(value ?? '')
}

function mapMalStatus(malStatus: string): string {
  switch (malStatus) {
    case 'Plan to Watch':
      return 'Planned'
    case 'On Hold':
      return 'On-Hold'
    default:
      return malStatus
  }
}

const malXmlParser = new XMLParser({
  isArray: (name) => name === 'anime',
  parseTagValue: false,
  trimValues: true,
})

async function searchByTitleForMal(title: string): Promise<{
  id: number
  title: { romaji?: string; english?: string; native?: string }
  source: 'anilist' | 'kitsu'
} | null> {
  const result = await searchAnilistByTitle(title)
  if (result) return { ...result, source: 'anilist' }

  if (isAnilistRateLimited()) {
    logger.debug({ title }, 'AniList rate limited, trying Kitsu fallback for MAL import')
    const fb = await kitsuSearchAnime({ query: title, page: 1, perPage: 5 })
    if (fb.length > 0) {
      const lowerTitle = title.toLowerCase()
      const exactMatch = fb.find(
        (m) =>
          m.title?.romaji?.toLowerCase() === lowerTitle ||
          m.title?.english?.toLowerCase() === lowerTitle
      )
      const best = exactMatch || fb[0]
      if (best.id > 0) {
        return { id: best.id, title: best.title ?? {}, source: 'kitsu' }
      }
    }
  }

  return null
}

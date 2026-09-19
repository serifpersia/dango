import { Request, Response } from 'express'
import { performWriteTransaction } from '../sync.js'
import { searchAnilistByTitle, isAnilistRateLimited, getShowMetaById } from '../lib/anilist.js'
import { kitsuSearchAnime } from '../lib/kitsu.js'
import { offlineDb } from '../lib/offline-db.js'
import { LibraryRepository } from '../repositories/library.repository.js'
import { XMLParser } from 'fast-xml-parser'
import logger from '../logger.js'
import path from 'path'
import fs from 'fs'
import { CONFIG } from '../config.js'
import { DatabaseWrapper } from '../db.js'
import { SettingsRepository } from '../repositories/settings.repository.js'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository.js'
import { getMachineId } from '../utils/machine-id.js'
import { discordRPCService } from '../discord-rpc.js'

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

export class SettingsController {
  getSettings = async (req: Request, res: Response) => {
    try {
      const row = await SettingsRepository.getByKey(req.db, req.query.key as string)
      let value = row ? row.value : null
      if (value === null && req.query.key === 'discordRPCEnabled') {
        value = 'true'
      }
      if (value === null && req.query.key === 'discordRPCHideMature') {
        value = 'true'
      }
      if (value === null && req.query.key === 'ignoreAdultContent') {
        value = 'true'
      }
      res.json({ value: value })
    } catch {
      res.status(500).json({ error: 'DB error' })
    }
  }

  updateSettings = async (req: Request, res: Response) => {
    try {
      const key = String(req.body.key)
      const value = String(req.body.value ?? '')
      const shouldDelete = value === '' && key === 'tracker_anilist_client_id'
      await performWriteTransaction(req.db, (tx) => {
        if (shouldDelete) SettingsRepository.deleteByKey(tx, key)
        else SettingsRepository.upsert(tx, key, value)
      })
      if (req.body.key === 'discordRPCEnabled') {
        discordRPCService.setEnabled(req.body.value === 'true' || req.body.value === true)
      }
      if (req.body.key === 'discordRPCHideMature') {
        discordRPCService.setHideMature(req.body.value === 'true' || req.body.value === true)
      }
      res.json({ success: true })
    } catch {
      res.status(500).json({ error: 'DB error' })
    }
  }

  backupDatabase = (req: Request, res: Response) => {
    const backupPath = path.join(CONFIG.ROOT, 'dango-backup.db')

    try {
      req.db.backup(backupPath)
      res.download(backupPath, 'dango-backup.db', (err) => {
        if (err) {
          logger.error({ err }, 'res.download failed during database backup')
          if (!res.headersSent) {
            res.status(500).json({ error: 'Download failed' })
          }
        }
        fs.unlink(backupPath, () => {})
      })
    } catch (err) {
      logger.error({ err }, 'Manual backup failed')
      return res.status(500).json({ error: 'Backup failed' })
    }
  }

  restoreDatabase = (
    req: Request,
    res: Response,
    db: DatabaseWrapper,
    initializeDatabase: (path: string) => Promise<DatabaseWrapper>,
    setDb: (newDb: DatabaseWrapper) => void
  ) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded.' })

    const dbName = CONFIG.IS_DEV ? CONFIG.DB_NAME_DEV : CONFIG.DB_NAME_PROD
    const tempPath = path.join(CONFIG.ROOT, `restore_temp.db`)
    const dbPath = path.join(CONFIG.ROOT, dbName)

    db.close((closeErr: Error | null) => {
      if (closeErr) return res.status(500).json({ error: 'Failed to close database.' })

      try {
        req.db.checkpoint()
      } catch (checkpointErr) {
        logger.warn({ err: checkpointErr }, 'WAL checkpoint failed')
      }

      try {
        if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`)
        if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`)
      } catch (cleanupErr) {
        logger.warn({ err: cleanupErr }, 'Failed to clean up WAL files')
      }

      fs.rename(tempPath, dbPath, async (renameErr) => {
        if (renameErr) {
          try {
            const reopenedDb = await initializeDatabase(dbPath)
            setDb(reopenedDb)
            req.db = reopenedDb
          } catch (e) {
            logger.error({ err: e }, 'Failed to reopen DB after rename failure')
          }
          return res.status(500).json({ error: 'Failed to replace database file.' })
        }
        try {
          const newDb = await initializeDatabase(dbPath)
          setDb(newDb)
          req.db = newDb
          res.json({ success: true, message: 'Database restored.' })
        } catch (e) {
          logger.error({ err: e }, 'Failed to initialize restored database')
          res.status(500).json({ error: 'Failed to initialize restored database.' })
        }
      })
    })
  }

  getOfflineDbInfo = (req: Request, res: Response) => {
    try {
      res.json(offlineDb.getOfflineDbInfo(req.db))
    } catch {
      res.status(500).json({ error: 'DB error' })
    }
  }

  updateOfflineDb = (req: Request, res: Response) => {
    try {
      const info = offlineDb.getOfflineDbInfo(req.db)
      if (info.isRefreshing) {
        return res.status(409).json({ error: 'Offline database refresh already in progress' })
      }
      offlineDb.refreshDatabase(req.db).catch((err) => {
        logger.warn({ err: err?.message }, 'Manual offline database update failed')
      })
      res.status(202).json({ message: 'Offline database refresh started' })
    } catch {
      res.status(500).json({ error: 'DB error' })
    }
  }

  setAutoUpdateOfflineDb = (req: Request, res: Response) => {
    try {
      const enabled = req.body?.enabled
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' })
      }
      SettingsRepository.upsert(req.db, 'offlineDbAutoUpdateEnabled', String(enabled))
      res.json({ success: true, enabled })
    } catch {
      res.status(500).json({ error: 'DB error' })
    }
  }

  getImportStatus = (_req: Request, res: Response) => {
    res.json(activeImportStatus)
  }

  cancelImport = (_req: Request, res: Response) => {
    if (!activeImportStatus.running) {
      return res.json({ success: true, message: 'No import running' })
    }
    activeImportCancelled = true
    res.json({ success: true, message: 'Import cancellation requested' })
  }

  importMalXml = async (req: Request, res: Response) => {
    if (activeImportStatus.running) {
      return res.status(409).json({ error: 'An import is already in progress' })
    }
    if (!req.file) return res.status(400).json({ error: 'No file' })
    const { erase, useOfflineDb, skipFallback } = req.body
    const offlineEnabled =
      useOfflineDb !== 'false' && useOfflineDb !== false && useOfflineDb !== '0'
    const shouldSkipFallback =
      skipFallback === 'true' || skipFallback === true || skipFallback === '1'

    let result: { myanimelist?: { anime?: MalAnimeItem[] } }
    try {
      result = malXmlParser.parse(req.file.buffer.toString()) as {
        myanimelist?: { anime?: MalAnimeItem[] }
      }
    } catch {
      return res.status(400).json({ error: 'Invalid XML' })
    }

    const animeList: MalAnimeItem[] = result?.myanimelist?.anime || []

    if (animeList.length === 0) {
      return res.status(400).json({ error: 'No anime found in XML' })
    }

    const total = animeList.length
    activeImportCancelled = false
    activeImportStatus = { running: true, current: 0, total, phase: 'offline', source: 'offline' }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    let clientDisconnected = false
    req.on('close', () => {
      if (!res.writableEnded) clientDisconnected = true
    })

    const sendEvent = (event: string, data: unknown) => {
      if (clientDisconnected || res.writableEnded) return
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        if (typeof res.flush === 'function') res.flush()
      } catch {
        // ignore
      }
    }

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
        await performWriteTransaction(req.db, (tx) => {
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
            await performWriteTransaction(req.db, (tx) => {
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
    res.end()
  }

  clearDatabase = async (req: Request, res: Response) => {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ error: 'Confirmation required' })
    }
    if (activeImportStatus.running) {
      return res.status(409).json({ error: 'An import is in progress' })
    }
    try {
      const before = LibraryRepository.countAll(req.db)
      await performWriteTransaction(req.db, (tx) => {
        LibraryRepository.clearAll(tx)
      })
      logger.warn({ before }, 'Library database cleared by user request')
      res.json({ success: true, deleted: before })
    } catch {
      res.status(500).json({ error: 'DB error' })
    }
  }

  getInstallationId = (_req: Request, res: Response) => {
    try {
      res.json({ id: getMachineId() })
    } catch (err) {
      logger.error({ err }, 'Failed to get machine ID')
      res.status(500).json({ error: 'Failed to get machine ID' })
    }
  }
}

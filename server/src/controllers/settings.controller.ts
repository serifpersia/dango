import { Request, Response } from 'express'
import { performWriteTransaction } from '../sync'
import { searchAnilistByTitle, isAnilistRateLimited, getShowMetaById } from '../lib/anilist'
import { kitsuSearchAnime } from '../lib/kitsu'
import { parseStringPromise } from 'xml2js'
import logger from '../logger'
import path from 'path'
import fs from 'fs'
import { CONFIG } from '../config'
import { DatabaseWrapper } from '../db'
import { SettingsRepository } from '../repositories/settings.repository'
import { ShowsMetaRepository } from '../repositories/shows-meta.repository'
import { getMachineId } from '../utils/machine-id'
import { discordRPCService } from '../discord-rpc'

interface MalAnimeItem {
  series_title: string[]
  my_status: string[]
}

interface ShowToInsert {
  id: string
  name: string
  thumbnail?: string
  status: string
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

async function searchByTitleForMal(
  title: string
): Promise<{
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
      res.json({ value: value })
    } catch {
      res.status(500).json({ error: 'DB error' })
    }
  }

  updateSettings = async (req: Request, res: Response) => {
    try {
      await performWriteTransaction(req.db, (tx) => {
        SettingsRepository.upsert(tx, req.body.key, String(req.body.value))
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
      res.download(backupPath, 'dango-backup.db', () => {
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

  importMalXml = async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: 'No file' })
    const { erase } = req.body

    let result: Record<string, unknown>
    try {
      result = await parseStringPromise(req.file.buffer.toString())
    } catch {
      return res.status(400).json({ error: 'Invalid XML' })
    }

    const animeList: MalAnimeItem[] =
      ((result?.myanimelist as Record<string, unknown>)?.anime as MalAnimeItem[]) || []

    if (animeList.length === 0) {
      return res.status(400).json({ error: 'No anime found in XML' })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    const sendEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      if (typeof res.flush === 'function') res.flush()
    }

    let skippedCount = 0
    let importedCount = 0
    const showsToInsert: ShowToInsert[] = []
    const metaToSave: { id: string; thumbnail?: string; type?: string }[] = []

    const BATCH_SIZE = 5
    const total = animeList.length

    for (let i = 0; i < animeList.length; i += BATCH_SIZE) {
      const batch = animeList.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.allSettled(
        batch.map((item) => searchByTitleForMal(item.series_title[0]))
      )

      const metaPromises: Promise<void>[] = []

      batchResults.forEach((r, idx) => {
        const malTitle = batch[idx].series_title[0]
        const currentIdx = i + idx + 1

        if (r.status === 'fulfilled' && r.value) {
          const show = r.value
          const title = show.title?.english || show.title?.romaji || malTitle
          const status = mapMalStatus(batch[idx].my_status[0])
          showsToInsert.push({
            id: String(show.id),
            name: title,
            status,
          })

          sendEvent('progress', {
            current: currentIdx,
            total,
            title: malTitle,
            matchedTitle: title,
            status,
            source: show.source,
            found: true,
          })

          metaPromises.push(
            getShowMetaById(String(show.id)).then((meta) => {
              if (meta) {
                metaToSave.push({
                  id: String(show.id),
                  thumbnail: meta.thumbnail || undefined,
                  type: meta.type || undefined,
                })
              }
            }).catch(() => {})
          )
        } else {
          skippedCount++
          sendEvent('progress', {
            current: currentIdx,
            total,
            title: malTitle,
            matchedTitle: null,
            status: mapMalStatus(batch[idx].my_status[0]),
            source: null,
            found: false,
          })
        }
      })

      await Promise.allSettled(metaPromises)
    }

    await performWriteTransaction(req.db, (tx) => {
      if (erase) SettingsRepository.clearWatchlist(tx)
      SettingsRepository.upsertWatchlistBatch(tx, showsToInsert)
      for (const meta of metaToSave) {
        if (meta.thumbnail) {
          ShowsMetaRepository.upsert(tx, {
            id: meta.id,
            thumbnail: meta.thumbnail,
            type: meta.type,
          })
        }
      }
    })

    importedCount = showsToInsert.length

    sendEvent('complete', { imported: importedCount, skipped: skippedCount })
    res.end()
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

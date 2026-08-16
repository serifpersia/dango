import { Request, Response } from 'express'
import { performWriteTransaction } from '../sync'
import { searchAnilistByTitle } from '../lib/anilist'
import { parseStringPromise } from 'xml2js'
import logger from '../logger'
import path from 'path'
import fs from 'fs'
import { CONFIG } from '../config'
import { DatabaseWrapper } from '../db'
import { SettingsRepository } from '../repositories/settings.repository'
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

    let skippedCount = 0
    const showsToInsert: ShowToInsert[] = []

    const BATCH_SIZE = 5
    for (let i = 0; i < animeList.length; i += BATCH_SIZE) {
      const batch = animeList.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.allSettled(
        batch.map((item) => searchAnilistByTitle(item.series_title[0]))
      )
      batchResults.forEach((r, idx) => {
        if (r.status === 'fulfilled' && r.value) {
          const show = r.value
          const title = show.title?.english || show.title?.romaji || batch[idx].series_title[0]
          showsToInsert.push({
            id: String(show.id),
            name: title,
            status: batch[idx].my_status[0],
          })
        } else {
          skippedCount++
        }
      })
    }

    await performWriteTransaction(req.db, (tx) => {
      if (erase) SettingsRepository.clearWatchlist(tx)
      SettingsRepository.upsertWatchlistBatch(tx, showsToInsert)
    })
    res.json({ imported: showsToInsert.length, skipped: skippedCount })
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

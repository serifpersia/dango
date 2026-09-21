import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import logger from './logger.js'
import { googleDriveService } from './google.js'
import { rcloneService } from './rclone.js'
import { githubSyncService } from './github-sync.js'
import { CONFIG } from './config.js'
import { DatabaseWrapper } from './db.js'
import { dbGet } from './utils/db-utils.js'
import { TempShowIdsRepository } from './repositories/temp-show-ids.repository.js'
import { malCachePruneExpired } from './repositories/mal-cache.repository.js'
import { notifySyncStart, notifySyncEnd } from './lib/ipc.js'
import {
  ANIME_SYNC_TABLES,
  exportTables,
  importTables,
  MANGA_SYNC_TABLES,
  TV_SYNC_TABLES,
  normalizePayload,
  readPayloadVersion,
  type SyncPayload,
} from './sync-payload.js'

const log = logger.child({ module: 'Sync' })

export const SYNC_TABLES = ANIME_SYNC_TABLES
export { MANGA_SYNC_TABLES, TV_SYNC_TABLES }

export type SyncTable = (typeof SYNC_TABLES)[number]
export type MangaSyncTable = (typeof MANGA_SYNC_TABLES)[number]
export type TvSyncTable = (typeof TV_SYNC_TABLES)[number]
export type AnimeSyncPayload = SyncPayload<SyncTable>
export type MangaSyncPayload = SyncPayload<MangaSyncTable>
export type TvSyncPayload = SyncPayload<TvSyncTable>
// anime_id_map (offline MAL<->AniList metadata) is intentionally local-only:
// it is rebuilt weekly from the upstream JSON dump and never synced.

async function exportSyncPayload(db: DatabaseWrapper): Promise<AnimeSyncPayload> {
  return exportTables(db, SYNC_TABLES)
}

function importSyncPayload(db: DatabaseWrapper, payload: AnimeSyncPayload) {
  importTables(db, SYNC_TABLES, payload, {
    libraryTables: ['watchlist', 'watched_episodes'],
    backupName: 'pre-sync-backup.db',
  })
}

async function exportMangaSyncPayload(db: DatabaseWrapper): Promise<MangaSyncPayload> {
  return exportTables(db, MANGA_SYNC_TABLES)
}

async function exportTvSyncPayload(db: DatabaseWrapper): Promise<TvSyncPayload> {
  return exportTables(db, TV_SYNC_TABLES)
}

function importMangaSyncPayload(db: DatabaseWrapper, payload: MangaSyncPayload) {
  importTables(db, MANGA_SYNC_TABLES, payload, {
    libraryTables: ['manga_library', 'manga_progress'],
    backupName: 'pre-sync-manga-backup.db',
  })
}

function importTvSyncPayload(db: DatabaseWrapper, payload: TvSyncPayload) {
  importTables(db, TV_SYNC_TABLES, payload, {
    libraryTables: ['tv_library', 'tv_progress'],
    backupName: 'pre-sync-tv-backup.db',
  })
}

async function getRcloneRemotePayloadVersion(
  remoteFolder: string,
  fileName: string = CONFIG.RCLONE_SYNC_FILENAME
): Promise<number> {
  const exists = await rcloneService.fileExists(remoteFolder, fileName)
  if (!exists) return 0
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_sync.json`)
  try {
    await rcloneService.downloadFile(remoteFolder, fileName, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = JSON.parse(content) as AnimeSyncPayload
    return readPayloadVersion(payload)
  } catch {
    return 0
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath)
  }
}

async function rcloneSyncUp(
  db: DatabaseWrapper,
  remoteFolder: string,
  fileName: string = CONFIG.RCLONE_SYNC_FILENAME
): Promise<void> {
  const payload = await exportSyncPayload(db)
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_up.json`)
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2))
    await rcloneService.uploadFile(tempPath, remoteFolder, fileName)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

async function rcloneSyncDown(
  db: DatabaseWrapper,
  remoteFolder: string,
  fileName: string = CONFIG.RCLONE_SYNC_FILENAME
): Promise<number> {
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_down.json`)
  try {
    await rcloneService.downloadFile(remoteFolder, fileName, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = normalizePayload(JSON.parse(content), SYNC_TABLES, 'rclone') as AnimeSyncPayload
    importSyncPayload(db, payload)
    return readPayloadVersion(payload)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

async function rcloneMangaSyncUp(db: DatabaseWrapper, remoteFolder: string): Promise<void> {
  const payload = await exportMangaSyncPayload(db)
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_manga_up.json`)
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2))
    await rcloneService.uploadFile(tempPath, remoteFolder, CONFIG.MANGA_RCLONE_SYNC_FILENAME)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

async function rcloneTvSyncUp(db: DatabaseWrapper, remoteFolder: string): Promise<void> {
  const payload = await exportTvSyncPayload(db)
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_tv_up.json`)
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2))
    await rcloneService.uploadFile(tempPath, remoteFolder, CONFIG.TV_RCLONE_SYNC_FILENAME)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

async function rcloneMangaSyncDown(db: DatabaseWrapper, remoteFolder: string): Promise<number> {
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_manga_down.json`)
  try {
    await rcloneService.downloadFile(remoteFolder, CONFIG.MANGA_RCLONE_SYNC_FILENAME, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = normalizePayload(JSON.parse(content), MANGA_SYNC_TABLES, 'rclone manga')
    importMangaSyncPayload(db, payload)
    return readPayloadVersion(payload)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

async function rcloneTvSyncDown(db: DatabaseWrapper, remoteFolder: string): Promise<number> {
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_tv_down.json`)
  try {
    await rcloneService.downloadFile(remoteFolder, CONFIG.TV_RCLONE_SYNC_FILENAME, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = normalizePayload(JSON.parse(content), TV_SYNC_TABLES, 'rclone tv')
    importTvSyncPayload(db, payload)
    return readPayloadVersion(payload)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

class Mutex {
  private _locked = false
  private _waiting: (() => void)[] = []

  async lock() {
    return new Promise<void>((resolve) => {
      if (!this._locked) {
        this._locked = true
        resolve()
      } else {
        this._waiting.push(resolve)
      }
    })
  }

  unlock() {
    if (this._waiting.length > 0) {
      const resolve = this._waiting.shift()!
      resolve()
    } else {
      this._locked = false
    }
  }
}

const syncMutex = new Mutex()
let isSyncing = false
let activeProvider: 'github' | 'google' | 'rclone' | 'none' = 'none'

export async function waitForSync(): Promise<void> {
  await syncMutex.lock()
  syncMutex.unlock()
}

export function getActiveProvider() {
  return activeProvider
}

export async function initSyncProvider(
  preferred?: 'github' | 'google' | 'rclone' | 'none'
): Promise<void> {
  const provider =
    preferred || (process.env.SYNC_PROVIDER as 'github' | 'google' | 'rclone' | 'none' | undefined)

  if (provider === 'github' && githubSyncService.isAuthenticated()) {
    activeProvider = 'github'
    log.info('Sync Provider: GitHub (Selected)')
    return
  }

  if (provider === 'google' && googleDriveService.isAuthenticated()) {
    activeProvider = 'google'
    log.info('Sync Provider: Google Drive API (Selected)')
    return
  }

  if (provider === 'rclone') {
    const rcloneAvailable = await rcloneService.init()
    if (rcloneAvailable) {
      activeProvider = 'rclone'
      log.info(`Sync Provider: Rclone (${rcloneService.getRemoteName()}) (Selected)`)
      return
    }
  }

  if (provider === 'none') {
    activeProvider = 'none'
    log.info('Sync Provider: None (Forced)')
    return
  }

  if (githubSyncService.isAuthenticated()) {
    activeProvider = 'github'
    log.info('Sync Provider: GitHub (Fallback)')
    return
  }

  if (googleDriveService.isAuthenticated()) {
    activeProvider = 'google'
    log.info('Sync Provider: Google Drive API (Fallback)')
    return
  }

  const rcloneAvailable = await rcloneService.init()
  if (rcloneAvailable) {
    activeProvider = 'rclone'
    log.info(`Sync Provider: Rclone (${rcloneService.getRemoteName()}) (Fallback)`)
    return
  }

  activeProvider = 'none'
  log.info('No sync provider available.')
}

export async function getLocalManifestVersion(): Promise<number> {
  if (existsSync(CONFIG.LOCAL_MANIFEST_PATH)) {
    try {
      const content = await fs.readFile(CONFIG.LOCAL_MANIFEST_PATH, 'utf-8')
      return JSON.parse(content).version || 0
    } catch {
      return 0
    }
  }
  return 0
}

export async function setLocalManifestVersion(version: number): Promise<void> {
  await fs.writeFile(CONFIG.LOCAL_MANIFEST_PATH, JSON.stringify({ version }))
}

export async function getLocalMangaManifestVersion(): Promise<number> {
  if (existsSync(CONFIG.MANGA_LOCAL_MANIFEST_PATH)) {
    try {
      const content = await fs.readFile(CONFIG.MANGA_LOCAL_MANIFEST_PATH, 'utf-8')
      return JSON.parse(content).version || 0
    } catch {
      return 0
    }
  }
  return 0
}

export async function setLocalMangaManifestVersion(version: number): Promise<void> {
  await fs.writeFile(CONFIG.MANGA_LOCAL_MANIFEST_PATH, JSON.stringify({ version }))
}

export async function getLocalTvManifestVersion(): Promise<number> {
  if (existsSync(CONFIG.TV_LOCAL_MANIFEST_PATH)) {
    try {
      const content = await fs.readFile(CONFIG.TV_LOCAL_MANIFEST_PATH, 'utf-8')
      return JSON.parse(content).version || 0
    } catch {
      return 0
    }
  }
  return 0
}

export async function setLocalTvManifestVersion(version: number): Promise<void> {
  await fs.writeFile(CONFIG.TV_LOCAL_MANIFEST_PATH, JSON.stringify({ version }))
}

async function getRemoteManifestVersion(
  remoteFolder: string
): Promise<{ version: number; fileId?: string }> {
  try {
    if (activeProvider === 'github') {
      if (!githubSyncService.isAuthenticated()) return { version: 0 }
      return { version: await githubSyncService.getRemoteVersion() }
    } else if (activeProvider === 'google') {
      if (!googleDriveService.isAuthenticated()) return { version: 0 }
      return { version: await googleDriveService.getRemoteVersion() }
    } else if (activeProvider === 'rclone') {
      return { version: await getRcloneRemotePayloadVersion(remoteFolder) }
    }
  } catch (err) {
    log.warn({ err }, 'Could not read remote manifest.')
  }
  return { version: 0 }
}

async function getMangaRemoteManifestVersion(
  remoteFolder: string
): Promise<{ version: number; fileId?: string }> {
  try {
    if (activeProvider === 'github') {
      if (!githubSyncService.isAuthenticated()) return { version: 0 }
      return { version: await githubSyncService.getMangaRemoteVersion() }
    } else if (activeProvider === 'google') {
      if (!googleDriveService.isAuthenticated()) return { version: 0 }
      return { version: await googleDriveService.getMangaRemoteVersion() }
    } else if (activeProvider === 'rclone') {
      return {
        version: await getRcloneRemotePayloadVersion(
          remoteFolder,
          CONFIG.MANGA_RCLONE_SYNC_FILENAME
        ),
      }
    }
  } catch (err) {
    log.warn({ err }, 'Could not read remote manga manifest.')
  }
  return { version: 0 }
}

async function getTvRemoteManifestVersion(
  remoteFolder: string
): Promise<{ version: number; fileId?: string }> {
  try {
    if (activeProvider === 'github') {
      if (!githubSyncService.isAuthenticated()) return { version: 0 }
      return { version: await githubSyncService.getTvRemoteVersion() }
    } else if (activeProvider === 'google') {
      if (!googleDriveService.isAuthenticated()) return { version: 0 }
      return { version: await googleDriveService.getTvRemoteVersion() }
    } else if (activeProvider === 'rclone') {
      return {
        version: await getRcloneRemotePayloadVersion(remoteFolder, CONFIG.TV_RCLONE_SYNC_FILENAME),
      }
    }
  } catch (err) {
    log.warn({ err }, 'Could not read remote TV manifest.')
  }
  return { version: 0 }
}

export async function syncDownOnBoot(
  db: DatabaseWrapper,
  dbPath: string,
  remoteFolderName: string,
  closeMainDb: () => Promise<void>
): Promise<boolean> {
  let localVersion = await getLocalManifestVersion()

  if (localVersion === 0 && db) {
    const row = dbGet<{ value: number }>(
      db,
      "SELECT value FROM sync_metadata WHERE key = 'db_version'"
    )
    localVersion = row?.value ?? 0
    if (localVersion > 0) {
      await setLocalManifestVersion(localVersion)
    }
  }

  if (activeProvider === 'none') return false

  await syncMutex.lock()
  if (isSyncing) {
    syncMutex.unlock()
    return false
  }
  isSyncing = true

  try {
    notifySyncStart(`Initial sync check (${activeProvider})`)
    const { version: remoteVersion } = await getRemoteManifestVersion(remoteFolderName)
    notifySyncEnd()

    log.info(`Sync Check: Local v${localVersion} vs Remote v${remoteVersion}`)

    if (remoteVersion > localVersion) {
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return false
        notifySyncStart(`Importing GitHub sync data (Remote v${remoteVersion})`)
        const importedVersion = await githubSyncService.syncDown(db)
        await setLocalManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('GitHub sync down complete.')
        return false
      }

      if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return false
        notifySyncStart(`Importing Google sync data (Remote v${remoteVersion})`)
        const importedVersion = await googleDriveService.syncDown(db)
        await setLocalManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('Google sync down complete.')
        return false
      }

      if (activeProvider === 'rclone') {
        notifySyncStart(`Importing Rclone sync data (Remote v${remoteVersion})`)
        const importedVersion = await rcloneSyncDown(db, remoteFolderName)
        await setLocalManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('Rclone sync down complete.')
        return false
      }

      notifySyncStart(`Downloading remote database (Remote v${remoteVersion})`)
      await closeMainDb()

      const backupPath = `${dbPath}.bak`

      try {
        if (existsSync(dbPath)) {
          await fs.copyFile(dbPath, backupPath)
        }

        try {
          await fs.unlink(`${dbPath}-wal`)
        } catch (e) {
          void e
        }
        try {
          await fs.unlink(`${dbPath}-shm`)
        } catch (e) {
          void e
        }

        log.warn('Legacy raw-db sync path reached with JSON providers. No action taken.')

        if (existsSync(backupPath)) {
          await fs.unlink(backupPath)
        }

        notifySyncEnd()
        log.info('Sync down complete.')
        return true
      } catch (err) {
        notifySyncEnd()
        log.error({ err }, 'Sync down failed. Restoring backup.')
        if (existsSync(backupPath)) {
          try {
            await fs.copyFile(backupPath, dbPath)
            log.info('Backup restored successfully after failed sync down.')
          } catch (restoreErr) {
            log.error({ err: restoreErr }, 'Critical: restore from backup also failed.')
            throw new Error('Sync down and restore both failed. Database may be corrupt.', {
              cause: restoreErr,
            })
          }
        }
        return true
      }
    } else {
      log.info('Local DB is up to date.')
      return false
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, 'Sync boot error.')
    return false
  } finally {
    isSyncing = false
    syncMutex.unlock()
  }
}

export async function syncUp(
  db: DatabaseWrapper,
  dbPath: string,
  remoteFolderName: string
): Promise<void> {
  if (activeProvider === 'none') return

  await syncMutex.lock()
  if (isSyncing) {
    syncMutex.unlock()
    return
  }
  isSyncing = true

  try {
    const localVersion = await getLocalManifestVersion()
    notifySyncStart(`Syncing up (Local v${localVersion})`)

    const { version: remoteVersion } = await getRemoteManifestVersion(remoteFolderName)

    if (localVersion > remoteVersion) {
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return
        await githubSyncService.syncUp(db)
      } else if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return
        await googleDriveService.syncUp(db)
      } else if (activeProvider === 'rclone') {
        await rcloneSyncUp(db, remoteFolderName)
      }

      notifySyncEnd()
      log.info('Sync up complete.')
    } else {
      notifySyncEnd()
      log.info('No changes to sync up or remote is newer.')
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, 'Sync up failed.')
  } finally {
    isSyncing = false
    syncMutex.unlock()
  }
}

export async function performWriteTransaction(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => void
): Promise<void> {
  db.serialize(() => {
    runnable(db)
    db.run("UPDATE sync_metadata SET value = value + 1 WHERE key = 'db_version'")
  })

  const row = dbGet<{ value: number }>(
    db,
    "SELECT value FROM sync_metadata WHERE key = 'db_version'"
  )
  const newVersion = row?.value ?? 1

  await setLocalManifestVersion(newVersion)
}

export async function performMangaWriteTransaction(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => void
): Promise<void> {
  db.serialize(() => {
    runnable(db)
    db.run("UPDATE sync_metadata SET value = value + 1 WHERE key = 'db_version'")
  })

  const row = dbGet<{ value: number }>(
    db,
    "SELECT value FROM sync_metadata WHERE key = 'db_version'"
  )
  const newVersion = row?.value ?? 1

  await setLocalMangaManifestVersion(newVersion)
}

export async function performTvWriteTransaction(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => void
): Promise<void> {
  db.serialize(() => {
    runnable(db)
    db.run("UPDATE sync_metadata SET value = value + 1 WHERE key = 'db_version'")
  })

  const row = dbGet<{ value: number }>(
    db,
    "SELECT value FROM sync_metadata WHERE key = 'db_version'"
  )
  const newVersion = row?.value ?? 1

  await setLocalTvManifestVersion(newVersion)
}

export async function mangaSyncDownOnBoot(
  db: DatabaseWrapper,
  remoteFolderName: string
): Promise<void> {
  let localVersion = await getLocalMangaManifestVersion()

  if (localVersion === 0 && db) {
    const row = dbGet<{ value: number }>(
      db,
      "SELECT value FROM sync_metadata WHERE key = 'db_version'"
    )
    localVersion = row?.value ?? 0
    if (localVersion > 0) {
      await setLocalMangaManifestVersion(localVersion)
    }
  }

  if (activeProvider === 'none') return

  await syncMutex.lock()
  if (isSyncing) {
    syncMutex.unlock()
    return
  }
  isSyncing = true

  try {
    notifySyncStart(`Initial manga sync check (${activeProvider})`)
    const { version: remoteVersion } = await getMangaRemoteManifestVersion(remoteFolderName)
    notifySyncEnd()

    log.info(`Manga Sync Check: Local v${localVersion} vs Remote v${remoteVersion}`)

    if (remoteVersion > localVersion) {
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return
        notifySyncStart(`Importing GitHub manga sync data (Remote v${remoteVersion})`)
        const importedVersion = await githubSyncService.syncMangaDown(db)
        await setLocalMangaManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('GitHub manga sync down complete.')
        return
      }

      if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return
        notifySyncStart(`Importing Google manga sync data (Remote v${remoteVersion})`)
        const importedVersion = await googleDriveService.syncMangaDown(db)
        await setLocalMangaManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('Google manga sync down complete.')
        return
      }

      if (activeProvider === 'rclone') {
        notifySyncStart(`Importing Rclone manga sync data (Remote v${remoteVersion})`)
        const importedVersion = await rcloneMangaSyncDown(db, remoteFolderName)
        await setLocalMangaManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('Rclone manga sync down complete.')
        return
      }
    } else {
      log.info('Local manga DB is up to date.')
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, 'Manga sync boot error.')
  } finally {
    isSyncing = false
    syncMutex.unlock()
  }
}

export async function mangaSyncUp(db: DatabaseWrapper, remoteFolderName: string): Promise<void> {
  if (activeProvider === 'none') return

  await syncMutex.lock()
  if (isSyncing) {
    syncMutex.unlock()
    return
  }
  isSyncing = true

  try {
    const localVersion = await getLocalMangaManifestVersion()
    const { version: remoteVersion } = await getMangaRemoteManifestVersion(remoteFolderName)

    if (localVersion > remoteVersion) {
      notifySyncStart(`Syncing manga up (Local v${localVersion})`)
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return
        await githubSyncService.syncMangaUp(db)
      } else if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return
        await googleDriveService.syncMangaUp(db)
      } else if (activeProvider === 'rclone') {
        await rcloneMangaSyncUp(db, remoteFolderName)
      }

      notifySyncEnd()
      log.info('Manga sync up complete.')
    } else {
      log.info('No manga changes to sync up or remote is newer.')
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, 'Manga sync up failed.')
  } finally {
    isSyncing = false
    syncMutex.unlock()
  }
}

export async function initializeMangaDatabase(dbPath: string): Promise<DatabaseWrapper> {
  try {
    const db = await DatabaseWrapper.create(dbPath)
    db.configure('busyTimeout', 5000)

    db.run('PRAGMA journal_mode = WAL;')
    db.run('PRAGMA synchronous = NORMAL;')
    db.run('PRAGMA cache_size = -20000;')
    db.run('PRAGMA temp_store = MEMORY;')
    db.run('PRAGMA mmap_size = 268435456;')
    db.run('PRAGMA foreign_keys = ON;')

    db.run(
      `CREATE TABLE IF NOT EXISTS manga_library (id TEXT PRIMARY KEY, provider TEXT NOT NULL, mangaId TEXT NOT NULL, title TEXT, cover TEXT, status TEXT DEFAULT 'Reading', author TEXT, contentRating TEXT, lastChapterId TEXT, lastChapterNumber TEXT, lastPage INTEGER, updatedAt INTEGER, altTitle TEXT)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS manga_progress (mangaId TEXT NOT NULL, chapterId TEXT NOT NULL, chapterNumber TEXT, page INTEGER DEFAULT 0, pageCount INTEGER DEFAULT 0, updatedAt INTEGER, PRIMARY KEY (mangaId, chapterId))`
    )
    db.run(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER)`)
    db.run(`INSERT OR IGNORE INTO sync_metadata (key, value) VALUES ('db_version', 1)`)

    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_library_provider_manga ON manga_library(provider, mangaId)`
    )
    db.run(`CREATE INDEX IF NOT EXISTS idx_manga_library_status ON manga_library(status)`)
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_manga_progress_manga ON manga_progress(mangaId, updatedAt)`
    )

    const mangaColumns = db.all<{ name: string }>(`PRAGMA table_info(manga_library)`)
    if (!mangaColumns.some((c) => c.name === 'altTitle')) {
      db.run(`ALTER TABLE manga_library ADD COLUMN altTitle TEXT`)
    }

    const mangaProgressColumns = db.all<{ name: string }>(`PRAGMA table_info(manga_progress)`)
    if (!mangaProgressColumns.some((c) => c.name === 'title')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN title TEXT`)
    }
    if (!mangaProgressColumns.some((c) => c.name === 'cover')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN cover TEXT`)
    }
    if (!mangaProgressColumns.some((c) => c.name === 'provider')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN provider TEXT`)
    }
    if (!mangaProgressColumns.some((c) => c.name === 'altTitle')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN altTitle TEXT`)
    }
    if (!mangaProgressColumns.some((c) => c.name === 'contentRating')) {
      db.run(`ALTER TABLE manga_progress ADD COLUMN contentRating TEXT`)
    }

    return db
  } catch (err) {
    log.error({ err }, 'Manga database opening error')
    throw err
  }
}

export async function tvSyncDownOnBoot(
  db: DatabaseWrapper,
  remoteFolderName: string
): Promise<void> {
  let localVersion = await getLocalTvManifestVersion()

  if (localVersion === 0 && db) {
    const row = dbGet<{ value: number }>(
      db,
      "SELECT value FROM sync_metadata WHERE key = 'db_version'"
    )
    localVersion = row?.value ?? 0
    if (localVersion > 0) {
      await setLocalTvManifestVersion(localVersion)
    }
  }

  if (activeProvider === 'none') return

  await syncMutex.lock()
  if (isSyncing) {
    syncMutex.unlock()
    return
  }
  isSyncing = true

  try {
    notifySyncStart(`Initial TV sync check (${activeProvider})`)
    const { version: remoteVersion } = await getTvRemoteManifestVersion(remoteFolderName)
    notifySyncEnd()

    log.info(`TV Sync Check: Local v${localVersion} vs Remote v${remoteVersion}`)

    if (remoteVersion > localVersion) {
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return
        notifySyncStart(`Importing GitHub TV sync data (Remote v${remoteVersion})`)
        const importedVersion = await githubSyncService.syncTvDown(db)
        await setLocalTvManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('GitHub TV sync down complete.')
        return
      }

      if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return
        notifySyncStart(`Importing Google TV sync data (Remote v${remoteVersion})`)
        const importedVersion = await googleDriveService.syncTvDown(db)
        await setLocalTvManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('Google TV sync down complete.')
        return
      }

      if (activeProvider === 'rclone') {
        notifySyncStart(`Importing Rclone TV sync data (Remote v${remoteVersion})`)
        const importedVersion = await rcloneTvSyncDown(db, remoteFolderName)
        await setLocalTvManifestVersion(importedVersion || remoteVersion)
        notifySyncEnd()
        log.info('Rclone TV sync down complete.')
        return
      }
    } else {
      log.info('Local TV DB is up to date.')
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, 'TV sync boot error.')
  } finally {
    isSyncing = false
    syncMutex.unlock()
  }
}

export async function tvSyncUp(db: DatabaseWrapper, remoteFolderName: string): Promise<void> {
  if (activeProvider === 'none') return

  await syncMutex.lock()
  if (isSyncing) {
    syncMutex.unlock()
    return
  }
  isSyncing = true

  try {
    const localVersion = await getLocalTvManifestVersion()
    const { version: remoteVersion } = await getTvRemoteManifestVersion(remoteFolderName)

    if (localVersion > remoteVersion) {
      notifySyncStart(`Syncing TV up (Local v${localVersion})`)
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return
        await githubSyncService.syncTvUp(db)
      } else if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return
        await googleDriveService.syncTvUp(db)
      } else if (activeProvider === 'rclone') {
        await rcloneTvSyncUp(db, remoteFolderName)
      }

      notifySyncEnd()
      log.info('TV sync up complete.')
    } else {
      log.info('No TV changes to sync up or remote is newer.')
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, 'TV sync up failed.')
  } finally {
    isSyncing = false
    syncMutex.unlock()
  }
}

export async function initializeTvDatabase(dbPath: string): Promise<DatabaseWrapper> {
  try {
    const db = await DatabaseWrapper.create(dbPath)
    db.configure('busyTimeout', 5000)

    db.run('PRAGMA journal_mode = WAL;')
    db.run('PRAGMA synchronous = NORMAL;')
    db.run('PRAGMA cache_size = -20000;')
    db.run('PRAGMA temp_store = MEMORY;')
    db.run('PRAGMA mmap_size = 268435456;')
    db.run('PRAGMA foreign_keys = ON;')

    db.run(
      `CREATE TABLE IF NOT EXISTS tv_library (id TEXT PRIMARY KEY, tmdbId INTEGER NOT NULL, mediaType TEXT NOT NULL, title TEXT, poster TEXT, backdrop TEXT, year TEXT, overview TEXT, status TEXT DEFAULT 'Watching', adult INTEGER DEFAULT 0, lastSeason INTEGER, lastEpisode INTEGER, updatedAt INTEGER)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS tv_progress (mediaId TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL, currentTime REAL DEFAULT 0, duration REAL DEFAULT 0, updatedAt INTEGER, PRIMARY KEY (mediaId, season, episode))`
    )
    db.run(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER)`)
    db.run(`INSERT OR IGNORE INTO sync_metadata (key, value) VALUES ('db_version', 1)`)

    db.run(`CREATE INDEX IF NOT EXISTS idx_tv_library_status ON tv_library(status)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_tv_library_tmdb ON tv_library(tmdbId, mediaType)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_tv_progress_media ON tv_progress(mediaId, updatedAt)`)

    const tvProgressColumns = db.all<{ name: string }>(`PRAGMA table_info(tv_progress)`)
    if (!tvProgressColumns.some((c) => c.name === 'title')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN title TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'poster')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN poster TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'backdrop')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN backdrop TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'year')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN year TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'overview')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN overview TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'tmdbId')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN tmdbId INTEGER`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'mediaType')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN mediaType TEXT`)
    }
    if (!tvProgressColumns.some((c) => c.name === 'adult')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN adult INTEGER`)
    }

    return db
  } catch (err) {
    log.error({ err }, 'TV database opening error')
    throw err
  }
}

export async function initializeDatabase(dbPath: string): Promise<DatabaseWrapper> {
  try {
    const db = await DatabaseWrapper.create(dbPath)
    db.configure('busyTimeout', 5000)

    db.run('PRAGMA journal_mode = WAL;')
    db.run('PRAGMA synchronous = NORMAL;')
    db.run('PRAGMA cache_size = -20000;')
    db.run('PRAGMA temp_store = MEMORY;')
    db.run('PRAGMA mmap_size = 268435456;')
    db.run('PRAGMA foreign_keys = ON;')

    db.run(
      `CREATE TABLE IF NOT EXISTS watchlist (id TEXT NOT NULL, name TEXT, thumbnail TEXT, status TEXT, nativeName TEXT, englishName TEXT, type TEXT, PRIMARY KEY (id))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS watched_episodes (showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, watchedAt DATETIME DEFAULT CURRENT_TIMESTAMP, currentTime REAL DEFAULT 0, duration REAL DEFAULT 0, PRIMARY KEY (showId, episodeNumber))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS queue (id INTEGER PRIMARY KEY, showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, queue_order INTEGER NOT NULL)`
    )
    db.run(`CREATE TABLE IF NOT EXISTS settings (key TEXT NOT NULL, value TEXT, PRIMARY KEY (key))`)
    db.run(
      `CREATE TABLE IF NOT EXISTS shows_meta (id TEXT PRIMARY KEY, name TEXT, thumbnail TEXT, nativeName TEXT, englishName TEXT, episodeCount INTEGER, status TEXT, genres TEXT, popularityScore INTEGER, type TEXT)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS dismissed_notifications (showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, dismissedAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (showId, episodeNumber))`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS discovered_notifications (showId TEXT NOT NULL, episodeNumber TEXT NOT NULL, discoveredAt DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (showId, episodeNumber))`
    )
    db.run(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER)`)
    db.run(`INSERT OR IGNORE INTO sync_metadata (key, value) VALUES ('db_version', 1)`)
    db.run(
      `CREATE TABLE IF NOT EXISTS legacy_id_mapping (legacyId TEXT PRIMARY KEY, numericId TEXT)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS temp_show_ids (id TEXT PRIMARY KEY, provider TEXT NOT NULL, nativeId TEXT NOT NULL, title TEXT NOT NULL, thumbnail TEXT, createdAt INTEGER NOT NULL)`
    )
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_temp_show_ids_provider_native ON temp_show_ids(provider, nativeId)`
    )

    try {
      const purged = TempShowIdsRepository.purge(db)
      if (purged > 0) logger.info({ purged }, 'Purged stale temp show ids on boot')
    } catch (e) {
      logger.warn({ err: e }, 'Temp show purge on boot failed')
    }

    try {
      const pruned = malCachePruneExpired()
      if (pruned > 0) logger.info({ pruned }, 'Pruned expired mal cache rows on boot')
    } catch (e) {
      logger.warn({ err: e }, 'Mal cache prune on boot failed')
    }

    db.run(`CREATE INDEX IF NOT EXISTS idx_watched_episodes_showId ON watched_episodes(showId)`)
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_watched_episodes_showId_episodeNumber ON watched_episodes(showId, episodeNumber)`
    )
    db.run(
      `CREATE INDEX IF NOT EXISTS idx_watched_episodes_watchedAt ON watched_episodes(watchedAt)`
    )
    db.run(`CREATE INDEX IF NOT EXISTS idx_watchlist_status ON watchlist(status)`)
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_show_episode ON queue(showId, episodeNumber)`
    )
    db.run(`CREATE INDEX IF NOT EXISTS idx_queue_order ON queue(queue_order)`)

    db.run('DELETE FROM dismissed_notifications WHERE showId NOT IN (SELECT id FROM watchlist)')
    db.run('DELETE FROM discovered_notifications WHERE showId NOT IN (SELECT id FROM watchlist)')
    db.run(
      'DELETE FROM legacy_id_mapping WHERE legacyId NOT IN (SELECT id FROM watchlist) AND numericId NOT IN (SELECT id FROM watchlist)'
    )

    db.run(
      'DELETE FROM dismissed_notifications WHERE EXISTS (SELECT 1 FROM watched_episodes we WHERE we.showId = dismissed_notifications.showId AND we.episodeNumber = dismissed_notifications.episodeNumber)'
    )
    db.run(
      'DELETE FROM discovered_notifications WHERE EXISTS (SELECT 1 FROM watched_episodes we WHERE we.showId = discovered_notifications.showId AND we.episodeNumber = discovered_notifications.episodeNumber)'
    )

    const addCol = (tbl: string, col: string, type: string) => {
      const columns = db.all<{ name: string }>(`PRAGMA table_info(${tbl})`)
      if (!columns.some((c) => c.name === col))
        db.run(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${type}`)
    }

    addCol('watchlist', 'nativeName', 'TEXT')
    addCol('watchlist', 'englishName', 'TEXT')
    addCol('shows_meta', 'nativeName', 'TEXT')
    addCol('shows_meta', 'englishName', 'TEXT')
    addCol('shows_meta', 'episodeCount', 'INTEGER')
    addCol('shows_meta', 'status', 'TEXT')
    addCol('shows_meta', 'genres', 'TEXT')
    addCol('shows_meta', 'popularityScore', 'INTEGER')
    addCol('watchlist', 'type', 'TEXT')
    addCol('shows_meta', 'type', 'TEXT')
    addCol('shows_meta', 'anilistId', 'INTEGER')
    addCol('shows_meta', 'isAdult', 'INTEGER')
    addCol('shows_meta', 'episodeDuration', 'INTEGER')

    await db.saveNow()
    return db
  } catch (err) {
    log.error({ err }, 'Database opening error')
    throw err
  }
}

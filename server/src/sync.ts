import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import logger from './logger.js'
import { googleDriveService } from './google.js'
import { rcloneService } from './rclone.js'
import { githubSyncService } from './github-sync.js'
import { CONFIG } from './config.js'
import { DatabaseWrapper } from './db.js'
import { runTx } from './db/drizzle.js'
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
  ASMR_SYNC_TABLES,
  normalizePayload,
  readPayloadVersion,
  type SyncPayload,
} from './sync-payload.js'

const log = logger.child({ module: 'Sync' })

export const SYNC_TABLES = ANIME_SYNC_TABLES
export { MANGA_SYNC_TABLES, TV_SYNC_TABLES, ASMR_SYNC_TABLES }

export type SyncTable = (typeof SYNC_TABLES)[number]
export type MangaSyncTable = (typeof MANGA_SYNC_TABLES)[number]
export type TvSyncTable = (typeof TV_SYNC_TABLES)[number]
export type AsmrSyncTable = (typeof ASMR_SYNC_TABLES)[number]
export type AnimeSyncPayload = SyncPayload<SyncTable>
export type MangaSyncPayload = SyncPayload<MangaSyncTable>
export type TvSyncPayload = SyncPayload<TvSyncTable>
export type AsmrSyncPayload = SyncPayload<AsmrSyncTable>

export type MediaKind = 'anime' | 'manga' | 'tv' | 'asmr'

export const MEDIA_KINDS: MediaKind[] = ['anime', 'manga', 'tv', 'asmr']

export interface KindSyncDef {
  mid: '' | 'manga ' | 'TV ' | 'ASMR '
  Head: '' | 'Manga ' | 'TV ' | 'ASMR '
  rcloneLabel: string
  tables: readonly string[]
  libraryTables: readonly string[]
  backupName: string
  manifestPath: string
  rcloneFile: string
  githubDown: (db: DatabaseWrapper) => Promise<number>
  githubUp: (db: DatabaseWrapper) => Promise<void>
  googleDown: (db: DatabaseWrapper) => Promise<number>
  googleUp: (db: DatabaseWrapper) => Promise<void>
  githubVersion: () => Promise<number>
  googleVersion: () => Promise<number>
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

export const KIND_SYNC: Record<MediaKind, KindSyncDef> = {
  anime: {
    mid: '',
    Head: '',
    rcloneLabel: 'rclone',
    tables: SYNC_TABLES,
    libraryTables: ['watchlist', 'watched_episodes'],
    backupName: 'pre-sync-backup.db',
    manifestPath: CONFIG.LOCAL_MANIFEST_PATH,
    rcloneFile: CONFIG.RCLONE_SYNC_FILENAME,
    githubDown: (db) => githubSyncService.syncDown(db),
    githubUp: (db) => githubSyncService.syncUp(db),
    googleDown: (db) => googleDriveService.syncDown(db),
    githubVersion: () => githubSyncService.getRemoteVersion(),
    googleVersion: () => googleDriveService.getRemoteVersion(),
    googleUp: (db) => googleDriveService.syncUp(db),
  },
  manga: {
    mid: 'manga ',
    Head: 'Manga ',
    rcloneLabel: 'rclone manga',
    tables: MANGA_SYNC_TABLES,
    libraryTables: ['manga_library', 'manga_progress'],
    backupName: 'pre-sync-manga-backup.db',
    manifestPath: CONFIG.MANGA_LOCAL_MANIFEST_PATH,
    rcloneFile: CONFIG.MANGA_RCLONE_SYNC_FILENAME,
    githubDown: (db) => githubSyncService.syncMangaDown(db),
    githubUp: (db) => githubSyncService.syncMangaUp(db),
    googleDown: (db) => googleDriveService.syncMangaDown(db),
    githubVersion: () => githubSyncService.getMangaRemoteVersion(),
    googleVersion: () => googleDriveService.getMangaRemoteVersion(),
    googleUp: (db) => googleDriveService.syncMangaUp(db),
  },
  tv: {
    mid: 'TV ',
    Head: 'TV ',
    rcloneLabel: 'rclone tv',
    tables: TV_SYNC_TABLES,
    libraryTables: ['tv_library', 'tv_progress'],
    backupName: 'pre-sync-tv-backup.db',
    manifestPath: CONFIG.TV_LOCAL_MANIFEST_PATH,
    rcloneFile: CONFIG.TV_RCLONE_SYNC_FILENAME,
    githubDown: (db) => githubSyncService.syncTvDown(db),
    githubUp: (db) => githubSyncService.syncTvUp(db),
    googleDown: (db) => googleDriveService.syncTvDown(db),
    githubVersion: () => githubSyncService.getTvRemoteVersion(),
    googleVersion: () => googleDriveService.getTvRemoteVersion(),
    googleUp: (db) => googleDriveService.syncTvUp(db),
  },
  asmr: {
    mid: 'ASMR ',
    Head: 'ASMR ',
    rcloneLabel: 'rclone asmr',
    tables: ASMR_SYNC_TABLES,
    libraryTables: ['asmr_library', 'asmr_progress'],
    backupName: 'pre-sync-asmr-backup.db',
    manifestPath: CONFIG.ASMR_LOCAL_MANIFEST_PATH,
    rcloneFile: CONFIG.ASMR_RCLONE_SYNC_FILENAME,
    githubDown: (db) => githubSyncService.syncAsmrDown(db),
    githubUp: (db) => githubSyncService.syncAsmrUp(db),
    googleDown: (db) => googleDriveService.syncAsmrDown(db),
    githubVersion: () => githubSyncService.getAsmrRemoteVersion(),
    googleVersion: () => googleDriveService.getAsmrRemoteVersion(),
    googleUp: (db) => googleDriveService.syncAsmrUp(db),
  },
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
  kind: MediaKind,
  remoteFolder: string
): Promise<void> {
  const def = KIND_SYNC[kind]
  const payload = exportTables(db, def.tables)
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_${kind}_up.json`)
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2))
    await rcloneService.uploadFile(tempPath, remoteFolder, def.rcloneFile)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

async function rcloneSyncDown(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolder: string
): Promise<number> {
  const def = KIND_SYNC[kind]
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_${kind}_down.json`)
  try {
    await rcloneService.downloadFile(remoteFolder, def.rcloneFile, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = normalizePayload(JSON.parse(content), def.tables, def.rcloneLabel)
    importTables(db, def.tables, payload, {
      libraryTables: def.libraryTables,
      backupName: def.backupName,
    })
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

export async function getLocalManifestVersion(
  manifestPath: string = CONFIG.LOCAL_MANIFEST_PATH
): Promise<number> {
  if (existsSync(manifestPath)) {
    try {
      const content = await fs.readFile(manifestPath, 'utf-8')
      return JSON.parse(content).version || 0
    } catch {
      return 0
    }
  }
  return 0
}

export async function setLocalManifestVersion(
  version: number,
  manifestPath: string = CONFIG.LOCAL_MANIFEST_PATH
): Promise<void> {
  await fs.writeFile(manifestPath, JSON.stringify({ version }))
}

export function getKindManifestVersion(kind: MediaKind): Promise<number> {
  return getLocalManifestVersion(KIND_SYNC[kind].manifestPath)
}

export function setKindManifestVersion(kind: MediaKind, version: number): Promise<void> {
  return setLocalManifestVersion(version, KIND_SYNC[kind].manifestPath)
}

async function getRemoteManifestVersion(
  remoteFolder: string,
  kind: MediaKind = 'anime'
): Promise<{ version: number; fileId?: string }> {
  const def = KIND_SYNC[kind]
  const label = kind === 'anime' ? 'manifest' : `${def.mid.trim()} manifest`
  try {
    if (activeProvider === 'github') {
      if (!githubSyncService.isAuthenticated()) return { version: 0 }
      return { version: await def.githubVersion() }
    } else if (activeProvider === 'google') {
      if (!googleDriveService.isAuthenticated()) return { version: 0 }
      return { version: await def.googleVersion() }
    } else if (activeProvider === 'rclone') {
      return { version: await getRcloneRemotePayloadVersion(remoteFolder, def.rcloneFile) }
    }
  } catch (err) {
    log.warn({ err }, `Could not read remote ${label}.`)
  }
  return { version: 0 }
}

export async function syncDownOnBoot(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolderName: string,
  opts?: { dbPath: string; closeMainDb: () => Promise<void> }
): Promise<boolean> {
  const def = KIND_SYNC[kind]
  let localVersion = await getKindManifestVersion(kind)

  if (localVersion === 0 && db) {
    const row = dbGet<{ value: number }>(
      db,
      "SELECT value FROM sync_metadata WHERE key = 'db_version'"
    )
    localVersion = row?.value ?? 0
    if (localVersion > 0) {
      await setKindManifestVersion(kind, localVersion)
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
    notifySyncStart(`Initial ${def.mid}sync check (${activeProvider})`)
    const { version: remoteVersion } = await getRemoteManifestVersion(remoteFolderName, kind)
    notifySyncEnd()

    log.info(`${def.Head}Sync Check: Local v${localVersion} vs Remote v${remoteVersion}`)

    if (remoteVersion > localVersion) {
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return false
        notifySyncStart(`Importing GitHub ${def.mid}sync data (Remote v${remoteVersion})`)
        const importedVersion = await def.githubDown(db)
        await setKindManifestVersion(kind, importedVersion || remoteVersion)
        notifySyncEnd()
        log.info(`GitHub ${def.mid}sync down complete.`)
        return false
      }

      if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return false
        notifySyncStart(`Importing Google ${def.mid}sync data (Remote v${remoteVersion})`)
        const importedVersion = await def.googleDown(db)
        await setKindManifestVersion(kind, importedVersion || remoteVersion)
        notifySyncEnd()
        log.info(`Google ${def.mid}sync down complete.`)
        return false
      }

      if (activeProvider === 'rclone') {
        notifySyncStart(`Importing Rclone ${def.mid}sync data (Remote v${remoteVersion})`)
        const importedVersion = await rcloneSyncDown(db, kind, remoteFolderName)
        await setKindManifestVersion(kind, importedVersion || remoteVersion)
        notifySyncEnd()
        log.info(`Rclone ${def.mid}sync down complete.`)
        return false
      }

      if (opts) {
        notifySyncStart(`Downloading remote database (Remote v${remoteVersion})`)
        await opts.closeMainDb()

        const backupPath = `${opts.dbPath}.bak`

        try {
          if (existsSync(opts.dbPath)) {
            await fs.copyFile(opts.dbPath, backupPath)
          }

          try {
            await fs.unlink(`${opts.dbPath}-wal`)
          } catch (e) {
            void e
          }
          try {
            await fs.unlink(`${opts.dbPath}-shm`)
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
              await fs.copyFile(backupPath, opts.dbPath)
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
      }
    } else {
      log.info(`Local ${def.mid}DB is up to date.`)
    }
    return false
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, `${cap(`${def.mid}sync`)} boot error.`)
    return false
  } finally {
    isSyncing = false
    syncMutex.unlock()
  }
}

export async function syncUp(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolderName: string
): Promise<void> {
  const def = KIND_SYNC[kind]
  if (activeProvider === 'none') return

  await syncMutex.lock()
  if (isSyncing) {
    syncMutex.unlock()
    return
  }
  isSyncing = true

  try {
    const localVersion = await getKindManifestVersion(kind)
    const { version: remoteVersion } = await getRemoteManifestVersion(remoteFolderName, kind)

    if (localVersion > remoteVersion) {
      notifySyncStart(`Syncing ${def.mid}up (Local v${localVersion})`)
      if (activeProvider === 'github') {
        if (!githubSyncService.isAuthenticated()) return
        await def.githubUp(db)
      } else if (activeProvider === 'google') {
        if (!googleDriveService.isAuthenticated()) return
        await def.googleUp(db)
      } else if (activeProvider === 'rclone') {
        await rcloneSyncUp(db, kind, remoteFolderName)
      }

      notifySyncEnd()
      log.info(`${cap(`${def.mid}sync`)} up complete.`)
    } else {
      log.info(`No ${def.mid}changes to sync up or remote is newer.`)
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, `${cap(`${def.mid}sync`)} up failed.`)
  } finally {
    isSyncing = false
    syncMutex.unlock()
  }
}

export async function runFullSyncSequence(
  dbs: {
    db: DatabaseWrapper
    mangaDb: DatabaseWrapper
    tvDb: DatabaseWrapper
    asmrDb: DatabaseWrapper
  },
  opts: {
    dbPath: string
    remoteFolder: string
    preferredProvider?: 'github' | 'google' | 'rclone' | 'none'
    onAnimeDownloaded?: (db: DatabaseWrapper) => void
  }
): Promise<void> {
  await initSyncProvider(opts.preferredProvider)

  if (getActiveProvider() === 'github' && githubSyncService.isAuthenticated()) {
    try {
      await githubSyncService.migrateFromAniWebSync()
    } catch (err) {
      logger.error({ err }, 'GitHub sync migration from ani-web failed')
    }
  }

  const didDownload = await syncDownOnBoot(dbs.db, 'anime', opts.remoteFolder, {
    dbPath: opts.dbPath,
    closeMainDb: () => {
      return new Promise<void>((resolve) => {
        if (dbs.db && !dbs.db.isClosedCheck()) {
          dbs.db.checkpoint()
          dbs.db.close(() => resolve())
        } else {
          resolve()
        }
      })
    },
  })

  let currentDb = dbs.db
  if (didDownload) {
    currentDb = await initializeDatabase(opts.dbPath)
    opts.onAnimeDownloaded?.(currentDb)
    logger.info('Database re-initialized after sync.')
  }

  try {
    await syncUp(currentDb, 'anime', opts.remoteFolder)
  } catch (err) {
    logger.error({ err }, 'Sync up on boot failed')
  }

  const kinds: { kind: MediaKind; db: DatabaseWrapper }[] = [
    { kind: 'manga', db: dbs.mangaDb },
    { kind: 'tv', db: dbs.tvDb },
    { kind: 'asmr', db: dbs.asmrDb },
  ]
  for (const { kind, db } of kinds) {
    const def = KIND_SYNC[kind]
    try {
      await syncDownOnBoot(db, kind, opts.remoteFolder)
    } catch (err) {
      logger.error({ err }, `${def.Head}sync down on boot failed`)
    }
    try {
      await syncUp(db, kind, opts.remoteFolder)
    } catch (err) {
      logger.error({ err }, `${def.Head}sync up on boot failed`)
    }
  }
}

export async function performWriteTransactionAsync(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => Promise<void>,
  setVersion: (version: number) => Promise<void> = (v) => setLocalManifestVersion(v)
): Promise<void> {
  await runTx(db, async (tx) => {
    await runnable(tx)
    tx.run("UPDATE sync_metadata SET value = value + 1 WHERE key = 'db_version'")
  })

  const row = dbGet<{ value: number }>(
    db,
    "SELECT value FROM sync_metadata WHERE key = 'db_version'"
  )
  const newVersion = row?.value ?? 1

  await setVersion(newVersion)
}

export async function performMangaWriteTransactionAsync(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => Promise<void>
): Promise<void> {
  await performWriteTransactionAsync(db, runnable, (v) => setKindManifestVersion('manga', v))
}

export async function performTvWriteTransactionAsync(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => Promise<void>
): Promise<void> {
  await performWriteTransactionAsync(db, runnable, (v) => setKindManifestVersion('tv', v))
}

export async function performAsmrWriteTransactionAsync(
  db: DatabaseWrapper,
  runnable: (tx: DatabaseWrapper) => Promise<void>
): Promise<void> {
  await performWriteTransactionAsync(db, runnable, (v) => setKindManifestVersion('asmr', v))
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
      `CREATE TABLE IF NOT EXISTS manga_library (id TEXT PRIMARY KEY, provider TEXT NOT NULL, mangaId TEXT NOT NULL, title TEXT, cover TEXT, status TEXT DEFAULT 'Reading', author TEXT, contentRating TEXT, lastChapterId TEXT, lastChapterNumber TEXT, lastPage INTEGER, updatedAt INTEGER, altTitle TEXT, anilistId INTEGER, anilistIdSource TEXT)`
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
    if (!mangaColumns.some((c) => c.name === 'anilistId')) {
      db.run(`ALTER TABLE manga_library ADD COLUMN anilistId INTEGER`)
    }
    if (!mangaColumns.some((c) => c.name === 'anilistIdSource')) {
      db.run(`ALTER TABLE manga_library ADD COLUMN anilistIdSource TEXT`)
    }
    db.run(`CREATE INDEX IF NOT EXISTS idx_manga_library_anilist ON manga_library(anilistId)`)

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
      `CREATE TABLE IF NOT EXISTS tv_progress (mediaId TEXT NOT NULL, season INTEGER NOT NULL, episode INTEGER NOT NULL, currentTime REAL DEFAULT 0, duration REAL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER, PRIMARY KEY (mediaId, season, episode))`
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
    if (!tvProgressColumns.some((c) => c.name === 'completed')) {
      db.run(`ALTER TABLE tv_progress ADD COLUMN completed INTEGER NOT NULL DEFAULT 0`)
    }
    db.run(
      `UPDATE tv_progress SET completed = 1 WHERE completed = 0 AND duration > 0 AND currentTime >= duration * 0.8`
    )
    db.run(
      `CREATE TRIGGER IF NOT EXISTS trg_tv_progress_completed_insert
       AFTER INSERT ON tv_progress
       WHEN NEW.duration > 0 AND NEW.currentTime >= NEW.duration * 0.8
       BEGIN
         UPDATE tv_progress SET completed = 1
         WHERE mediaId = NEW.mediaId AND season = NEW.season AND episode = NEW.episode;
       END`
    )
    db.run(`DROP TRIGGER IF EXISTS trg_tv_progress_completed_update`)
    db.run(
      `CREATE TRIGGER IF NOT EXISTS trg_tv_progress_completed_update
       AFTER UPDATE OF currentTime, duration ON tv_progress
       WHEN NEW.duration > 0 AND NEW.currentTime >= NEW.duration * 0.8
       BEGIN
         UPDATE tv_progress SET completed = 1
         WHERE mediaId = NEW.mediaId AND season = NEW.season AND episode = NEW.episode;
       END`
    )
    db.run(
      `UPDATE tv_progress SET completed = 0 WHERE completed = 1 AND NOT (duration > 0 AND currentTime >= duration * 0.8)`
    )

    db.run(
      `UPDATE OR IGNORE tv_progress SET mediaId = REPLACE(mediaId, '-', ':') WHERE mediaId LIKE 'tv-%' OR mediaId LIKE 'movie-%'`
    )
    db.run(`DELETE FROM tv_progress WHERE mediaId LIKE 'tv-%' OR mediaId LIKE 'movie-%'`)

    return db
  } catch (err) {
    log.error({ err }, 'TV database opening error')
    throw err
  }
}

export async function initializeAsmrDatabase(dbPath: string): Promise<DatabaseWrapper> {
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
      `CREATE TABLE IF NOT EXISTS asmr_library (id TEXT PRIMARY KEY, rjCode TEXT NOT NULL, title TEXT, thumbnail TEXT, status TEXT DEFAULT 'Listening', isAdult INTEGER DEFAULT 0, lastTrackIndex INTEGER, lastTrackLabel TEXT, lastPosition REAL, updatedAt INTEGER)`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS asmr_progress (workId TEXT NOT NULL, trackIndex INTEGER NOT NULL, trackLabel TEXT, currentTime REAL DEFAULT 0, duration REAL DEFAULT 0, updatedAt INTEGER, PRIMARY KEY (workId, trackIndex))`
    )
    db.run(`CREATE TABLE IF NOT EXISTS sync_metadata (key TEXT PRIMARY KEY, value INTEGER)`)
    db.run(`INSERT OR IGNORE INTO sync_metadata (key, value) VALUES ('db_version', 1)`)

    db.run(`CREATE INDEX IF NOT EXISTS idx_asmr_library_status ON asmr_library(status)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_asmr_library_rjcode ON asmr_library(rjCode)`)
    db.run(`CREATE INDEX IF NOT EXISTS idx_asmr_progress_work ON asmr_progress(workId, updatedAt)`)

    const asmrProgressColumns = db.all<{ name: string }>(`PRAGMA table_info(asmr_progress)`)
    if (!asmrProgressColumns.some((c) => c.name === 'title')) {
      db.run(`ALTER TABLE asmr_progress ADD COLUMN title TEXT`)
    }
    if (!asmrProgressColumns.some((c) => c.name === 'thumbnail')) {
      db.run(`ALTER TABLE asmr_progress ADD COLUMN thumbnail TEXT`)
    }
    if (!asmrProgressColumns.some((c) => c.name === 'rjCode')) {
      db.run(`ALTER TABLE asmr_progress ADD COLUMN rjCode TEXT`)
    }
    if (!asmrProgressColumns.some((c) => c.name === 'isAdult')) {
      db.run(`ALTER TABLE asmr_progress ADD COLUMN isAdult INTEGER`)
    }

    return db
  } catch (err) {
    log.error({ err }, 'ASMR database opening error')
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
      const purged = await TempShowIdsRepository.purge(db)
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

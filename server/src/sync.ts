import { profileService, profileEnv, profileScope } from './profile-scope.js'
import * as fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import logger from './logger.js'
import { getGoogleDriveService } from './google.js'
import { getRcloneService } from './rclone.js'
import { getGitHubSyncService } from './github-sync.js'
import { CONFIG } from './config.js'
import { DatabaseWrapper } from './db.js'
import { getLocalManifestVersion, setLocalManifestVersion } from './db/transaction.js'
import { dbGet } from './utils/db-utils.js'
import { notifySyncStart, notifySyncEnd } from './lib/ipc.js'
import {
  exportTables,
  importTables,
  normalizePayload,
  readPayloadVersion,
  type SyncPayload,
} from './sync-payload.js'
import { SYNC_KINDS, withLabel, type SyncBackend, type SyncKind } from './sync-backend.js'

const log = logger.child({ module: 'Sync' })

export type MediaKind = SyncKind

export interface KindSyncDef {
  rcloneLabel: string
  manifestPath: string
  rcloneFile: string
}

export const KIND_SYNC: Record<MediaKind, KindSyncDef> = {
  anime: {
    rcloneLabel: 'rclone',
    get manifestPath() {
      return CONFIG.LOCAL_MANIFEST_PATH
    },
    rcloneFile: CONFIG.RCLONE_SYNC_FILENAME,
  },
  manga: {
    rcloneLabel: 'rclone manga',
    get manifestPath() {
      return CONFIG.MANGA_LOCAL_MANIFEST_PATH
    },
    rcloneFile: CONFIG.MANGA_RCLONE_SYNC_FILENAME,
  },
  tv: {
    rcloneLabel: 'rclone tv',
    get manifestPath() {
      return CONFIG.TV_LOCAL_MANIFEST_PATH
    },
    rcloneFile: CONFIG.TV_RCLONE_SYNC_FILENAME,
  },
  asmr: {
    rcloneLabel: 'rclone asmr',
    get manifestPath() {
      return CONFIG.ASMR_LOCAL_MANIFEST_PATH
    },
    rcloneFile: CONFIG.ASMR_RCLONE_SYNC_FILENAME,
  },
}

function cap(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

async function getRcloneRemotePayloadVersion(
  remoteFolder: string,
  fileName: string
): Promise<number> {
  const exists = await getRcloneService().fileExists(remoteFolder, fileName)
  if (!exists) return 0
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_sync.json`)
  try {
    await getRcloneService().downloadFile(remoteFolder, fileName, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = JSON.parse(content) as SyncPayload<string>
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
  const payload = exportTables(db, SYNC_KINDS[kind].tables)
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_${kind}_up.json`)
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2))
    await getRcloneService().uploadFile(tempPath, remoteFolder, KIND_SYNC[kind].rcloneFile)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

async function rcloneSyncDown(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolder: string
): Promise<number> {
  const config = SYNC_KINDS[kind]
  const tempPath = path.join(CONFIG.ROOT, `temp_${Date.now()}_rclone_${kind}_down.json`)
  try {
    await getRcloneService().downloadFile(remoteFolder, KIND_SYNC[kind].rcloneFile, tempPath)
    const content = await fs.readFile(tempPath, 'utf-8')
    const payload = normalizePayload(
      JSON.parse(content),
      config.tables,
      KIND_SYNC[kind].rcloneLabel
    )
    importTables(db, config.tables, payload, {
      libraryTables: config.libraryTables,
      backupName: config.backupName,
    })
    return readPayloadVersion(payload)
  } finally {
    if (existsSync(tempPath)) await fs.unlink(tempPath).catch(() => {})
  }
}

const rcloneBackend: SyncBackend = {
  name: 'rclone',
  label: 'Rclone',
  isAuthenticated: () => getRcloneService().isActive(),
  version: (kind, { remoteFolder }) =>
    getRcloneRemotePayloadVersion(remoteFolder, KIND_SYNC[kind].rcloneFile),
  up: (kind, db, { remoteFolder }) => rcloneSyncUp(db, kind, remoteFolder),
  down: (kind, db, { remoteFolder }) => rcloneSyncDown(db, kind, remoteFolder),
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
    const resolve = this._waiting.shift()
    if (resolve) resolve()
    else this._locked = false
  }
}

const syncState = profileService(() => ({
  syncMutexes: Object.fromEntries(
    Object.keys(KIND_SYNC).map((kind) => [kind, new Mutex()])
  ) as Record<MediaKind, Mutex>,
  isSyncingMap: {} as Record<MediaKind, boolean>,
  activeProvider: 'none' as 'github' | 'google' | 'rclone' | 'none',
}))

function activeBackend(): SyncBackend | null {
  if (profileScope.getStore()?.deleted) return null
  if (syncState().activeProvider === 'github') return getGitHubSyncService()
  if (syncState().activeProvider === 'google') return getGoogleDriveService()
  if (syncState().activeProvider === 'rclone') return rcloneBackend
  return null
}

export async function waitForSync(): Promise<void> {
  await Promise.all(
    (Object.values(syncState().syncMutexes) as Mutex[]).map(async (m) => {
      await m.lock()
      m.unlock()
    })
  )
}

export function getActiveProvider() {
  return syncState().activeProvider
}

async function selectProvider(provider: 'github' | 'google' | 'rclone' | 'none') {
  syncState().activeProvider = 'none'
  if (provider === 'github' || provider === 'google') {
    const account =
      provider === 'github'
        ? (await getGitHubSyncService().getUserProfile())?.login
        : (await getGoogleDriveService().getUserProfile())?.id
    if (!account) throw new Error('Could not verify cloud account. Reconnect and try again.')
    try {
      profileScope.getStore()?.claimCloud?.(provider, account)
    } catch (error) {
      if (provider === 'github') await getGitHubSyncService().logout()
      else await getGoogleDriveService().logout()
      throw error
    }
  }
  syncState().activeProvider = provider
}

export async function initSyncProvider(
  preferred?: 'github' | 'google' | 'rclone' | 'none'
): Promise<void> {
  if (profileScope.getStore()?.deleted) return
  const provider =
    preferred ||
    (profileEnv('SYNC_PROVIDER') as 'github' | 'google' | 'rclone' | 'none' | undefined)

  if (provider === 'github' && getGitHubSyncService().isAuthenticated()) {
    await selectProvider('github')
    log.info('Sync Provider: GitHub (Selected)')
    return
  }

  if (provider === 'google' && getGoogleDriveService().isAuthenticated()) {
    await selectProvider('google')
    log.info('Sync Provider: Google Drive API (Selected)')
    return
  }

  if (provider === 'rclone') {
    const rcloneAvailable = await getRcloneService().init()
    if (rcloneAvailable) {
      await selectProvider('rclone')
      log.info(`Sync Provider: Rclone (${getRcloneService().getRemoteName()}) (Selected)`)
      return
    }
  }

  if (provider === 'none') {
    await selectProvider('none')
    log.info('Sync Provider: None (Forced)')
    return
  }

  if (getGitHubSyncService().isAuthenticated()) {
    await selectProvider('github')
    log.info('Sync Provider: GitHub (Fallback)')
    return
  }

  if (getGoogleDriveService().isAuthenticated()) {
    await selectProvider('google')
    log.info('Sync Provider: Google Drive API (Fallback)')
    return
  }

  const rcloneAvailable = await getRcloneService().init()
  if (rcloneAvailable) {
    await selectProvider('rclone')
    log.info(`Sync Provider: Rclone (${getRcloneService().getRemoteName()}) (Fallback)`)
    return
  }

  await selectProvider('none')
  log.info('No sync provider available.')
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
  const backend = activeBackend()
  if (!backend) return { version: 0 }
  try {
    if (!backend.isAuthenticated()) return { version: 0 }
    return { version: await backend.version(kind, { remoteFolder }) }
  } catch (err) {
    log.warn({ err }, `Could not read remote ${withLabel(SYNC_KINDS[kind].label, 'manifest')}.`)
  }
  return { version: 0 }
}

export async function syncDownOnBoot(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolderName: string
): Promise<number> {
  const label = SYNC_KINDS[kind].label
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

  const backend = activeBackend()
  if (!backend) return -1

  const mutex = syncState().syncMutexes[kind]
  await mutex.lock()
  if (profileScope.getStore()?.deleted || syncState().isSyncingMap[kind]) {
    mutex.unlock()
    return -1
  }
  syncState().isSyncingMap[kind] = true

  try {
    notifySyncStart(`Initial ${withLabel(label, 'sync check')} (${syncState().activeProvider})`)
    const { version: remoteVersion } = await getRemoteManifestVersion(remoteFolderName, kind)
    notifySyncEnd()

    log.info(
      `${withLabel(label, 'Sync Check')}: Local v${localVersion} vs Remote v${remoteVersion}`
    )

    if (remoteVersion > localVersion) {
      notifySyncStart(
        `Importing ${backend.label} ${withLabel(label, 'sync data')} (Remote v${remoteVersion})`
      )
      if (profileScope.getStore()?.deleted) return -1
      const importedVersion = await backend.down(kind, db, { remoteFolder: remoteFolderName })
      await setKindManifestVersion(kind, importedVersion || remoteVersion)
      notifySyncEnd()
      log.info(`${backend.label} ${withLabel(label, 'sync down complete.')}`)
      return remoteVersion
    }

    log.info(`Local ${withLabel(label, 'DB is up to date.')}`)
    return remoteVersion
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, `${cap(withLabel(label, 'sync'))} boot error.`)
    return -1
  } finally {
    syncState().isSyncingMap[kind] = false
    mutex.unlock()
  }
}

export async function syncUp(
  db: DatabaseWrapper,
  kind: MediaKind,
  remoteFolderName: string,
  knownRemoteVersion?: number
): Promise<void> {
  const label = SYNC_KINDS[kind].label
  const backend = activeBackend()
  if (!backend) return

  const mutex = syncState().syncMutexes[kind]
  await mutex.lock()
  if (profileScope.getStore()?.deleted || syncState().isSyncingMap[kind]) {
    mutex.unlock()
    return
  }
  syncState().isSyncingMap[kind] = true

  try {
    const localVersion = await getKindManifestVersion(kind)
    const remoteVersion =
      knownRemoteVersion !== undefined && knownRemoteVersion >= 0
        ? knownRemoteVersion
        : (await getRemoteManifestVersion(remoteFolderName, kind)).version

    if (localVersion > remoteVersion) {
      if (!backend.isAuthenticated()) return
      notifySyncStart(`Syncing ${withLabel(label, 'up')} (Local v${localVersion})`)
      if (profileScope.getStore()?.deleted) return
      await backend.up(kind, db, { remoteFolder: remoteFolderName })

      notifySyncEnd()
      log.info(`${cap(withLabel(label, 'sync up complete.'))}`)
    } else {
      log.info(`No ${withLabel(label, 'changes to sync up or remote is newer.')}`)
    }
  } catch (err) {
    notifySyncEnd()
    log.error({ err }, `${cap(withLabel(label, 'sync up failed.'))}`)
  } finally {
    syncState().isSyncingMap[kind] = false
    mutex.unlock()
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
    remoteFolder: string
    preferredProvider?: 'github' | 'google' | 'rclone' | 'none'
  }
): Promise<void> {
  await initSyncProvider(opts.preferredProvider)

  if (getActiveProvider() === 'github' && getGitHubSyncService().isAuthenticated()) {
    try {
      await getGitHubSyncService().migrateFromAniWebSync()
    } catch (err) {
      logger.error({ err }, 'GitHub sync migration from ani-web failed')
    }
  }

  // Anime runs first and sequentially - it may sync down data
  const animeRemoteVersion = await syncDownOnBoot(dbs.db, 'anime', opts.remoteFolder).catch(
    (err) => {
      logger.error({ err }, 'Sync down on boot failed')
      return -1 as number
    }
  )
  await syncUp(dbs.db, 'anime', opts.remoteFolder, animeRemoteVersion).catch((err) =>
    logger.error({ err }, 'Sync up on boot failed')
  )

  // manga / TV / ASMR are independent - check + up in parallel
  const secondary: { kind: MediaKind; db: DatabaseWrapper }[] = [
    { kind: 'manga', db: dbs.mangaDb },
    { kind: 'tv', db: dbs.tvDb },
    { kind: 'asmr', db: dbs.asmrDb },
  ]
  await Promise.allSettled(
    secondary.map(async ({ kind, db }) => {
      const label = SYNC_KINDS[kind].label
      const remoteVersion = await syncDownOnBoot(db, kind, opts.remoteFolder).catch((err) => {
        logger.error({ err }, `${withLabel(label, 'sync down on boot failed')}`)
        return -1 as number
      })
      await syncUp(db, kind, opts.remoteFolder, remoteVersion).catch((err) =>
        logger.error({ err }, `${withLabel(label, 'sync up on boot failed')}`)
      )
    })
  )
}

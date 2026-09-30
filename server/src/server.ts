process.setMaxListeners(100)
import { EventEmitter } from 'events'
EventEmitter.defaultMaxListeners = 100
import path from 'path'
import { AppCache } from './utils/cache.utils.js'
import fs from 'fs'
import crypto from 'crypto'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { getConnInfo } from '@hono/node-server/conninfo'
import { DatabaseWrapper } from './db.js'
import logger from './logger.js'
import { notifyServerExit } from './lib/ipc.js'

import { CONFIG } from './config.js'
import {
  initializeDatabase,
  initializeMangaDatabase,
  initializeTvDatabase,
  initializeAsmrDatabase,
  runFullSyncSequence,
  syncUp,
  waitForSync,
  KIND_SYNC,
  type MediaKind,
} from './sync.js'
import { isJasmrApi } from './hono/asmr.js'
import type { MangaProvider } from './providers/manga/manga.types.js'
import type { TvProvider } from './providers/tv.types.js'
import { loadRemoteProviders } from './providers/remote-loader.js'
import type { ProviderCatalogItem } from './providers/remote-types.js'
import type { Provider } from './providers/provider.interface.js'
import { discordRPCService } from './discord-rpc.js'
import { discordGatewayService } from './discord-gateway.js'
import { SettingsRepository } from './repositories/settings.repository.js'
import { createHonoApp } from './app-hono.js'
import { startWatchlistDiscovery, stopWatchlistDiscovery } from './hono/watchlist.js'
import { checkAnilistStatus } from './lib/anilist.js'
import { offlineDb } from './lib/offline-db.js'
import { initDiscordRolesSync } from './lib/discord-roles-sync.service.js'

const app = createHonoApp(
  () => ({ shuttingDown: isShuttingDown, dbReady: !!db }),
  () => ({
    shuttingDown: isShuttingDown,
    dbsReady: !!db && !!mangaDb && !!tvDb && !!asmrDb,
    bootSyncing,
  }),
  () => ({ db, mangaDb, tvDb, asmrDb }),
  {
    initializeDatabase,
    setDb: (newDb) => {
      db = newDb
    },
  },
  {
    getCatalog: getProviderCatalog,
    refresh: refreshRemoteProviders,
  },
  runSyncSequence,
  {
    getApiCache: () => apiCache,
    getProviders: () => providers,
    getMangaProvider: (name) => mangaProviders[name],
    getTvProvider: (name) => tvProviders[name],
    getJasmr: () => {
      const mod = providers['jasmr']
      return isJasmrApi(mod) ? mod : undefined
    },
  }
)

const apiCache = new AppCache({ ttlSeconds: 3600, maxKeys: 5000 })

const providers: Record<string, Provider> = {}
const mangaProviders: Record<string, MangaProvider> = {}
const tvProviders: Record<string, TvProvider> = {}

let remoteCatalog: ProviderCatalogItem[] = []

function parseEnabledProviders(): string[] {
  return CONFIG.PROVIDER_ENABLED.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function getProviderCatalog(): ProviderCatalogItem[] {
  return remoteCatalog
}

async function refreshRemoteProviders(): Promise<ProviderCatalogItem[]> {
  const url = CONFIG.PROVIDER_REPO_URL.trim()
  if (!url) return getProviderCatalog()
  try {
    const result = await loadRemoteProviders({
      cache: apiCache,
      registryUrl: url,
      enabledProviders: parseEnabledProviders(),
    })
    if (result.catalog.length === 0) {
      logger.warn('remote providers refresh returned nothing, keeping current set')
      return getProviderCatalog()
    }
    for (const key of Object.keys(providers)) {
      if (!(key in result.providers)) delete providers[key]
    }
    Object.assign(providers, result.providers)
    for (const key of Object.keys(mangaProviders)) {
      if (!(key in result.mangaProviders)) delete mangaProviders[key]
    }
    Object.assign(mangaProviders, result.mangaProviders)
    for (const key of Object.keys(tvProviders)) {
      if (!(key in result.tvProviders)) delete tvProviders[key]
    }
    Object.assign(tvProviders, result.tvProviders)
    remoteCatalog = result.catalog
    logger.info(
      {
        count: Object.keys(result.providers).length,
        mangaCount: Object.keys(result.mangaProviders).length,
        tvCount: Object.keys(result.tvProviders).length,
      },
      'remote providers refreshed'
    )
  } catch (err) {
    logger.error({ err }, 'remote providers refresh failed')
  }
  return getProviderCatalog()
}

let db: DatabaseWrapper
let mangaDb: DatabaseWrapper
let tvDb: DatabaseWrapper
let asmrDb: DatabaseWrapper
let isShuttingDown = false
let bootSyncing = true

async function runSyncSequence(
  database: DatabaseWrapper,
  mangaDatabase: DatabaseWrapper,
  preferredProvider?: 'github' | 'google' | 'rclone' | 'none'
) {
  const remoteFolder = CONFIG.IS_DEV ? CONFIG.REMOTE_FOLDER_DEV : CONFIG.REMOTE_FOLDER_PROD

  await runFullSyncSequence(
    { db: database, mangaDb: mangaDatabase, tvDb, asmrDb },
    { remoteFolder, preferredProvider }
  )
}

startWatchlistDiscovery(() => db)

if (!CONFIG.IS_DEV) {
  const frontendPath = path.join(CONFIG.PACKAGE_ROOT, 'client', 'dist')
  logger.info(`Serving frontend from: ${frontendPath}`)
  app.use('/*', serveStatic({ root: frontendPath }))

  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound()
    try {
      const html = await fs.promises.readFile(path.join(frontendPath, 'index.html'), 'utf8')
      return c.html(html)
    } catch (err) {
      logger.error({ err }, `Failed to serve index.html from ${frontendPath}`)
      return c.text('Server Error: Frontend build not found.', 500)
    }
  })
}

async function main() {
  const dbName = CONFIG.IS_DEV ? CONFIG.DB_NAME_DEV : CONFIG.DB_NAME_PROD
  const dbPath = path.join(CONFIG.ROOT, dbName)
  const remoteFolder = CONFIG.IS_DEV ? CONFIG.REMOTE_FOLDER_DEV : CONFIG.REMOTE_FOLDER_PROD

  db = await initializeDatabase(dbPath)
  logger.info(`Database initialized at ${dbPath}`)

  const mangaDbName = CONFIG.IS_DEV ? CONFIG.MANGA_DB_NAME_DEV : CONFIG.MANGA_DB_NAME_PROD
  const mangaDbPath = path.join(CONFIG.ROOT, mangaDbName)
  mangaDb = await initializeMangaDatabase(mangaDbPath)
  logger.info(`Manga database initialized at ${mangaDbPath}`)

  const tvDbName = CONFIG.IS_DEV ? CONFIG.TV_DB_NAME_DEV : CONFIG.TV_DB_NAME_PROD
  const tvDbPath = path.join(CONFIG.ROOT, tvDbName)
  tvDb = await initializeTvDatabase(tvDbPath)
  logger.info(`TV database initialized at ${tvDbPath}`)

  const asmrDbName = CONFIG.IS_DEV ? CONFIG.ASMR_DB_NAME_DEV : CONFIG.ASMR_DB_NAME_PROD
  const asmrDbPath = path.join(CONFIG.ROOT, asmrDbName)
  asmrDb = await initializeAsmrDatabase(asmrDbPath)
  logger.info(`ASMR database initialized at ${asmrDbPath}`)

  await offlineDb.init(db)
  if (await offlineDb.checkWeeklyUpdateDue(db)) {
    logger.info('Weekly offline database update is due on startup, starting background update...')
    offlineDb.executeScheduledUpdate(db).catch((err) => {
      logger.warn({ err: err?.message }, 'Startup scheduled offline database update failed')
    })
  }

  const rpcEnabledSetting = await SettingsRepository.getByKey(db, 'discordRPCEnabled')
  const isRpcEnabled = rpcEnabledSetting ? rpcEnabledSetting.value === 'true' : true
  await discordRPCService.setEnabled(isRpcEnabled)
  discordGatewayService.setEnabled(isRpcEnabled)

  checkAnilistStatus().catch(() => {})
  initDiscordRolesSync(db)

  if (CONFIG.PROVIDER_REPO_URL.trim()) {
    setInterval(() => {
      refreshRemoteProviders().catch((err) =>
        logger.error({ err }, 'periodic providers refresh failed')
      )
    }, CONFIG.PROVIDER_REPO_REFRESH_MS).unref()
  }

  const kindDbs = (): Record<MediaKind, DatabaseWrapper> => ({
    anime: db,
    manga: mangaDb,
    tv: tvDb,
    asmr: asmrDb,
  })

  for (const kind of Object.keys(KIND_SYNC) as MediaKind[]) {
    if (!fs.existsSync(KIND_SYNC[kind].manifestPath)) {
      fs.writeFileSync(KIND_SYNC[kind].manifestPath, JSON.stringify({ version: 0 }))
    }
  }

  const unsynced: Record<MediaKind, boolean> = {
    anime: false,
    manga: false,
    tv: false,
    asmr: false,
  }
  const watchers = (Object.keys(KIND_SYNC) as MediaKind[]).map((kind) =>
    fs.watch(KIND_SYNC[kind].manifestPath, (eventType) => {
      if (eventType === 'change' || eventType === 'rename') {
        unsynced[kind] = true
      }
    })
  )

  const server = serve({ fetch: app.fetch, port: CONFIG.PORT }, () => {
    logger.info(`Server running on http://localhost:${CONFIG.PORT}`)
  })

  runSyncSequence(db, mangaDb)
    .catch((err) => logger.error({ err }, 'background boot sync failed'))
    .finally(() => {
      bootSyncing = false
    })
  refreshRemoteProviders().catch((err) =>
    logger.error({ err }, 'background providers refresh failed')
  )

  const kindDbLabel: Record<MediaKind, string> = {
    anime: 'database',
    manga: 'manga database',
    tv: 'TV database',
    asmr: 'ASMR database',
  }

  const syncInterval = setInterval(async () => {
    for (const kind of Object.keys(KIND_SYNC) as MediaKind[]) {
      if (!unsynced[kind]) continue
      logger.info(`Uploading accumulated ${kindDbLabel[kind]} changes...`)
      unsynced[kind] = false
      try {
        await syncUp(kindDbs()[kind], kind, remoteFolder)
      } catch (err) {
        logger.error({ err }, `Failed to upload ${kindDbLabel[kind]} changes`)
        unsynced[kind] = true
      }
    }
  }, 300000)

  const offlineDbInterval = setInterval(
    async () => {
      if (await offlineDb.checkWeeklyUpdateDue(db)) {
        logger.info('Weekly offline database update triggered by periodic schedule...')
        offlineDb.executeScheduledUpdate(db).catch((err) => {
          logger.warn({ err: err?.message }, 'Interval scheduled offline database update failed')
        })
      }
    },
    6 * 60 * 60 * 1000
  )
  offlineDbInterval.unref()

  const shutdown = async (signal?: string) => {
    if (isShuttingDown) return
    isShuttingDown = true
    stopWatchlistDiscovery()
    clearInterval(syncInterval)
    clearInterval(offlineDbInterval)
    discordRPCService.disconnect()
    discordGatewayService.shutdown()
    for (const watcher of watchers) {
      await watcher.close()
    }

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    const kindFinalError: Record<MediaKind, string> = {
      anime: 'Final sync on shutdown failed',
      manga: 'Final manga sync on shutdown failed',
      tv: 'Final TV sync on shutdown failed',
      asmr: 'Final ASMR sync on shutdown failed',
    }

    for (const kind of Object.keys(KIND_SYNC) as MediaKind[]) {
      if (!unsynced[kind]) continue
      logger.info(`Sync on shutdown: uploading final ${kindDbLabel[kind]} changes...`)
      unsynced[kind] = false
      try {
        await syncUp(kindDbs()[kind], kind, remoteFolder)
      } catch (e) {
        logger.error({ err: e }, kindFinalError[kind])
      }
    }

    await waitForSync()

    asmrDb.close(() => {})
    tvDb.close(() => {})
    mangaDb.close(() => {})
    db.close(() => {
      notifyServerExit()
      if (signal === 'SIGUSR2') {
        process.kill(process.pid, 'SIGUSR2')
      } else {
        setTimeout(() => process.exit(0), 100).unref()
      }
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGHUP', () => shutdown('SIGHUP'))
  process.once('SIGUSR2', () => shutdown('SIGUSR2'))

  app.post('/api/internal/shutdown', (c) => {
    let remoteAddress: string
    try {
      remoteAddress = getConnInfo(c).remote.address ?? ''
    } catch {
      remoteAddress = ''
    }
    const isLoopback =
      remoteAddress === '::1' ||
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::ffff:127.0.0.1'
    if (!isLoopback) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    const expectedToken = process.env.INTERNAL_SHUTDOWN_TOKEN
    const providedToken = c.req.header('x-internal-token')
    if (expectedToken) {
      const expBuf = Buffer.from(expectedToken)
      const provBuf = Buffer.from(typeof providedToken === 'string' ? providedToken : '')
      if (expBuf.length !== provBuf.length || !crypto.timingSafeEqual(expBuf, provBuf)) {
        logger.warn('Unauthorized internal shutdown attempt rejected: invalid token')
        return c.json({ error: 'Forbidden' }, 403)
      }
    }

    const response = c.json({ message: 'Shutting down' })
    setTimeout(() => shutdown(), 500)
    return response
  })
}

main().catch((err) => {
  logger.error({ err }, 'Server failed to start')
  process.exit(1)
})

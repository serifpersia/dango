import { closeTrackerActivityStreams } from './hono/tracker-activity.js'
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
import { runFullSyncSequence, syncUp, waitForSync, type MediaKind } from './sync.js'
import {
  initializeDatabase,
  initializeMangaDatabase,
  initializeTvDatabase,
  initializeAsmrDatabase,
} from './db/ddl.js'
import type { JasmrApi } from './providers/asmr/asmr.types.js'
import type { MangaProvider } from './providers/manga/manga.types.js'
import type { TvProvider } from './providers/tv.types.js'
import { loadRemoteProviders } from './providers/remote-loader.js'
import type { ProviderCatalogItem, RemoteProxyRule } from './providers/remote-types.js'
import type { Provider } from './providers/provider.interface.js'
import { discordRPCService } from './discord-rpc.js'
import { discordGatewayService } from './discord-gateway.js'
import { SettingsRepository } from './repositories/settings.repository.js'
import { createHonoApp } from './app-hono.js'
import { startWatchlistDiscovery, stopWatchlistDiscovery } from './lib/watchlist-discovery.js'
import { checkAnilistStatus } from './lib/anilist/index.js'
import { offlineDb } from './lib/offline-db/index.js'
import { requestMalImportCancel } from './lib/mal-import.js'
import { ProfileStore } from './profiles.js'
import { profileScope, profileService } from './profile-scope.js'

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
      const scoped = profileScope.getStore()?.dbs
      if (scoped) scoped.db = newDb
      if (!scoped || profileScope.getStore()?.id === 'default') db = newDb
    },
  },
  {
    getCatalog: getProviderCatalog,
    refresh: refreshRemoteProviders,
  },
  runSyncSequence,
  {
    getApiCache: profileService(() => new AppCache({ ttlSeconds: 3600, maxKeys: 5000 })),
    getProviders: () => providers,
    getMangaProvider: (name) => mangaProviders[name],
    getTvProvider: (name) => tvProviders[name],
    getProxyRules: () => proxyRules,
    getJasmr: () => asmrProviders['jasmr'],
  },
  () => profiles
)

const apiCache = new AppCache({ ttlSeconds: 3600, maxKeys: 5000 })

const providers: Record<string, Provider> = {}
const mangaProviders: Record<string, MangaProvider> = {}
const tvProviders: Record<string, TvProvider> = {}
const asmrProviders: Record<string, JasmrApi> = {}
let proxyRules: RemoteProxyRule[] = []

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
    if (!result.registryLoaded) {
      logger.warn('remote providers registry unavailable, keeping current set')
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
    for (const key of Object.keys(asmrProviders)) {
      if (!(key in result.asmrProviders)) delete asmrProviders[key]
    }
    Object.assign(asmrProviders, result.asmrProviders)
    proxyRules = result.proxyRules
    remoteCatalog = result.catalog
    logger.info(
      {
        count: result.catalog.filter((c) => c.kind === 'anime' && c.loaded).length,
        mangaCount: Object.keys(result.mangaProviders).length,
        tvCount: Object.keys(result.tvProviders).length,
        asmrCount: Object.keys(result.asmrProviders).length,
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
let profiles: ProfileStore | undefined

async function runSyncSequence(
  database: DatabaseWrapper,
  mangaDatabase: DatabaseWrapper,
  preferredProvider?: 'github' | 'google' | 'rclone' | 'none'
) {
  const remoteFolder = CONFIG.IS_DEV ? CONFIG.REMOTE_FOLDER_DEV : CONFIG.REMOTE_FOLDER_PROD

  await runFullSyncSequence(
    {
      db: database,
      mangaDb: mangaDatabase,
      tvDb: profileScope.getStore()?.dbs?.tvDb ?? tvDb,
      asmrDb: profileScope.getStore()?.dbs?.asmrDb ?? asmrDb,
    },
    { remoteFolder, preferredProvider }
  )
}

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

  profiles = new ProfileStore()
  profiles.attachDefault({ db, mangaDb, tvDb, asmrDb })
  profiles.onOpen = async (dbs) => {
    await runFullSyncSequence(dbs, { remoteFolder }).catch((err) =>
      logger.error({ err }, 'Profile boot sync failed')
    )
    if (!profileScope.getStore()?.deleted) startWatchlistDiscovery(() => dbs.db)
  }
  profiles.onDelete = (dbs) => {
    stopWatchlistDiscovery()
    requestMalImportCancel()
    closeTrackerActivityStreams(dbs.db)
  }
  profileScope.run(profiles.scope('default'), () => startWatchlistDiscovery(() => db))

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

  if (CONFIG.PROVIDER_REPO_URL.trim()) {
    setInterval(() => {
      refreshRemoteProviders().catch((err) =>
        logger.error({ err }, 'periodic providers refresh failed')
      )
    }, CONFIG.PROVIDER_REPO_REFRESH_MS).unref()
  }

  const server = serve({ fetch: app.fetch, port: CONFIG.PORT }, () => {
    logger.info(`Server running on http://localhost:${CONFIG.PORT}`)
  })

  profiles
    .each(async (dbs, profile) => {
      if (profile.id === 'default') await runFullSyncSequence(dbs, { remoteFolder })
    })
    .catch((err) => logger.error({ err }, 'background boot sync failed'))
    .finally(() => {
      bootSyncing = false
    })
  refreshRemoteProviders().catch((err) =>
    logger.error({ err }, 'background providers refresh failed')
  )

  let syncing = false
  const syncInterval = setInterval(async () => {
    if (syncing || isShuttingDown) return
    syncing = true
    try {
      await profiles!.each(async (dbs) => {
        const kinds = { anime: dbs.db, manga: dbs.mangaDb, tv: dbs.tvDb, asmr: dbs.asmrDb }
        for (const kind of Object.keys(kinds) as MediaKind[])
          await syncUp(kinds[kind], kind, remoteFolder)
      })
    } catch (err) {
      logger.error({ err }, 'Profile sync failed')
    } finally {
      syncing = false
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
    await profiles!.each(async (dbs) => {
      closeTrackerActivityStreams(dbs.db)
      stopWatchlistDiscovery()
    })
    clearInterval(syncInterval)
    clearInterval(offlineDbInterval)
    discordRPCService.disconnect()
    discordGatewayService.shutdown()

    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }

    await profiles!.each(async (dbs) => {
      await waitForSync()
      const kinds = { anime: dbs.db, manga: dbs.mangaDb, tv: dbs.tvDb, asmr: dbs.asmrDb }
      await Promise.allSettled(
        (Object.keys(kinds) as MediaKind[]).map((kind) => syncUp(kinds[kind], kind, remoteFolder))
      )
      await waitForSync()
    })
    await profiles!.close()
    notifyServerExit()
    if (signal === 'SIGUSR2') process.kill(process.pid, 'SIGUSR2')
    else setTimeout(() => process.exit(0), 100).unref()
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

process.setMaxListeners(100)
import { EventEmitter } from 'events'
EventEmitter.defaultMaxListeners = 100
import express from 'express'
import path from 'path'
import cors from 'cors'
import compression from 'compression'
import NodeCache from 'node-cache'
import fs from 'fs'
import { DatabaseWrapper } from './db'
import chokidar from 'chokidar'
import logger from './logger'

import { _123AnimeProvider as Anime123Provider } from './providers/123anime.provider'
import { AnimeyaProvider } from './providers/animeya.provider'
import { MegaPlayProvider } from './providers/megaplay.provider'
import { AnimePaheProvider } from './providers/animepahe.provider'
import { WhProvider } from './providers/wh.provider'
import { HnProvider } from './providers/hn.provider'
import { AnilightProvider } from './providers/anilight.provider'
import { AnidbProvider } from './providers/anidb.provider'
import { HtProvider } from './providers/ht.provider'
import { JasmrProvider } from './providers/jasmr.provider'
import { OpProvider } from './providers/op.provider'
import { googleDriveService } from './google'
import { githubSyncService } from './github-sync'
import { CONFIG } from './config'
import {
  initializeDatabase,
  syncDownOnBoot,
  syncUp,
  initSyncProvider,
  waitForSync,
  getActiveProvider,
} from './sync'
import { createAuthRouter } from './routes/auth.routes'
import { createWatchlistRouter } from './routes/watchlist.routes'
import { createDataRouter } from './routes/data.routes'
import { createAsmrRouter } from './routes/asmr.routes'
import { createProxyRouter } from './routes/proxy.routes'
import { createSettingsRouter } from './routes/settings.routes'
import { createInsightsRouter } from './routes/insights.routes'
import { createTranslateRouter } from './routes/translate.routes'
import { createDiscordGatewayRouter } from './routes/discord-gateway.routes'
import { discordRPCService } from './discord-rpc'
import { discordGatewayService } from './discord-gateway'
import { SettingsRepository } from './repositories/settings.repository'
import { requestContext } from './utils/request-context'
import { checkAnilistStatus } from './lib/anilist'

declare module 'express-serve-static-core' {
  interface Request {
    db: DatabaseWrapper
  }
}

const app = express()

app.use((req, res, next) => {
  const store = new Map<string, string>()
  if (req.headers['x-animepahe-ua']) {
    store.set('ua', req.headers['x-animepahe-ua'] as string)
  }
  if (req.headers['x-animepahe-cookie']) {
    store.set('cookie', req.headers['x-animepahe-cookie'] as string)
  }
  requestContext.run(store, next)
})

const apiCache = new NodeCache({ stdTTL: 3600 })

const _123AnimeProvider = new Anime123Provider(apiCache)
const animeyaProvider = new AnimeyaProvider(apiCache)
const megaPlayProvider = new MegaPlayProvider(apiCache)
const animepaheProvider = new AnimePaheProvider(apiCache)
const whProvider = new WhProvider(apiCache)
const hnProvider = new HnProvider()
const anilightProvider = new AnilightProvider(apiCache)
const anidbProvider = new AnidbProvider(apiCache)
const htProvider = new HtProvider(apiCache)
const jasmrProvider = new JasmrProvider(apiCache)
const opProvider = new OpProvider(apiCache)

const providers = {
  '123anime': _123AnimeProvider,
  animeya: animeyaProvider,
  megaplay: megaPlayProvider,
  animepahe: animepaheProvider,
  wh: whProvider,
  hn: hnProvider,
  anilight: anilightProvider,
  anidb: anidbProvider,
  ht: htProvider,
  jasmr: jasmrProvider,
  op: opProvider,
}

let db: DatabaseWrapper
let isShuttingDown = false

async function runSyncSequence(
  database: DatabaseWrapper,
  preferredProvider?: 'github' | 'google' | 'rclone' | 'none'
) {
  const dbName = CONFIG.IS_DEV ? CONFIG.DB_NAME_DEV : CONFIG.DB_NAME_PROD
  const dbPath = path.join(CONFIG.ROOT, dbName)
  const remoteFolder = CONFIG.IS_DEV ? CONFIG.REMOTE_FOLDER_DEV : CONFIG.REMOTE_FOLDER_PROD

  await initSyncProvider(preferredProvider)

  if (getActiveProvider() === 'google' && googleDriveService.isAuthenticated()) {
    const legacyFolder = CONFIG.IS_DEV ? 'aniweb_dev_db' : 'aniweb_db'
    try {
      await googleDriveService.migrateFromAniWebDb(
        legacyFolder,
        remoteFolder,
        dbName,
        CONFIG.MANIFEST_FILENAME
      )
    } catch (err) {
      logger.error({ err }, 'Google Drive migration from ani-web failed')
    }
  }

  if (getActiveProvider() === 'github' && githubSyncService.isAuthenticated()) {
    try {
      await githubSyncService.migrateFromAniWebSync()
    } catch (err) {
      logger.error({ err }, 'GitHub sync migration from ani-web failed')
    }
  }

  const didDownload = await syncDownOnBoot(database, dbPath, remoteFolder, () => {
    return new Promise<void>((resolve) => {
      if (database && !database.isClosedCheck()) {
        database.checkpoint()
        database.close(() => resolve())
      } else {
        resolve()
      }
    })
  })

  let currentDb = database
  if (didDownload) {
    db = await initializeDatabase(dbPath)
    currentDb = db
    logger.info('Database re-initialized after sync.')
  }

  try {
    await syncUp(currentDb, dbPath, remoteFolder)
  } catch (err) {
    logger.error({ err }, 'Sync up on boot failed')
  }
}

app.use((req, res, next) => {
  if (isShuttingDown) {
    return res.status(503).send('Server is shutting down...')
  }
  if (!db) {
    return res.status(503).send('Database initializing...')
  }
  req.db = db
  next()
})

app.use(
  compression({
    level: 2,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) {
        return false
      }
      return compression.filter(req, res)
    },
  })
)

app.use(cors())
app.use(express.json({ limit: '10mb' }))

app.use(
  '/api/auth',
  createAuthRouter((database) => runSyncSequence(database))
)

const { router: watchlistRouter, stopDiscovery } = createWatchlistRouter(
  animepaheProvider,
  () => db
)
app.use('/api', watchlistRouter)
app.use('/api', createDataRouter(apiCache, providers))
app.use('/api', createAsmrRouter(apiCache, jasmrProvider))
app.use('/api', createProxyRouter())
app.use('/api', createInsightsRouter())
app.use('/api', createTranslateRouter())
app.use('/api', createDiscordGatewayRouter())
app.use(
  '/api',
  createSettingsRouter(
    () => db,
    initializeDatabase,
    (newDb) => {
      db = newDb
    }
  )
)

if (!CONFIG.IS_DEV) {
  const frontendPath = path.join(CONFIG.PACKAGE_ROOT, 'client', 'dist')
  logger.info(`Serving frontend from: ${frontendPath}`)
  app.use(express.static(frontendPath))

  app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile('index.html', { root: frontendPath }, (err) => {
      if (err) {
        logger.error({ err }, `Failed to serve index.html from ${frontendPath}`)
        if (!res.headersSent) {
          res.status(500).send('Server Error: Frontend build not found.')
        }
      }
    })
  })
}

app.use(
  (
    err: Error & { status?: number },
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    logger.error({ err, url: req.url, method: req.method }, 'Unhandled error')

    if (res.headersSent) {
      return next(err)
    }

    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      status: err.status || 500,
    })
  }
)

async function main() {
  const dbName = CONFIG.IS_DEV ? CONFIG.DB_NAME_DEV : CONFIG.DB_NAME_PROD
  const dbPath = path.join(CONFIG.ROOT, dbName)
  const remoteFolder = CONFIG.IS_DEV ? CONFIG.REMOTE_FOLDER_DEV : CONFIG.REMOTE_FOLDER_PROD

  db = await initializeDatabase(dbPath)
  logger.info(`Database initialized at ${dbPath}`)

  const rpcEnabledSetting = await SettingsRepository.getByKey(db, 'discordRPCEnabled')
  const isRpcEnabled = rpcEnabledSetting ? rpcEnabledSetting.value === 'true' : true
  await discordRPCService.setEnabled(isRpcEnabled)
  discordGatewayService.setEnabled(isRpcEnabled)

  checkAnilistStatus().catch(() => {})

  await runSyncSequence(db)

  if (!fs.existsSync(CONFIG.LOCAL_MANIFEST_PATH)) {
    fs.writeFileSync(CONFIG.LOCAL_MANIFEST_PATH, JSON.stringify({ version: 0 }))
  }

  let hasUnsyncedChanges = false

  const watcher = chokidar.watch(CONFIG.LOCAL_MANIFEST_PATH, {
    persistent: true,
    ignoreInitial: true,
  })

  const expressServer = app.listen(CONFIG.PORT, () => {
    logger.info(`Server running on http://localhost:${CONFIG.PORT}`)
  })

  watcher.on('change', () => {
    hasUnsyncedChanges = true
  })

  const syncInterval = setInterval(async () => {
    if (hasUnsyncedChanges) {
      logger.info('Uploading accumulated database changes...')
      hasUnsyncedChanges = false
      try {
        await syncUp(db, dbPath, remoteFolder)
      } catch (err) {
        logger.error({ err }, 'Failed to upload database changes')
        hasUnsyncedChanges = true
      }
    }
  }, 300000)

  const shutdown = async (signal?: string) => {
    if (isShuttingDown) return
    isShuttingDown = true
    stopDiscovery()
    clearInterval(syncInterval)
    discordRPCService.disconnect()
    discordGatewayService.disconnect()
    await watcher.close()

    if (expressServer) {
      expressServer.close()
    }

    if (hasUnsyncedChanges) {
      logger.info('Sync on shutdown: uploading final database changes...')
      hasUnsyncedChanges = false
      try {
        await syncUp(db, dbPath, remoteFolder)
      } catch (e) {
        console.error('Final sync on shutdown failed:', e)
      }
    }

    await waitForSync()

    db.close(() => {
      console.log('[SERVER_EXIT]')
      if (signal === 'SIGUSR2') {
        process.kill(process.pid, 'SIGUSR2')
      }
    })
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.once('SIGUSR2', () => shutdown('SIGUSR2'))

  app.post('/api/internal/shutdown', (req, res) => {
    if (req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1') {
      res.status(200).json({ message: 'Shutting down' })
      setTimeout(() => shutdown(), 500)
    } else {
      res.status(403).send('Forbidden')
    }
  })
}

main().catch((err) => {
  console.error('Server failed to start:', err)
  process.exit(1)
})

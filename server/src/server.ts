process.setMaxListeners(100)
import { EventEmitter } from 'events'
EventEmitter.defaultMaxListeners = 100
import express from 'express'
import path from 'path'
import cors from 'cors'
import compression from 'compression'
import { AppCache } from './utils/cache.utils.js'
import fs from 'fs'
import crypto from 'crypto'
import { DatabaseWrapper } from './db.js'
import logger from './logger.js'
import { notifyServerExit } from './lib/ipc.js'
import { crossSiteProtectionMiddleware, isAllowedOrigin } from './utils/security.utils.js'
import { requestLogger } from './request-logger.js'

import { _123AnimeProvider as Anime123Provider } from './providers/123anime.provider.js'
import { AnimeyaProvider } from './providers/animeya.provider.js'
import { MegaPlayProvider } from './providers/megaplay.provider.js'
import { AnimePaheProvider } from './providers/animepahe.provider.js'
import { WhProvider } from './providers/wh.provider.js'
import { HnProvider } from './providers/hn.provider.js'
import { AnilightProvider } from './providers/anilight.provider.js'
import { KaaProvider } from './providers/kaa.provider.js'
import { HtProvider } from './providers/ht.provider.js'
import { JasmrProvider } from './providers/jasmr.provider.js'
import { JustAnimeProvider } from './providers/justanime.provider.js'
import { OpProvider } from './providers/op.provider.js'
import { AniBdProvider } from './providers/anibd.provider.js'
import { AnimeDunyaProvider } from './providers/animedunya.provider.js'
import { AnimeGgProvider } from './providers/animegg.provider.js'
import { githubSyncService } from './github-sync.js'
import { CONFIG } from './config.js'
import {
  initializeDatabase,
  syncDownOnBoot,
  syncUp,
  initSyncProvider,
  waitForSync,
  getActiveProvider,
} from './sync.js'
import { createAuthRouter } from './routes/auth.routes.js'
import { createLanAuthRouter } from './routes/lan-auth.routes.js'
import { lanAuthMiddleware } from './app-auth.js'
import { createWatchlistRouter } from './routes/watchlist.routes.js'
import { createDataRouter } from './routes/data.routes.js'
import { createAsmrRouter } from './routes/asmr.routes.js'
import { createMangaRouter } from './routes/manga.routes.js'
import { createRadioRouter } from './routes/radio.routes.js'
import { createTvRouter } from './routes/tv.routes.js'
import { createProxyRouter } from './routes/proxy.routes.js'
import { createSettingsRouter } from './routes/settings.routes.js'
import { createInsightsRouter } from './routes/insights.routes.js'
import { createTranslateRouter } from './routes/translate.routes.js'
import { createDiscordGatewayRouter } from './routes/discord-gateway.routes.js'
import { createTrackerRouter } from './routes/tracker.routes.js'
import { discordRPCService } from './discord-rpc.js'
import { discordGatewayService } from './discord-gateway.js'
import { SettingsRepository } from './repositories/settings.repository.js'
import { requestContext } from './utils/request-context.js'
import { checkAnilistStatus } from './lib/anilist.js'

declare module 'express-serve-static-core' {
  interface Request {
    db: DatabaseWrapper
  }
}

const app = express()

app.use(requestLogger)

app.get('/api/health', (_req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'shutting-down', ready: false })
  }
  if (!db) {
    return res.status(503).json({ status: 'starting', ready: false })
  }
  res.json({ status: 'ok', ready: true })
})

app.use((req, res, next) => {
  const store = new Map<string, string>()
  if (req.headers['x-animepahe-ua']) {
    store.set('ua', req.headers['x-animepahe-ua'] as string)
  }
  if (req.headers['x-animepahe-cookie']) {
    store.set('cookie', req.headers['x-animepahe-cookie'] as string)
  }
  if (req.headers['x-jasmr-ua']) {
    store.set('jasmr_ua', req.headers['x-jasmr-ua'] as string)
  }
  if (req.headers['x-jasmr-cookie']) {
    store.set('jasmr_cookie', req.headers['x-jasmr-cookie'] as string)
  }
  requestContext.run(store, next)
})

const apiCache = new AppCache({ ttlSeconds: 3600, maxKeys: 5000 })

const _123AnimeProvider = new Anime123Provider(apiCache)
const animeyaProvider = new AnimeyaProvider(apiCache)
const megaPlayProvider = new MegaPlayProvider(apiCache)
const animepaheProvider = new AnimePaheProvider(apiCache)
const whProvider = new WhProvider(apiCache)
const hnProvider = new HnProvider()
const anilightProvider = new AnilightProvider(apiCache)
const kaaProvider = new KaaProvider(apiCache)
const htProvider = new HtProvider(apiCache)
const jasmrProvider = new JasmrProvider(apiCache)
const justAnimeProvider = new JustAnimeProvider(apiCache)
const opProvider = new OpProvider(apiCache)
const anibdProvider = new AniBdProvider(apiCache)
const animedunyaProvider = new AnimeDunyaProvider(apiCache)
const animeggProvider = new AnimeGgProvider(apiCache)

const providers = {
  '123anime': _123AnimeProvider,
  animeya: animeyaProvider,
  megaplay: megaPlayProvider,
  animepahe: animepaheProvider,
  wh: whProvider,
  hn: hnProvider,
  anilight: anilightProvider,
  kaa: kaaProvider,
  ht: htProvider,
  jasmr: jasmrProvider,
  justanime: justAnimeProvider,
  op: opProvider,
  anibd: anibdProvider,
  animedunya: animedunyaProvider,
  animegg: animeggProvider,
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

app.use(
  cors({
    origin: (origin, callback) => {
      callback(null, isAllowedOrigin(origin))
    },
    credentials: true,
  })
)
app.use(crossSiteProtectionMiddleware)
app.use(express.json({ limit: '10mb' }))

app.use('/api/auth', createLanAuthRouter())
app.use(lanAuthMiddleware)

app.use(
  '/api/auth',
  createAuthRouter((database) => runSyncSequence(database))
)

const { router: watchlistRouter, stopDiscovery } = createWatchlistRouter(() => db)
app.use('/api', watchlistRouter)
app.use('/api', createDataRouter(apiCache, providers))
app.use('/api', createAsmrRouter(apiCache, jasmrProvider))
app.use('/api', createMangaRouter(apiCache))
app.use('/api', createRadioRouter(apiCache))
app.use('/api', createTvRouter(apiCache))
app.use('/api', createProxyRouter())
app.use('/api', createInsightsRouter())
app.use('/api', createTranslateRouter())
app.use('/api', createDiscordGatewayRouter())
app.use('/api', createTrackerRouter())
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
    if (
      err instanceof SyntaxError &&
      'body' in err &&
      req.headers['content-type']?.includes('application/json')
    ) {
      if (!res.headersSent) {
        return res.status(400).json({ error: 'Invalid JSON', status: 400 })
      }
    }

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

  const watcher = fs.watch(CONFIG.LOCAL_MANIFEST_PATH, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') {
      hasUnsyncedChanges = true
    }
  })

  const expressServer = app.listen(CONFIG.PORT, () => {
    logger.info(`Server running on http://localhost:${CONFIG.PORT}`)
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
    discordGatewayService.shutdown()
    await watcher.close()

    if (expressServer) {
      await new Promise<void>((resolve) => expressServer.close(() => resolve()))
    }

    if (hasUnsyncedChanges) {
      logger.info('Sync on shutdown: uploading final database changes...')
      hasUnsyncedChanges = false
      try {
        await syncUp(db, dbPath, remoteFolder)
      } catch (e) {
        logger.error({ err: e }, 'Final sync on shutdown failed')
      }
    }

    await waitForSync()

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

  app.post('/api/internal/shutdown', (req, res) => {
    const isLoopback = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip === '::ffff:127.0.0.1'
    if (!isLoopback) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }

    const expectedToken = process.env.INTERNAL_SHUTDOWN_TOKEN
    const providedToken = req.headers['x-internal-token']
    if (expectedToken) {
      const expBuf = Buffer.from(expectedToken)
      const provBuf = Buffer.from(typeof providedToken === 'string' ? providedToken : '')
      if (expBuf.length !== provBuf.length || !crypto.timingSafeEqual(expBuf, provBuf)) {
        logger.warn('Unauthorized internal shutdown attempt rejected: invalid token')
        res.status(403).json({ error: 'Forbidden' })
        return
      }
    }

    res.status(200).json({ message: 'Shutting down' })
    setTimeout(() => shutdown(), 500)
  })
}

main().catch((err) => {
  logger.error({ err }, 'Server failed to start')
  process.exit(1)
})

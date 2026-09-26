import { Hono, type Context } from 'hono'
import { compress } from 'hono/compress'
import { getConnInfo } from '@hono/node-server/conninfo'
import path from 'path'
import fs from 'fs'
import { XMLParser } from 'fast-xml-parser'
import { CONFIG } from './config.js'
import { isAllowedOrigin } from './utils/security.utils.js'
import { requestContext } from './utils/request-context.js'
import logger from './logger.js'
import {
  LAN_AUTH_PUBLIC_PATHS,
  buildLanCookie,
  clearAllLanSessions,
  clearLanCookie,
  createLanSession,
  getTokenFromHeaders,
  hasAppPassword,
  isLoopbackIp,
  revokeLanSession,
  setAppPassword,
  validateLanSession,
  verifyAppPassword,
} from './app-auth.js'
import { updateEnvFile } from './utils/env.utils.js'
import { discordGatewayService } from './discord-gateway.js'
import {
  computeDiscordSyncStats,
  getCachedRecommendations,
  getLinkedDiscordUser,
  setLinkedDiscordUser,
  syncDiscordRoles,
} from './lib/discord-roles-sync.service.js'
import { getWatchInsights, getGenreCards } from './lib/insights.js'
import { translateTexts } from './lib/translate.js'
import { AniListTracker } from './lib/tracker/anilist-tracker.js'
import {
  syncAniList,
  importFromMalUsername,
  importFromUsername,
} from './lib/tracker/sync.service.js'
import {
  syncAniListManga,
  importFromUsernameManga,
  importMangaFromMalUsername,
  importMangaFromMalXmlItems,
  type MalXmlMangaItem,
} from './lib/tracker/manga-sync.service.js'
import type { ProviderCatalogItem } from './providers/remote-types.js'
import { getMachineId } from './utils/machine-id.js'
import type { DatabaseWrapper } from './db.js'
import { SettingsRepository } from './repositories/settings.repository.js'
import { LibraryRepository } from './repositories/library.repository.js'
import {
  performAsmrWriteTransactionAsync,
  performMangaWriteTransactionAsync,
  performTvWriteTransactionAsync,
  performWriteTransactionAsync,
  setLocalAsmrManifestVersion,
  setLocalMangaManifestVersion,
  setLocalManifestVersion,
  setLocalTvManifestVersion,
} from './sync.js'
import {
  ANIME_SYNC_TABLES,
  ASMR_SYNC_TABLES,
  MANGA_SYNC_TABLES,
  TV_SYNC_TABLES,
  exportTables,
  importTables,
  normalizePayload,
  readPayloadVersion,
  type SyncPayload,
} from './sync-payload.js'
import { discordRPCService } from './discord-rpc.js'
import { offlineDb } from './lib/offline-db.js'
import {
  getMalImportStatus,
  requestMalImportCancel,
  prepareMalImport,
  executeMalImport,
} from './lib/mal-import.js'
import { registerMusic } from './hono/music.js'
import { registerAuth, type RunSyncSequence } from './hono/auth.js'
import { registerWatchlist } from './hono/watchlist.js'
import { type JasmrApi } from './hono/asmr.js'
import { registerTv } from './hono/tv.js'
import { registerProxy } from './hono/proxy.js'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from './trpc/router.js'
import { buildTrpcContext } from './trpc/context.js'
import type { AppCache } from './utils/cache.utils.js'
import type { Provider } from './providers/provider.interface.js'
import type { MangaProvider } from './providers/manga/manga.types.js'
import type { TvProvider } from './providers/tv.types.js'

export type HonoHealthState = {
  shuttingDown: boolean
  dbReady: boolean
}

export type HonoGuardState = {
  shuttingDown: boolean
  dbsReady: boolean
  bootSyncing: boolean
}

export type HonoDbs = {
  db: DatabaseWrapper
  mangaDb: DatabaseWrapper
  tvDb: DatabaseWrapper
  asmrDb: DatabaseWrapper
}

export type HonoDbAdmin = {
  initializeDatabase: (dbPath: string) => Promise<DatabaseWrapper>
  setDb: (db: DatabaseWrapper) => void
}

export type HonoProviderApi = {
  getCatalog: () => ProviderCatalogItem[]
  refresh: () => Promise<ProviderCatalogItem[]>
}

export type HonoMediaDeps = {
  getApiCache: () => AppCache
  getProviders: () => Record<string, Provider>
  getMangaProvider: (name: string) => MangaProvider | undefined
  getTvProvider: (name: string) => TvProvider | undefined
  getJasmr: () => JasmrApi | undefined
}

type MangaXmlVal = string | string[] | undefined

const malMangaXmlParser = new XMLParser({
  isArray: (name) => name === 'manga',
  parseTagValue: false,
  trimValues: true,
})

function mangaXmlText(value: MangaXmlVal): string {
  if (Array.isArray(value)) return String(value[0] ?? '')
  return String(value ?? '')
}

function mapMalMangaXmlStatus(status: string): string {
  switch (status) {
    case 'Plan to Read':
      return 'Planned'
    case 'On Hold':
      return 'On-Hold'
    case 'Reading':
    case 'Completed':
    case 'Dropped':
      return status
    default:
      return 'Planned'
  }
}

const gatewayLog = logger.child({ module: 'DiscordGatewayRoutes' })

const TRACKER_TOKEN_KEY = 'tracker_anilist_token'
const TRACKER_USER_KEY = 'tracker_anilist_user'

function maskToken(t: string | undefined | null): string {
  if (!t) return 'none'
  return t.slice(0, 8) + '...' + t.slice(-4)
}

export function getHonoClientIp(c: {
  req: { header: (name: string) => string | undefined }
  env: unknown
}): string | undefined {
  try {
    return getConnInfo(c as never).remote.address
  } catch {
    return c.req.header('x-dango-client-ip') ?? undefined
  }
}

export async function honoRequestLogger(
  c: { req: { method: string; url: string }; res: Response },
  next: () => Promise<void>
) {
  const start = process.hrtime.bigint()
  const url = new URL(c.req.url)
  const loggedUrl = `${url.pathname}${url.search}`
  await next()
  const ms = Math.round((Number(process.hrtime.bigint() - start) / 1_000_000) * 10) / 10
  const status = c.res.status
  const payload = { method: c.req.method, url: loggedUrl, status, ms }
  if (status >= 500) {
    logger.warn(payload, 'request failed')
  } else if (!loggedUrl.startsWith('/api/proxy')) {
    logger.trace(`${c.req.method} ${loggedUrl} ${status} ${ms}ms`)
  }
}

export async function honoRequestContextMiddleware(
  c: { req: { header: (name: string) => string | undefined } },
  next: () => Promise<void>
) {
  const store = new Map<string, string>()
  const ua = c.req.header('x-animepahe-ua')
  if (ua) store.set('ua', ua)
  const cookie = c.req.header('x-animepahe-cookie')
  if (cookie) store.set('cookie', cookie)
  const jasmrUa = c.req.header('x-jasmr-ua')
  if (jasmrUa) store.set('jasmr_ua', jasmrUa)
  const jasmrCookie = c.req.header('x-jasmr-cookie')
  if (jasmrCookie) store.set('jasmr_cookie', jasmrCookie)
  return requestContext.run(store, () => next())
}

async function restoreJsonBackup(c: Context, dbs: HonoDbs, buffer: Buffer) {
  let parsed: unknown
  try {
    parsed = JSON.parse(buffer.toString('utf-8'))
  } catch {
    return c.json({ error: 'Invalid backup file.' }, 400)
  }

  const databases = (parsed as { databases?: Record<string, unknown> })?.databases
  if (!databases || typeof databases !== 'object') {
    return c.json({ error: 'Invalid backup file: missing databases.' }, 400)
  }

  const targets: Array<{
    key: string
    db: DatabaseWrapper
    tables: readonly string[]
    libraryTables: readonly string[]
    backupName: string
    setVersion: (version: number) => Promise<void>
  }> = [
    {
      key: 'anime',
      db: dbs.db,
      tables: ANIME_SYNC_TABLES,
      libraryTables: ['watchlist', 'watched_episodes'],
      backupName: 'pre-sync-backup.db',
      setVersion: setLocalManifestVersion,
    },
    {
      key: 'manga',
      db: dbs.mangaDb,
      tables: MANGA_SYNC_TABLES,
      libraryTables: ['manga_library', 'manga_progress'],
      backupName: 'pre-sync-manga-backup.db',
      setVersion: setLocalMangaManifestVersion,
    },
    {
      key: 'tv',
      db: dbs.tvDb,
      tables: TV_SYNC_TABLES,
      libraryTables: ['tv_library', 'tv_progress'],
      backupName: 'pre-sync-tv-backup.db',
      setVersion: setLocalTvManifestVersion,
    },
    {
      key: 'asmr',
      db: dbs.asmrDb,
      tables: ASMR_SYNC_TABLES,
      libraryTables: ['asmr_library', 'asmr_progress'],
      backupName: 'pre-sync-asmr-backup.db',
      setVersion: setLocalAsmrManifestVersion,
    },
  ]

  const present = targets.filter((t) => databases[t.key] !== undefined)
  if (present.length === 0) {
    return c.json({ error: 'Invalid backup file: no databases found.' }, 400)
  }

  const sections = new Map<string, SyncPayload<string>>()
  try {
    for (const target of present) {
      sections.set(
        target.key,
        normalizePayload(databases[target.key], target.tables, `backup ${target.key}`)
      )
    }
  } catch (err) {
    logger.warn({ err }, 'Multi-database restore rejected: invalid payload')
    return c.json({ error: 'Invalid backup file.' }, 400)
  }

  const restored: string[] = []
  try {
    for (const target of present) {
      const section = sections.get(target.key)!
      importTables(target.db, target.tables, section, {
        libraryTables: target.libraryTables,
        backupName: target.backupName,
      })
      await target.setVersion(readPayloadVersion(section))
      restored.push(target.key)
    }
  } catch (err) {
    logger.error({ err, restored }, 'Multi-database restore failed partway')
    return c.json({ error: 'Restore failed partway.', restored }, 500)
  }

  logger.warn({ restored }, 'Databases restored from backup file by user request')
  return c.json({ success: true, message: 'Databases restored.', restored })
}

function restoreLegacyDatabase(
  c: Context,
  dbs: HonoDbs,
  buffer: Buffer,
  dbAdmin: HonoDbAdmin
): Promise<Response> {
  const dbName = CONFIG.IS_DEV ? CONFIG.DB_NAME_DEV : CONFIG.DB_NAME_PROD
  const tempPath = path.join(CONFIG.ROOT, 'restore_temp.db')
  const dbPath = path.join(CONFIG.ROOT, dbName)

  try {
    fs.writeFileSync(tempPath, buffer)
  } catch (err) {
    logger.error({ err }, 'Failed to stage legacy database restore file')
    return Promise.resolve(c.json({ error: 'Failed to stage restore file.' }, 500))
  }

  const db = dbs.db
  return new Promise((resolve) => {
    db.close((closeErr: Error | null) => {
      if (closeErr) {
        resolve(c.json({ error: 'Failed to close database.' }, 500))
        return
      }

      try {
        db.checkpoint()
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
            dbAdmin.setDb(await dbAdmin.initializeDatabase(dbPath))
          } catch (e) {
            logger.error({ err: e }, 'Failed to reopen DB after rename failure')
          }
          resolve(c.json({ error: 'Failed to replace database file.' }, 500))
          return
        }
        try {
          dbAdmin.setDb(await dbAdmin.initializeDatabase(dbPath))
          resolve(c.json({ success: true, message: 'Database restored.' }))
        } catch (e) {
          logger.error({ err: e }, 'Failed to initialize restored database')
          resolve(c.json({ error: 'Failed to initialize restored database.' }, 500))
        }
      })
    })
  })
}

export function createHonoApp(
  getState: () => HonoHealthState,
  getGuardState: () => HonoGuardState,
  getDbs: () => HonoDbs,
  dbAdmin: HonoDbAdmin,
  providerApi: HonoProviderApi,
  runSync: RunSyncSequence,
  media: HonoMediaDeps
): Hono {
  const app = new Hono()

  app.use(honoRequestLogger as never)
  app.use(honoRequestContextMiddleware as never)

  app.get('/api/health', (c) => {
    const state = getState()
    if (state.shuttingDown) {
      return c.json({ status: 'shutting-down', ready: false }, 503)
    }
    if (!state.dbReady) {
      return c.json({ status: 'starting', ready: false }, 503)
    }
    return c.json({ status: 'ok', ready: true })
  })

  app.use(
    async (
      c: { req: { method: string }; text: (body: string, status: number) => Response },
      next: () => Promise<void>
    ) => {
      const guard = getGuardState()
      if (guard.shuttingDown) {
        return c.text('Server is shutting down...', 503)
      }
      if (!guard.dbsReady) {
        return c.text('Database initializing...', 503)
      }
      if (
        guard.bootSyncing &&
        c.req.method !== 'GET' &&
        c.req.method !== 'HEAD' &&
        c.req.method !== 'OPTIONS'
      ) {
        return c.text('Sync in progress...', 503)
      }
      await next()
    }
  )

  const honoCompress = compress({ threshold: 1024 })
  app.use(async (c, next) => {
    if (c.req.header('x-no-compression')) {
      await next()
      return
    }
    await honoCompress(c, next)
  })

  app.use(async (c, next) => {
    const origin = c.req.header('origin')
    if (c.req.method === 'OPTIONS') {
      if (!origin || !isAllowedOrigin(origin)) {
        await next()
        return
      }
      const reqHeaders = c.req.header('access-control-request-headers')
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
          ...(reqHeaders ? { 'Access-Control-Allow-Headers': reqHeaders } : {}),
          Vary: 'Origin',
        },
      })
    }
    if (!origin || isAllowedOrigin(origin)) {
      if (origin) c.header('Access-Control-Allow-Origin', origin)
      c.header('Access-Control-Allow-Credentials', 'true')
      c.header('Vary', 'Origin')
    }
    await next()
  })

  app.use(async (c, next) => {
    const method = c.req.method.toUpperCase()
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      await next()
      return
    }
    const secFetchSite = c.req.header('sec-fetch-site')
    if (secFetchSite === 'cross-site') {
      const origin = c.req.header('origin')
      if (!isAllowedOrigin(origin)) {
        return c.json({ error: 'Forbidden: cross-site request rejected' }, 403)
      }
    }
    const origin = c.req.header('origin')
    if (origin && !isAllowedOrigin(origin)) {
      return c.json({ error: 'Forbidden: cross-origin request rejected' }, 403)
    }
    await next()
  })

  app.get('/api/auth/app-status', (c) => {
    const authed =
      !hasAppPassword() ||
      validateLanSession(getTokenFromHeaders(c.req.header('authorization'), c.req.header('cookie')))
    return c.json({ hasPassword: hasAppPassword(), isAuthenticated: authed })
  })

  app.post('/api/auth/app-login', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { password?: unknown } | undefined
    const password = String(body?.password || '')
    if (!hasAppPassword()) {
      return c.json({ success: true })
    }
    if (!password) {
      return c.json({ error: 'Password required' }, 400)
    }
    if (!verifyAppPassword(password)) {
      return c.json({ error: 'Invalid password' }, 401)
    }
    const session = createLanSession()
    c.header('Set-Cookie', buildLanCookie(session.token, session.expiry))
    return c.json({ success: true })
  })

  app.post('/api/auth/app-logout', (c) => {
    revokeLanSession(getTokenFromHeaders(c.req.header('authorization'), c.req.header('cookie')))
    c.header('Set-Cookie', clearLanCookie())
    return c.json({ success: true })
  })

  app.post('/api/auth/app-setup', async (c) => {
    if (!isLoopbackIp(c.req.header('x-dango-client-ip'))) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const body = (await c.req.json().catch(() => undefined)) as { password?: unknown } | undefined
    const password = String(body?.password || '')
    try {
      await setAppPassword(password)
      clearAllLanSessions()
      return c.json({ success: true, hasPassword: hasAppPassword() })
    } catch {
      return c.json({ error: 'Failed to update password' }, 500)
    }
  })

  app.use(
    async (
      c: {
        req: { path: string; header: (name: string) => string | undefined }
        json: (body: object, status: number) => Response
        env: unknown
      },
      next: () => Promise<void>
    ) => {
      const path = c.req.path
      if (!path.startsWith('/api/')) {
        await next()
        return
      }
      if (LAN_AUTH_PUBLIC_PATHS.has(path)) {
        await next()
        return
      }
      if (path.startsWith('/api/internal/') && isLoopbackIp(getHonoClientIp(c))) {
        await next()
        return
      }
      if (!hasAppPassword()) {
        await next()
        return
      }
      if (
        validateLanSession(
          getTokenFromHeaders(c.req.header('authorization'), c.req.header('cookie'))
        )
      ) {
        await next()
        return
      }
      return c.json({ error: 'LAN_AUTH_REQUIRED' }, 401)
    }
  )

  app.all('/api/trpc/*', (c) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext: () =>
        buildTrpcContext(
          {
            ...getDbs(),
            apiCache: media.getApiCache(),
            getTvProvider: media.getTvProvider,
            getMangaProvider: media.getMangaProvider,
            getJasmr: media.getJasmr,
            getProviders: media.getProviders,
            getCatalog: providerApi.getCatalog,
          },
          c.req.header('authorization'),
          c.req.header('cookie')
        ),
    })
  )

  app.post('/api/import/mal-xml', async (c) => {
    const dbs = getDbs()
    const fields = (await c.req.parseBody().catch(() => ({}))) as Record<
      string,
      string | File | undefined
    >
    const file = fields['xmlfile']
    const buffer = file instanceof File ? Buffer.from(await file.arrayBuffer()) : undefined
    const prepared = prepareMalImport(buffer, {
      erase: fields['erase'],
      useOfflineDb: fields['useOfflineDb'],
      skipFallback: fields['skipFallback'],
    })
    if (!prepared.ok) return c.json(prepared.body, prepared.status)
    const stream = new TransformStream<Uint8Array, Uint8Array>()
    const writer = stream.writable.getWriter()
    const encoder = new TextEncoder()
    let disconnected = false
    c.req.raw.signal.addEventListener(
      'abort',
      () => {
        disconnected = true
      },
      { once: true }
    )
    const sendEvent = (event: string, data: unknown) => {
      if (disconnected) return
      void writer
        .write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        .catch(() => {})
    }
    void executeMalImport(dbs.db, prepared.import, sendEvent).finally(() => {
      void writer.close().catch(() => {})
    })
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  })

  app.get('/api/providers', (c) => {
    c.header('Cache-Control', 'public, max-age=300')
    return c.json(providerApi.getCatalog())
  })

  app.post('/api/providers/refresh', async (c) => {
    try {
      return c.json(await providerApi.refresh())
    } catch (err) {
      return c.json({ error: (err as Error).message || 'refresh failed' }, 500)
    }
  })

  app.get('/api/tracker/anilist/callback', (c) => {
    return c.html(`<!doctype html>
<html><head><meta charset="utf-8"><title>AniList — completing login</title></head>
<body style="font-family:system-ui;padding:24px;background:#0b1426;color:#e5eefc"><p>Completing AniList login…</p>
<script>
(function(){
  var qs = new URLSearchParams(location.search);
  var state = qs.get('state');
  var hash = location.hash || '';
  var hp = new URLSearchParams(hash.slice(1));
  if (!state) state = hp.get('state');
  var token = hp.get('access_token');
  var error = hp.get('error') || qs.get('error');
  var frontend = location.origin + '/trackers';
  if (state) {
    try {
      var candidate = decodeURIComponent(state);
      if (candidate.startsWith('/') && !candidate.startsWith('//')) {
        frontend = location.origin + candidate;
      } else {
        var parsed = new URL(candidate, location.origin);
        if (parsed.origin === location.origin) {
          frontend = parsed.href;
        }
      }
    } catch(e) {}
  }
  if (frontend.indexOf('/api/tracker/anilist/callback') !== -1) {
    frontend = location.origin + '/trackers';
  }
  if (error) {
    location.replace(frontend + (frontend.indexOf('?') !== -1 ? '&' : '?') + 'anilist=error&reason=' + encodeURIComponent(error));
    return;
  }
  if (token) {
    location.replace(frontend + hash);
    return;
  }
  var code = qs.get('code');
  if (code) {
    location.replace(frontend + (frontend.indexOf('?') !== -1 ? '&' : '?') + 'anilist=error&reason=code_flow_removed');
    return;
  }
  location.replace(frontend + (frontend.indexOf('?') !== -1 ? '&' : '?') + 'anilist=error&reason=no_token');
})();
</script></body></html>`)
  })

  app.post('/api/import/mal-xml-manga', async (c) => {
    const fields = (await c.req.parseBody().catch(() => ({}))) as Record<
      string,
      string | File | undefined
    >
    const file = fields['xmlfile']
    if (!(file instanceof File)) return c.json({ error: 'No file' }, 400)
    const eraseRaw: unknown = fields['erase']
    const erase = eraseRaw === true || eraseRaw === 'true' || eraseRaw === '1'
    try {
      const dbs = getDbs()
      if (!dbs.mangaDb || dbs.mangaDb.isClosedCheck()) {
        return c.json({ error: 'Manga database is not ready' }, 503)
      }
      let result: { myanimelist?: { manga?: Record<string, MangaXmlVal>[] } }
      try {
        result = malMangaXmlParser.parse(Buffer.from(await file.arrayBuffer()).toString()) as {
          myanimelist?: { manga?: Record<string, MangaXmlVal>[] }
        }
      } catch {
        return c.json({ error: 'Invalid XML' }, 400)
      }
      const mangaList = result?.myanimelist?.manga || []
      if (mangaList.length === 0) {
        return c.json({ error: 'No manga found in XML' }, 400)
      }
      const items: MalXmlMangaItem[] = mangaList.map((item) => ({
        malId: parseInt(mangaXmlText(item.series_mangadb_id), 10) || 0,
        title: mangaXmlText(item.series_title),
        status: mapMalMangaXmlStatus(mangaXmlText(item.my_status)),
        chapters: Math.max(parseInt(mangaXmlText(item.my_read_chapters), 10) || 0, 0),
      }))
      const { imported, skipped } = await importMangaFromMalXmlItems(
        dbs.db,
        dbs.mangaDb,
        items,
        erase
      )
      return c.json({ success: true, imported, skipped })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      return c.json({ error: message }, 500)
    }
  })

  app.get('/api/backup-db', (c) => {
    try {
      const dbs = getDbs()
      const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        databases: {
          anime: exportTables(dbs.db, ANIME_SYNC_TABLES),
          manga: exportTables(dbs.mangaDb, MANGA_SYNC_TABLES),
          tv: exportTables(dbs.tvDb, TV_SYNC_TABLES),
          asmr: exportTables(dbs.asmrDb, ASMR_SYNC_TABLES),
        },
      }
      c.header('Content-Disposition', 'attachment; filename="dango-backup.json"')
      return c.json(payload)
    } catch (err) {
      logger.error({ err }, 'Multi-database backup failed')
      return c.json({ error: 'Backup failed' }, 500)
    }
  })

  app.post('/api/database/clear', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { confirm?: unknown } | undefined
    if (body?.confirm !== true) {
      return c.json({ error: 'Confirmation required' }, 400)
    }
    if (getMalImportStatus().running) {
      return c.json({ error: 'An import is in progress' }, 409)
    }
    try {
      const dbs = getDbs()
      const before = await LibraryRepository.countAll(dbs.db)
      const beforeManga = await LibraryRepository.countManga(dbs.mangaDb)
      const beforeTv = await LibraryRepository.countTv(dbs.tvDb)
      const beforeAsmr = await LibraryRepository.countAsmr(dbs.asmrDb)
      await performWriteTransactionAsync(dbs.db, async (tx) => {
        await LibraryRepository.clearAll(tx)
      })
      await performMangaWriteTransactionAsync(dbs.mangaDb, async (tx) => {
        await LibraryRepository.clearManga(tx)
      })
      await performTvWriteTransactionAsync(dbs.tvDb, async (tx) => {
        await LibraryRepository.clearTv(tx)
      })
      await performAsmrWriteTransactionAsync(dbs.asmrDb, async (tx) => {
        await LibraryRepository.clearAsmr(tx)
      })
      logger.warn(
        { before, beforeManga, beforeTv, beforeAsmr },
        'Library database cleared by user request'
      )
      return c.json({
        success: true,
        deleted: before,
        deletedManga: beforeManga,
        deletedTv: beforeTv,
        deletedAsmr: beforeAsmr,
      })
    } catch {
      return c.json({ error: 'DB error' }, 500)
    }
  })

  app.post('/api/restore-db', async (c) => {
    const dbs = getDbs()
    let buffer: Buffer | undefined
    let originalName = ''
    try {
      const body = await c.req.parseBody()
      const file = body['dbfile']
      if (file instanceof File) {
        buffer = Buffer.from(await file.arrayBuffer())
        originalName = file.name || ''
      }
    } catch {
      return c.json({ error: 'No file uploaded.' }, 400)
    }
    if (!buffer) return c.json({ error: 'No file uploaded.' }, 400)
    const head = buffer.slice(0, 16).toString('utf-8').trimStart()
    if (originalName.endsWith('.json') || head.startsWith('{')) {
      return restoreJsonBackup(c, dbs, buffer)
    }
    return restoreLegacyDatabase(c, dbs, buffer, dbAdmin)
  })

  registerMusic(app)
  registerAuth(app, getDbs, runSync)
  registerWatchlist(app, getDbs)
  registerTv(app, media.getApiCache, media.getTvProvider)
  registerProxy(app)

  app.onError((err: Error & { status?: number }, c) => {
    logger.error({ err, url: c.req.path, method: c.req.method }, 'Unhandled error')
    const status = err.status || 500
    return c.json({ error: err.message || 'Internal Server Error', status }, status as never)
  })

  return app
}

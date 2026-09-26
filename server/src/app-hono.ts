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
  performAsmrWriteTransaction,
  performMangaWriteTransaction,
  performTvWriteTransaction,
  performWriteTransaction,
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
import { registerMangaLibrary } from './hono/manga-library.js'
import { registerTvLibrary } from './hono/tv-library.js'
import { registerAsmrLibrary } from './hono/asmr-library.js'
import { registerMusic } from './hono/music.js'
import { registerRadio } from './hono/radio.js'
import { registerAuth, type RunSyncSequence } from './hono/auth.js'
import { registerManga } from './hono/manga.js'
import { registerWatchlist } from './hono/watchlist.js'
import { registerAsmr, type JasmrApi } from './hono/asmr.js'
import { registerTv } from './hono/tv.js'
import { registerProxy } from './hono/proxy.js'
import { registerData } from './hono/data.js'
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

  app.get('/api/installation-id', (c) => {
    try {
      return c.json({ id: getMachineId() })
    } catch (err) {
      logger.error({ err }, 'Failed to get machine ID')
      return c.json({ error: 'Failed to get machine ID' }, 500)
    }
  })

  app.get('/api/settings', async (c) => {
    try {
      const key = c.req.query('key') as string
      const row = await SettingsRepository.getByKey(getDbs().db, key)
      let value = row ? row.value : null
      if (value === null && key === 'discordRPCEnabled') {
        value = 'true'
      }
      if (value === null && key === 'discordRPCHideMature') {
        value = 'true'
      }
      if (value === null && key === 'ignoreAdultContent') {
        value = 'true'
      }
      if (
        value === null &&
        (key === 'mangaIgnoreAdultContent' ||
          key === 'tvIgnoreAdultContent' ||
          key === 'asmrIgnoreAdultContent')
      ) {
        value = 'true'
      }
      return c.json({ value: value })
    } catch {
      return c.json({ error: 'DB error' }, 500)
    }
  })

  app.post('/api/settings', async (c) => {
    try {
      const body = (await c.req.json()) as { key: unknown; value: unknown }
      const key = String(body.key)
      const value = String(body.value ?? '')
      const shouldDelete = value === '' && key === 'tracker_anilist_client_id'
      await performWriteTransaction(getDbs().db, (tx) => {
        if (shouldDelete) SettingsRepository.deleteByKey(tx, key)
        else SettingsRepository.upsert(tx, key, value)
      })
      if (body.key === 'discordRPCEnabled') {
        discordRPCService.setEnabled(body.value === 'true' || body.value === true)
      }
      if (body.key === 'discordRPCHideMature') {
        discordRPCService.setHideMature(body.value === 'true' || body.value === true)
      }
      return c.json({ success: true })
    } catch {
      return c.json({ error: 'DB error' }, 500)
    }
  })

  app.get('/api/settings/offline-db', (c) => {
    try {
      return c.json(offlineDb.getOfflineDbInfo(getDbs().db))
    } catch {
      return c.json({ error: 'DB error' }, 500)
    }
  })

  app.post('/api/settings/offline-db/auto-update', async (c) => {
    try {
      const body = (await c.req.json().catch(() => undefined)) as { enabled?: unknown } | undefined
      const enabled = body?.enabled
      if (typeof enabled !== 'boolean') {
        return c.json({ error: 'enabled must be a boolean' }, 400)
      }
      SettingsRepository.upsert(getDbs().db, 'offlineDbAutoUpdateEnabled', String(enabled))
      return c.json({ success: true, enabled })
    } catch {
      return c.json({ error: 'DB error' }, 500)
    }
  })

  app.post('/api/settings/offline-db/update', (c) => {
    try {
      const info = offlineDb.getOfflineDbInfo(getDbs().db)
      if (info.isRefreshing) {
        return c.json({ error: 'Offline database refresh already in progress' }, 409)
      }
      offlineDb.refreshDatabase(getDbs().db).catch((err) => {
        logger.warn({ err: err?.message }, 'Manual offline database update failed')
      })
      return c.json({ message: 'Offline database refresh started' }, 202)
    } catch {
      return c.json({ error: 'DB error' }, 500)
    }
  })

  app.get('/api/import/mal-xml/status', (c) => {
    return c.json(getMalImportStatus())
  })

  app.post('/api/import/mal-xml/cancel', (c) => {
    return c.json(requestMalImportCancel())
  })

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

  app.post('/api/translate', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as
      { texts?: unknown; source?: unknown; target?: unknown } | undefined
    const { texts, source = 'ja', target = 'en' } = body ?? {}
    if (!Array.isArray(texts) || texts.length === 0) {
      return c.json({ translations: {} })
    }
    return c.json({
      translations: await translateTexts(texts, String(source), String(target)),
    })
  })

  app.get('/api/discord/gateway/status', (c) => {
    const hasToken = discordGatewayService.hasToken()
    return c.json({
      hasToken,
      masked: hasToken ? maskToken(process.env.DISCORD_GATEWAY_TOKEN) : null,
      enabled: discordGatewayService.serviceEnabled,
    })
  })

  app.post('/api/discord/gateway/save', async (c) => {
    const body = (await c.req.json()) as { token?: unknown }
    let token = ((body.token || '') as string).trim()
    if (token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1)
    if (token.length < 30) return c.json({ error: 'Token too short' }, 400)

    try {
      await updateEnvFile({ DISCORD_GATEWAY_TOKEN: token })
      discordGatewayService.reloadToken()
      gatewayLog.info(`Discord Gateway token saved ${maskToken(token)} (not logged)`)
      return c.json({ ok: true, masked: maskToken(token) })
    } catch (e) {
      gatewayLog.error({ err: e }, 'Failed to save Discord Gateway token')
      return c.json({ error: 'Failed to save token' }, 500)
    }
  })

  app.post('/api/discord/gateway/remove', async (c) => {
    try {
      await updateEnvFile({ DISCORD_GATEWAY_TOKEN: '' })
      discordGatewayService.reloadToken()
      gatewayLog.info('Discord Gateway token removed')
      return c.json({ ok: true })
    } catch (e) {
      gatewayLog.error({ err: e }, 'Failed to remove Discord Gateway token')
      return c.json({ error: 'Failed to remove token' }, 500)
    }
  })

  app.get('/api/insights', async (c) => {
    return c.json(await getWatchInsights(getDbs().db))
  })

  app.get('/api/insights/genre-cards', async (c) => {
    return c.json(await getGenreCards(getDbs().db))
  })

  app.get('/api/insights/recommendations', async (c) => {
    return c.json({ candidates: await getCachedRecommendations(getDbs().db) })
  })

  app.get('/api/insights/discord-sync-stats', async (c) => {
    return c.json(await computeDiscordSyncStats(getDbs().db))
  })

  app.get('/api/discord-roles-config', (c) => {
    return c.json({ workerUrl: CONFIG.DISCORD_ROLES_WORKER_URL || null })
  })

  app.get('/api/discord-user', async (c) => {
    return c.json({ user: await getLinkedDiscordUser(getDbs().db) })
  })

  app.post('/api/discord-user', async (c) => {
    const { user } = (await c.req.json()) as { user: { id?: unknown } | null }
    if (
      user !== null &&
      user !== undefined &&
      (typeof user !== 'object' || typeof user.id !== 'string' || !user.id)
    ) {
      return c.json({ error: 'Invalid user payload: expected { id, ... } or null' }, 400)
    }
    await setLinkedDiscordUser(getDbs().db, (user as never) || null)
    return c.json({ success: true, user: user || null })
  })

  app.post('/api/discord-sync-now', async (c) => {
    return c.json(await syncDiscordRoles(getDbs().db, true))
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

  app.get('/api/tracker/status', async (c) => {
    try {
      const tokenRow = await SettingsRepository.getByKey(getDbs().db, TRACKER_TOKEN_KEY)
      const userRow = await SettingsRepository.getByKey(getDbs().db, TRACKER_USER_KEY)
      let user: unknown = null
      if (userRow?.value) {
        try {
          user = JSON.parse(userRow.value)
        } catch {
          user = null
        }
      }
      return c.json({ anilist: { connected: !!tokenRow?.value, user } })
    } catch {
      return c.json({ error: 'Failed to read tracker status' }, 500)
    }
  })

  app.post('/api/tracker/anilist/auth', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { token?: unknown } | undefined
    const { token } = body ?? {}
    const accessToken = typeof token === 'string' ? token.trim() : ''
    if (!accessToken) {
      return c.json({ error: 'Access token is required' }, 400)
    }

    try {
      const tracker = new AniListTracker(accessToken)
      const viewer = await tracker.getViewer()

      await performWriteTransaction(getDbs().db, (tx) => {
        SettingsRepository.upsert(tx, TRACKER_TOKEN_KEY, accessToken)
        SettingsRepository.upsert(tx, TRACKER_USER_KEY, JSON.stringify(viewer))
      })

      return c.json({ success: true, user: viewer })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      return c.json({ error: message }, 401)
    }
  })

  app.post('/api/tracker/anilist/disconnect', async (c) => {
    try {
      await performWriteTransaction(getDbs().db, (tx) => {
        SettingsRepository.upsert(tx, TRACKER_TOKEN_KEY, '')
        SettingsRepository.upsert(tx, TRACKER_USER_KEY, '')
      })
      return c.json({ success: true })
    } catch {
      return c.json({ error: 'Failed to disconnect' }, 500)
    }
  })

  app.post('/api/tracker/sync', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { provider?: unknown } | undefined
    const { provider = 'anilist' } = body ?? {}
    if (provider !== 'anilist') {
      return c.json({ error: `Provider "${provider}" is not supported yet` }, 400)
    }
    try {
      const summary = await syncAniList(getDbs().db)
      return c.json({ success: true, summary })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      return c.json({ error: message }, 500)
    }
  })

  app.post('/api/tracker/anilist/import', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as
      { username?: unknown; erase?: unknown } | undefined
    const { username, erase } = body ?? {}
    if (!username || typeof username !== 'string') {
      return c.json({ error: 'Username is required' }, 400)
    }
    try {
      const count = await importFromUsername(getDbs().db, username.trim(), erase === true)
      return c.json({ success: true, count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      return c.json({ error: message }, 500)
    }
  })

  app.post('/api/tracker/mal/import', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as
      | { username?: unknown; erase?: unknown; useOfflineDb?: unknown; skipFallback?: unknown }
      | undefined
    const { username, erase, useOfflineDb, skipFallback } = body ?? {}
    if (!username || typeof username !== 'string') {
      return c.json({ error: 'MAL username is required' }, 400)
    }
    try {
      const count = await importFromMalUsername(getDbs().db, username.trim(), {
        erase: erase === true,
        useOfflineDb: useOfflineDb !== false,
        skipFallback: skipFallback === true,
      })
      return c.json({ success: true, count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      if (message.includes('private') || message.includes('not found')) {
        return c.json({ error: message }, 404)
      }
      if (message.includes('blocked') || message.includes('HTTP 429')) {
        return c.json({ error: message }, 429)
      }
      return c.json({ error: message }, 500)
    }
  })

  app.post('/api/tracker/manga/sync', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as { direction?: unknown } | undefined
    const { direction } = body ?? {}
    try {
      const mangaDb = getDbs().mangaDb
      if (!mangaDb || mangaDb.isClosedCheck()) {
        return c.json({ error: 'Manga database is not ready' }, 503)
      }
      const syncDirection = direction === 'pull-only' ? 'pull-only' : 'two-way'
      const result = await syncAniListManga(getDbs().db, mangaDb, {
        direction: syncDirection,
      })
      return c.json({
        success: true,
        summary: result.summary,
        details: result.details,
        direction: syncDirection,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Manga sync failed'
      return c.json({ error: message }, 500)
    }
  })

  app.post('/api/tracker/manga/import', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as
      { username?: unknown; erase?: unknown } | undefined
    const { username, erase } = body ?? {}
    if (!username || typeof username !== 'string') {
      return c.json({ error: 'Username is required' }, 400)
    }
    try {
      const mangaDb = getDbs().mangaDb
      if (!mangaDb || mangaDb.isClosedCheck()) {
        return c.json({ error: 'Manga database is not ready' }, 503)
      }
      const count = await importFromUsernameManga(
        getDbs().db,
        mangaDb,
        username.trim(),
        erase === true
      )
      return c.json({ success: true, count })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      return c.json({ error: message }, 500)
    }
  })

  app.post('/api/tracker/manga/mal-import', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as
      { username?: unknown; erase?: unknown } | undefined
    const { username, erase } = body ?? {}
    if (!username || typeof username !== 'string') {
      return c.json({ error: 'Username is required' }, 400)
    }
    try {
      const mangaDb = getDbs().mangaDb
      if (!mangaDb || mangaDb.isClosedCheck()) {
        return c.json({ error: 'Manga database is not ready' }, 503)
      }
      const result = await importMangaFromMalUsername(
        getDbs().db,
        mangaDb,
        username.trim(),
        erase === true
      )
      return c.json({ success: true, ...result })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed'
      if (message.includes('private') || message.includes('not found')) {
        return c.json({ error: message }, 404)
      }
      if (message.includes('blocked') || message.includes('HTTP 429')) {
        return c.json({ error: message }, 429)
      }
      return c.json({ error: message }, 500)
    }
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
      const before = LibraryRepository.countAll(dbs.db)
      const beforeManga = LibraryRepository.countManga(dbs.mangaDb)
      const beforeTv = LibraryRepository.countTv(dbs.tvDb)
      const beforeAsmr = LibraryRepository.countAsmr(dbs.asmrDb)
      await performWriteTransaction(dbs.db, (tx) => {
        LibraryRepository.clearAll(tx)
      })
      await performMangaWriteTransaction(dbs.mangaDb, (tx) => {
        LibraryRepository.clearManga(tx)
      })
      await performTvWriteTransaction(dbs.tvDb, (tx) => {
        LibraryRepository.clearTv(tx)
      })
      await performAsmrWriteTransaction(dbs.asmrDb, (tx) => {
        LibraryRepository.clearAsmr(tx)
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

  registerMangaLibrary(app, getDbs)
  registerTvLibrary(app, getDbs)
  registerAsmrLibrary(app, getDbs)
  registerMusic(app)
  registerRadio(app)
  registerAuth(app, getDbs, runSync)
  registerManga(app, media.getApiCache, media.getMangaProvider)
  registerWatchlist(app, getDbs)
  registerAsmr(app, media.getApiCache, media.getJasmr)
  registerTv(app, media.getApiCache, media.getTvProvider)
  registerProxy(app)
  registerData(app, getDbs, media.getApiCache, media.getProviders, providerApi.getCatalog)

  app.onError((err: Error & { status?: number }, c) => {
    logger.error({ err, url: c.req.path, method: c.req.method }, 'Unhandled error')
    const status = err.status || 500
    return c.json({ error: err.message || 'Internal Server Error', status }, status as never)
  })

  return app
}

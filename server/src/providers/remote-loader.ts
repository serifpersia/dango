import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'url'
import * as cheerio from 'cheerio'
import { gotScraping } from 'got-scraping'
import { AppCache } from '../utils/cache.utils.js'
import logger from '../logger.js'
import { CONFIG } from '../config.js'
import { requestContext } from '../utils/request-context.js'
import { sanitizeCfClearance, buildCfClearanceCookie } from '../utils/cookie.utils.js'
import { buildQueryVariants, pickBestMatch } from './title-matching.js'
import { anilistRequest, parseMalId, searchAnilistByTitle } from '../lib/anilist.js'
import type { AnilistResponse } from '../lib/anilist.js'
import { kitsuMetaByAnilistId } from '../lib/kitsu.js'
import type { Provider } from './provider.interface.js'
import type { MangaProvider } from './manga/manga.types.js'
import type { TvProvider } from './tv.types.js'
import { getTmdbKey, TMDB_BASE, TMDB_IMAGE } from '../lib/tmdb.js'
import {
  parseRegistry,
  type BrowseFacets,
  type ProviderCatalogItem,
  type RemoteProviderEntry,
  type RemoteRegistry,
} from './remote-types.js'

export interface RemoteLoadResult {
  providers: Record<string, Provider>
  mangaProviders: Record<string, MangaProvider>
  tvProviders: Record<string, TvProvider>
  catalog: ProviderCatalogItem[]
}

interface LoadOptions {
  cache: AppCache
  registryUrl?: string
  enabledProviders?: string[]
  allowUnsigned?: boolean
}

const FETCH_TIMEOUT_MS = 15000

const GENERIC_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

function isHttp(url: string): boolean {
  return /^https?:\/\//i.test(url)
}

function stripFilePrefix(p: string): string {
  if (p.startsWith('file://')) {
    const u = new URL(p)
    return u.pathname
  }
  return p
}

function looksLikePath(p: string): boolean {
  if (isHttp(p) || p.startsWith('file://')) return false
  return p.includes('/') || p.includes('\\') || p.endsWith('.json')
}

async function readManifestBytes(registryUrl: string): Promise<Buffer> {
  if (isHttp(registryUrl)) {
    const res = await withTimeout(
      fetch(registryUrl, { headers: { 'User-Agent': GENERIC_UA, Accept: 'application/json' } }),
      FETCH_TIMEOUT_MS,
      'registry fetch'
    )
    if (!res.ok) throw new Error(`registry HTTP ${res.status}: ${registryUrl}`)
    return Buffer.from(await res.arrayBuffer())
  }
  const filePath = path.resolve(stripFilePrefix(registryUrl))
  return await fs.promises.readFile(filePath)
}

async function readModuleBytes(entryUrl: string): Promise<Buffer> {
  if (isHttp(entryUrl)) {
    const res = await withTimeout(
      fetch(entryUrl, { headers: { 'User-Agent': GENERIC_UA, Accept: 'text/javascript,*/*' } }),
      FETCH_TIMEOUT_MS,
      'provider fetch'
    )
    if (!res.ok) throw new Error(`provider HTTP ${res.status}: ${entryUrl}`)
    return Buffer.from(await res.arrayBuffer())
  }
  const filePath = path.resolve(stripFilePrefix(entryUrl))
  return await fs.promises.readFile(filePath)
}

function resolveEntryUrl(entry: string, registryUrl: string): string {
  const e = entry.trim()
  if (isHttp(e) || e.startsWith('file://')) return e
  if (isHttp(registryUrl)) return new URL(e, registryUrl).href
  const baseDir = path.dirname(path.resolve(stripFilePrefix(registryUrl)))
  return path.resolve(baseDir, e)
}

function sha256Hex(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function base64UrlEncode(input: crypto.BinaryLike): string {
  return Buffer.from(input as unknown as Uint8Array)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function aes256CbcDecryptJson(b64url: string, keyUtf8: string, ivUtf8: string): unknown | null {
  let encrypted: Buffer
  try {
    encrypted = Buffer.from(b64url, 'base64url')
  } catch {
    return null
  }
  if (!encrypted.length || encrypted.length % 16 !== 0) return null
  try {
    const key = Buffer.alloc(32)
    Buffer.from(keyUtf8).copy(key)
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivUtf8))
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
    return JSON.parse(decrypted.toString('utf8')) as unknown
  } catch {
    return null
  }
}

function curlRaw(
  url: string,
  headers?: Record<string, string>
): { status: number; body: string } | null {
  const args = [
    '-sSL',
    '-A',
    GENERIC_UA,
    ...Object.entries(headers ?? {}).flatMap(([k, v]) => ['-H', `${k}: ${v}`]),
    '--max-time',
    '15',
    '-w',
    '\n__HTTP_STATUS__%{http_code}',
    '--',
    url,
  ]
  let out: string
  try {
    out = execFileSync('curl', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 })
  } catch {
    return null
  }
  const m = out.match(/__HTTP_STATUS__(\d+)\s*$/)
  const status = m ? parseInt(m[1], 10) : 0
  return { status, body: m && m.index !== undefined ? out.slice(0, m.index) : out }
}

function createCtx(cache: AppCache) {
  const fetchWithTimeout = async (url: string, init?: RequestInit, ms = FETCH_TIMEOUT_MS) => {
    return withTimeout(
      fetch(url, {
        ...init,
        headers: { 'User-Agent': GENERIC_UA, ...(init?.headers as Record<string, string>) },
      }),
      ms,
      `fetch ${url}`
    )
  }
  return {
    cache: {
      get: <T>(key: string): T | undefined => cache.get<T>(key),
      set: (key: string, value: unknown, ttlSeconds?: number): void => {
        cache.set(key, value, ttlSeconds)
      },
    },
    logger: {
      info: (obj: unknown, msg?: string): void => {
        logger.info(obj as Record<string, unknown>, msg)
      },
      warn: (obj: unknown, msg?: string): void => {
        logger.warn(obj as Record<string, unknown>, msg)
      },
      error: (obj: unknown, msg?: string): void => {
        logger.error(obj as Record<string, unknown>, msg)
      },
      debug: (obj: unknown, msg?: string): void => {
        logger.debug(obj as Record<string, unknown>, msg)
      },
    },
    fetchText: async (url: string, init?: RequestInit): Promise<string | null> => {
      try {
        const res = await fetchWithTimeout(url, init)
        if (!res.ok) return null
        return await res.text()
      } catch {
        return null
      }
    },
    fetchJson: async <T>(url: string, init?: RequestInit): Promise<T> => {
      const res = await fetchWithTimeout(url, init)
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
      return (await res.json()) as T
    },
    proxyUrl: (rawUrl: string, referer: string): string => {
      return `/api/proxy?url=${encodeURIComponent(rawUrl)}&referer=${encodeURIComponent(referer)}`
    },
    userAgent: GENERIC_UA,
    titleMatch: {
      buildQueryVariants,
      pickBestMatch,
    },
    anilist: {
      request: <T>(query: string, vars?: Record<string, unknown>): Promise<AnilistResponse<T>> =>
        anilistRequest<T>(query, vars),
      parseMalId,
      searchByTitle: searchAnilistByTitle,
    },
    kitsu: {
      metaByAnilistId: kitsuMetaByAnilistId,
    },
    tmdb: {
      base: TMDB_BASE,
      image: TMDB_IMAGE,
      get: async <T>(path: string): Promise<T | null> => {
        try {
          const key = await getTmdbKey()
          const sep = path.includes('?') ? '&' : '?'
          const res = await fetchWithTimeout(`${TMDB_BASE}${path}${sep}api_key=${key}`)
          if (!res.ok) return null
          return (await res.json()) as T
        } catch {
          return null
        }
      },
    },
    request: {
      get: (key: string): string | undefined => requestContext.getStore()?.get(key),
    },
    cookies: {
      sanitizeCfClearance,
      buildCfClearanceCookie,
    },
    crypto: {
      aes256CbcDecryptJson,
      hmacSha256Base64Url: (key: string, message: string): string =>
        base64UrlEncode(crypto.createHmac('sha256', key).update(message).digest()),
    },
    scraping: {
      fetch: async (
        urlOrOptions: string | Record<string, unknown>,
        maybeOptions?: Record<string, unknown>
      ): Promise<{ statusCode: number; body: string; headers: unknown }> => {
        const opts = (
          typeof urlOrOptions === 'string'
            ? { url: urlOrOptions, ...(maybeOptions ?? {}) }
            : urlOrOptions
        ) as Record<string, unknown>
        const { url, ...rest } = opts
        const res = await (
          gotScraping as unknown as (
            ...args: unknown[]
          ) => Promise<{ statusCode: number; body: unknown; headers: unknown }>
        )(url as string, {
          method: 'GET',
          responseType: 'text',
          throwHttpErrors: false,
          ...rest,
        })
        return { statusCode: res.statusCode, body: String(res.body ?? ''), headers: res.headers }
      },
    },
    curl: {
      getJson: async <T>(url: string, headers?: Record<string, string>): Promise<T | null> => {
        try {
          const r = curlRaw(url, headers)
          if (!r || r.status !== 200) return null
          return JSON.parse(r.body) as T
        } catch {
          return null
        }
      },
      getText: async (url: string, headers?: Record<string, string>): Promise<string | null> => {
        const r = curlRaw(url, headers)
        if (!r || r.status !== 200) return null
        return r.body
      },
    },
    cheerio: {
      load: (html: string): ReturnType<typeof cheerio.load> => cheerio.load(html),
    },
  }
}

export type RemoteCtx = ReturnType<typeof createCtx>

function isValidVideoProvider(p: unknown): p is Provider {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return (
    typeof o.name === 'string' &&
    typeof o.search === 'function' &&
    typeof o.getEpisodes === 'function' &&
    typeof o.getStreamUrls === 'function'
  )
}

function isValidMangaProvider(p: unknown): p is MangaProvider {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return (
    typeof o.name === 'string' &&
    typeof o.search === 'function' &&
    typeof o.getDetail === 'function' &&
    typeof o.getChapters === 'function' &&
    typeof o.getPages === 'function'
  )
}

function isValidTvProvider(p: unknown): p is TvProvider {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return (
    typeof o.name === 'string' &&
    (typeof o.getSources === 'function' || typeof o.getEmbedUrl === 'function')
  )
}

async function loadEntry(
  item: RemoteProviderEntry,
  registryUrl: string,
  cacheDir: string,
  ctx: RemoteCtx,
  allowUnsigned: boolean
): Promise<{ provider: unknown; facets?: BrowseFacets; error?: string }> {
  const entryUrl = resolveEntryUrl(item.entry, registryUrl)
  await fs.promises.mkdir(cacheDir, { recursive: true })
  const fileName = `${item.id}-${item.version}.mjs`
  const filePath = path.join(cacheDir, fileName)
  const instanceKey = `${item.kind ?? 'anime'}:${item.id}-${item.version}-${(item.sha256 ?? 'nosha').slice(0, 12)}`
  let bytes: Buffer | null = null
  try {
    const cached = await fs.promises.readFile(filePath)
    if (item.sha256 && sha256Hex(cached) === item.sha256) {
      bytes = cached
    } else if (!item.sha256 && allowUnsigned) {
      bytes = cached
    }
  } catch {
    // ignore
  }
  if (bytes) {
    const hit = instanceCache.get(instanceKey)
    if (hit) {
      logger.debug(
        { provider: item.id, version: item.version },
        'remote provider reused cached instance'
      )
      return { provider: hit.provider, facets: hit.facets }
    }
  } else {
    try {
      bytes = await readModuleBytes(entryUrl)
    } catch (err) {
      return {
        provider: null as unknown as Provider,
        error: `download failed: ${(err as Error).message}`,
      }
    }
    if (item.sha256) {
      const actual = sha256Hex(bytes)
      if (actual !== item.sha256) {
        return { provider: null as unknown as Provider, error: `sha256 mismatch for ${item.id}` }
      }
    } else if (!allowUnsigned) {
      return { provider: null as unknown as Provider, error: `missing sha256 for ${item.id}` }
    }
    await fs.promises.writeFile(filePath, bytes)
  }
  const cacheBuster = `${item.version}-${(item.sha256 ?? 'nosha').slice(0, 12)}`
  const result = await instantiateModule(filePath, cacheBuster, ctx, item)
  if (result.provider && !result.error) {
    instanceCache.set(instanceKey, { provider: result.provider, facets: result.facets })
  }
  return result
}

const instanceCache = new Map<string, { provider: unknown; facets?: BrowseFacets }>()

function extractBrowseFacets(mod: Record<string, unknown>): BrowseFacets | undefined {
  let genres: string[] | undefined
  let orders: string[] | undefined
  for (const [key, value] of Object.entries(mod)) {
    if (key === 'default' || !Array.isArray(value) || value.length === 0) continue
    if (!value.every((v): v is string => typeof v === 'string' && v.length > 0)) continue
    const list = (value as string[]).filter((v) => v.length <= 64).slice(0, 500)
    if (list.length === 0) continue
    const name = key.toUpperCase()
    if (name.includes('GENRE') || name.includes('TAG')) {
      genres ??= list
    } else if (name.includes('ORDER') || name.includes('SORT')) {
      orders ??= list
    }
  }
  if (!genres && !orders) return undefined
  return { ...(genres ? { genres } : {}), ...(orders ? { orders } : {}) }
}

async function instantiateModule(
  filePath: string,
  cacheBuster: string,
  ctx: RemoteCtx,
  item: RemoteProviderEntry
): Promise<{ provider: unknown; facets?: BrowseFacets; error?: string }> {
  const id = item.id
  let mod: Record<string, unknown>
  try {
    const importUrl = `${pathToFileURL(filePath).href}?v=${encodeURIComponent(cacheBuster)}`
    mod = (await withTimeout(import(importUrl), FETCH_TIMEOUT_MS, `import ${id}`)) as Record<
      string,
      unknown
    >
  } catch (err) {
    return {
      provider: null as unknown as Provider,
      error: `import failed: ${(err as Error).message}`,
    }
  }
  const factory = mod.default
  if (typeof factory !== 'function') {
    return { provider: null as unknown as Provider, error: 'missing default factory export' }
  }
  let provider: unknown
  try {
    provider = await withTimeout(
      Promise.resolve((factory as (ctx: RemoteCtx) => unknown)(ctx)),
      10000,
      `factory ${id}`
    )
  } catch (err) {
    return {
      provider: null as unknown as Provider,
      error: `factory failed: ${(err as Error).message}`,
    }
  }
  if (
    item.kind === 'manga'
      ? !isValidMangaProvider(provider)
      : item.kind === 'tv'
        ? !isValidTvProvider(provider)
        : !isValidVideoProvider(provider)
  ) {
    return { provider: null as unknown as Provider, error: 'invalid provider shape' }
  }
  return { provider, facets: extractBrowseFacets(mod) }
}

async function loadCachedFallback(
  item: RemoteProviderEntry,
  prev: RemoteProviderEntry,
  cacheDir: string,
  ctx: RemoteCtx
): Promise<{ provider: unknown; facets?: BrowseFacets; error?: string }> {
  if (!prev.sha256) return { provider: null as unknown as Provider, error: 'no verified fallback' }
  const filePath = path.join(cacheDir, `${prev.id}-${prev.version}.mjs`)
  let bytes: Buffer
  try {
    bytes = await fs.promises.readFile(filePath)
  } catch {
    return { provider: null as unknown as Provider, error: 'no cached fallback file' }
  }
  if (sha256Hex(bytes) !== prev.sha256) {
    return { provider: null as unknown as Provider, error: 'cached fallback failed verification' }
  }
  const cacheBuster = `${prev.version}-${prev.sha256.slice(0, 12)}`
  return instantiateModule(filePath, cacheBuster, ctx, { ...item, version: prev.version })
}

export async function loadRemoteProviders(opts: LoadOptions): Promise<RemoteLoadResult> {
  const registryUrl = (opts.registryUrl ?? CONFIG.PROVIDER_REPO_URL ?? '').trim()
  const out: RemoteLoadResult = { providers: {}, mangaProviders: {}, tvProviders: {}, catalog: [] }
  if (!registryUrl) return out
  const cacheDir = path.join(CONFIG.ROOT, 'remote-providers')
  const cachedManifestPath = path.join(cacheDir, 'registry.json')
  let prevRegistry: RemoteRegistry | null = null
  try {
    prevRegistry = parseRegistry(
      JSON.parse((await fs.promises.readFile(cachedManifestPath)).toString('utf8'))
    )
  } catch {
    // ignore
  }
  const prevById = new Map((prevRegistry?.providers ?? []).map((p) => [p.id.toLowerCase(), p]))
  let raw: unknown
  try {
    const bytes = await readManifestBytes(registryUrl)
    raw = JSON.parse(bytes.toString('utf8'))
    await fs.promises.mkdir(cacheDir, { recursive: true })
    await fs.promises.writeFile(cachedManifestPath, JSON.stringify(raw))
  } catch (err) {
    logger.error({ err, registryUrl }, 'remote providers: manifest fetch failed, trying disk cache')
    try {
      raw = JSON.parse((await fs.promises.readFile(cachedManifestPath)).toString('utf8'))
    } catch {
      return out
    }
  }
  let registry
  try {
    registry = parseRegistry(raw)
  } catch (err) {
    logger.error({ err, registryUrl }, 'remote providers: manifest parse failed')
    return out
  }
  const enabledSet = new Set((opts.enabledProviders ?? []).map((s) => s.toLowerCase()))
  const explicitFilter = enabledSet.size > 0
  const ctx = createCtx(opts.cache)
  const allowUnsigned =
    opts.allowUnsigned ??
    (process.env.DANGO_ALLOW_UNSIGNED_PROVIDERS === '1' || looksLikePath(registryUrl))
  for (const item of registry.providers) {
    const key = item.id.toLowerCase()
    if (item.enabledByDefault === false && (!explicitFilter || !enabledSet.has(key))) {
      out.catalog.push(toCatalog(item, false, 'disabled by default'))
      continue
    }
    if (explicitFilter && !enabledSet.has(key)) {
      out.catalog.push(toCatalog(item, false, 'not in enabledProviders'))
      continue
    }
    const { provider, facets, error } = await loadEntry(
      item,
      registryUrl,
      cacheDir,
      ctx,
      allowUnsigned
    )
    if (provider && !error) {
      if (item.kind === 'manga' && isValidMangaProvider(provider)) {
        out.mangaProviders[key] = provider
      } else if (item.kind === 'tv' && isValidTvProvider(provider)) {
        out.tvProviders[key] = provider
      } else if (item.kind !== 'manga' && item.kind !== 'tv' && isValidVideoProvider(provider)) {
        out.providers[key] = provider
      } else {
        out.catalog.push(toCatalog(item, false, 'invalid provider shape for kind'))
        logger.warn({ provider: item.id }, 'remote provider kind mismatch, skipped')
        continue
      }
      out.catalog.push(withFacets(facets, withServers(item, provider, toCatalog(item, true))))
      logger.info({ provider: item.id, version: item.version }, 'remote provider loaded')
    } else {
      const prev = prevById.get(key)
      if (prev && prev.version !== item.version) {
        const fb = await loadCachedFallback(item, prev, cacheDir, ctx)
        if (fb.provider && !fb.error) {
          if (item.kind === 'manga' && isValidMangaProvider(fb.provider)) {
            out.mangaProviders[key] = fb.provider
          } else if (item.kind === 'tv' && isValidTvProvider(fb.provider)) {
            out.tvProviders[key] = fb.provider
          } else if (
            item.kind !== 'manga' &&
            item.kind !== 'tv' &&
            isValidVideoProvider(fb.provider)
          ) {
            out.providers[key] = fb.provider
          } else {
            fb.error = 'cached fallback failed validation'
          }
        }
        if (fb.provider && !fb.error) {
          out.catalog.push({
            ...withFacets(
              fb.facets,
              withServers(item, fb.provider, toCatalog({ ...item, version: prev.version }, true))
            ),
            error: `serving cached ${prev.version}: ${error}`,
          })
          logger.warn(
            { provider: item.id, error, fallback: prev.version },
            'remote provider update failed, serving cached version'
          )
          continue
        }
      }
      out.catalog.push(toCatalog(item, false, error))
      logger.warn({ provider: item.id, error }, 'remote provider skipped')
    }
  }
  const failedIds = new Set(out.catalog.filter((c) => !c.loaded).map((c) => `${c.id}-`))
  try {
    const expected = new Set(
      registry.providers.map((item) => `${item.id}-${item.version}.mjs`.toLowerCase())
    )
    const expectedInstances = new Set(
      registry.providers.map((item) =>
        `${item.kind ?? 'anime'}:${item.id}-${item.version}-${(item.sha256 ?? 'nosha').slice(0, 12)}`.toLowerCase()
      )
    )
    for (const key of instanceCache.keys()) {
      if (!expectedInstances.has(key.toLowerCase())) instanceCache.delete(key)
    }
    const files = await fs.promises.readdir(cacheDir)
    for (const file of files) {
      if (!file.toLowerCase().endsWith('.mjs')) continue
      if (!expected.has(file.toLowerCase())) {
        if ([...failedIds].some((prefix) => file.toLowerCase().startsWith(prefix))) continue
        await fs.promises.unlink(path.join(cacheDir, file))
        logger.info({ file }, 'remote providers: removed superseded module')
      }
    }
  } catch (err) {
    logger.warn({ err }, 'remote providers: superseded module cleanup failed')
  }
  return out
}

function withServers(
  item: RemoteProviderEntry,
  provider: unknown,
  cat: ProviderCatalogItem
): ProviderCatalogItem {
  if (item.kind !== 'tv' || !provider || typeof provider !== 'object') return cat
  const servers = (provider as { servers?: unknown }).servers
  if (Array.isArray(servers) && servers.every((s) => typeof s === 'string') && servers.length > 0) {
    return { ...cat, servers: [...servers] }
  }
  return cat
}

function withFacets(
  facets: BrowseFacets | undefined,
  cat: ProviderCatalogItem
): ProviderCatalogItem {
  const genres = (facets?.genres ?? []).length > 0 ? facets?.genres : undefined
  const orders = (facets?.orders ?? []).length > 0 ? facets?.orders : undefined
  if (!genres && !orders) return cat
  return { ...cat, facets: { ...(genres ? { genres } : {}), ...(orders ? { orders } : {}) } }
}

function toCatalog(
  item: RemoteProviderEntry,
  loaded: boolean,
  error?: string
): ProviderCatalogItem {
  return {
    id: item.id.toLowerCase(),
    label: item.label,
    version: item.version,
    mature: item.mature,
    kind: item.kind ?? 'anime',
    sub: item.sub,
    tier: item.tier,
    modes: item.modes ?? (item.kind === 'tv' ? [] : ['sub', 'dub']),
    browse: item.browse,
    enabledByDefault: item.enabledByDefault !== false,
    loaded,
    remote: true,
    error,
  }
}

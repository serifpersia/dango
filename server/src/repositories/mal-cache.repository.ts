import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { CONFIG } from '../config'
import { DatabaseWrapper } from '../db'
import { dbGet, dbRun } from '../utils/db-utils'
import type { MalCacheStore } from '../lib/mal'

export const MAL_CACHE_MAX_ROWS = 5000
const DEFAULT_TTL_SECONDS = 6 * 3600

function cacheFile(): string {
  return path.join(CONFIG.ROOT, CONFIG.IS_DEV ? 'mal-cache.dev.db' : 'mal-cache.db')
}

let handle: DatabaseWrapper | null = null

function db(): DatabaseWrapper {
  if (!handle) {
    const file = cacheFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    handle = new DatabaseWrapper(file, new DatabaseSync(file))
    dbRun(
      handle,
      `CREATE TABLE IF NOT EXISTS mal_cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL)`
    )
  }
  return handle
}

export function malCacheGet(key: string): { payload: string; fresh: boolean } | null {
  const row = dbGet<{ payload: string; fetchedAt: string; expiresAt: string }>(
    db(),
    'SELECT payload, fetched_at AS fetchedAt, expires_at AS expiresAt FROM mal_cache WHERE key = ?',
    [key]
  )
  if (!row) return null
  return { payload: row.payload, fresh: Date.now() < Date.parse(row.expiresAt) }
}

export function malCachePut(
  key: string,
  payload: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): void {
  const database = db()
  const now = new Date()
  dbRun(
    database,
    'INSERT OR REPLACE INTO mal_cache (key, payload, fetched_at, expires_at) VALUES (?, ?, ?, ?)',
    [key, payload, now.toISOString(), new Date(now.getTime() + ttlSeconds * 1000).toISOString()]
  )
  const count =
    dbGet<{ rows: number }>(database, 'SELECT COUNT(*) AS rows FROM mal_cache')?.rows ?? 0
  if (count < MAL_CACHE_MAX_ROWS) return
  malCachePruneExpired()
  const remaining =
    dbGet<{ rows: number }>(database, 'SELECT COUNT(*) AS rows FROM mal_cache')?.rows ?? 0
  if (remaining < MAL_CACHE_MAX_ROWS) return
  dbRun(
    database,
    `DELETE FROM mal_cache WHERE key NOT IN (SELECT key FROM mal_cache ORDER BY fetched_at DESC LIMIT ${MAL_CACHE_MAX_ROWS})`
  )
}

export function malCachePruneExpired(): number {
  const now = new Date().toISOString()
  const row = dbGet<{ rows: number }>(
    db(),
    'SELECT COUNT(*) AS rows FROM mal_cache WHERE expires_at < ?',
    [now]
  )
  dbRun(db(), 'DELETE FROM mal_cache WHERE expires_at < ?', [now])
  return row?.rows ?? 0
}

export function malCacheDelete(key: string): void {
  dbRun(db(), 'DELETE FROM mal_cache WHERE key = ?', [key])
}

export function malCacheStore(): MalCacheStore {
  return {
    get: (key) => malCacheGet(key),
    put: (key, payload, ttl) => malCachePut(key, payload, ttl),
  }
}

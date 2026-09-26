import { drizzle, type RemoteCallback } from 'drizzle-orm/sqlite-proxy'
import type { DatabaseWrapper } from '../db.js'

type BindParam = string | number | bigint | null | Uint8Array

export function createDrizzle(db: DatabaseWrapper) {
  const callback: RemoteCallback = async (sql, params, method) => {
    const args = params as BindParam[]
    if (method === 'run') {
      db.run(sql, args)
      return { rows: [] }
    }
    if (method === 'get') {
      const row = db.get(sql, args)
      return { rows: row === undefined ? [] : [row] }
    }
    const rows = db.all(sql, args)
    if (method === 'values') {
      return { rows: rows.map((r) => Object.values(r as Record<string, unknown>)) }
    }
    return { rows }
  }
  return drizzle(callback)
}

export type AnimeDb = ReturnType<typeof createDrizzle>

const cache = new WeakMap<DatabaseWrapper, AnimeDb>()

export function getDrizzle(db: DatabaseWrapper): AnimeDb {
  let d = cache.get(db)
  if (!d) {
    d = createDrizzle(db)
    cache.set(db, d)
  }
  return d
}

export async function runTx(db: DatabaseWrapper, fn: (tx: DatabaseWrapper) => Promise<void>) {
  await db.transact(fn)
}

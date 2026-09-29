import { drizzle } from 'drizzle-orm/node-sqlite'
import type { DatabaseWrapper } from '../db.js'

export function createDrizzle(db: DatabaseWrapper) {
  return drizzle({ client: db.getClient() })
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

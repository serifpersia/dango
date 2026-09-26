import { eq, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { settings, watchlist } from '../db/schema-anime.js'

export const SettingsRepository = {
  getByKey: async (db: DatabaseWrapper, key: string) => {
    const rows = await getDrizzle(db).all<{ value: string }>(
      sql`SELECT value FROM settings WHERE key = ${key}`
    )
    return rows[0]
  },

  upsert: (db: DatabaseWrapper, key: string, value: string) =>
    getDrizzle(db)
      .insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } }),

  deleteByKey: (db: DatabaseWrapper, key: string) =>
    getDrizzle(db).delete(settings).where(eq(settings.key, key)),

  clearWatchlist: (db: DatabaseWrapper) => getDrizzle(db).delete(watchlist),

  upsertWatchlistBatch: (
    db: DatabaseWrapper,
    shows: { id: string; name: string; thumbnail?: string; status: string }[]
  ) => {
    if (shows.length === 0) return Promise.resolve()
    return getDrizzle(db).run(sql`
      INSERT OR REPLACE INTO watchlist (id, name, thumbnail, status) VALUES
      ${sql.join(
        shows.map((s) => sql`(${s.id}, ${s.name}, ${s.thumbnail ?? null}, ${s.status})`),
        sql`, `
      )}`)
  },
}

import { and, eq, inArray, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { showsMeta } from '../db/schema-anime.js'

export const ShowsMetaRepository = {
  getById: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<unknown>(sql`SELECT * FROM shows_meta WHERE id = ${id}`)
    return rows[0]
  },

  getStatus: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<{ status: string }>(
      sql`SELECT status FROM shows_meta WHERE id = ${id}`
    )
    return rows[0]?.status
  },

  getAnilistId: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<{ anilistId: number }>(
      sql`SELECT anilistId FROM shows_meta WHERE id = ${id} AND anilistId IS NOT NULL`
    )
    return rows[0]?.anilistId ?? null
  },

  getAnilistIdMap: async (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return new Map<string, number>()
    const rows = await getDrizzle(db)
      .select({ id: showsMeta.id, anilistId: showsMeta.anilistId })
      .from(showsMeta)
      .where(inArray(showsMeta.id, ids))
    const map = new Map<string, number>()
    for (const row of rows) {
      if (row.anilistId) map.set(row.id, row.anilistId)
    }
    return map
  },

  getByAnilistId: async (db: DatabaseWrapper, anilistId: number) => {
    const rows = await getDrizzle(db).all<{ id: string; name: string }>(
      sql`SELECT id, name FROM shows_meta WHERE anilistId = ${anilistId}`
    )
    return rows[0] ?? null
  },

  getWatchlistedIdByAnilistId: async (db: DatabaseWrapper, anilistId: number) => {
    const rows = await getDrizzle(db).all<{ id: string }>(
      sql`SELECT id FROM shows_meta WHERE anilistId = ${anilistId} AND id IN (SELECT id FROM watchlist)`
    )
    return rows[0]?.id ?? null
  },

  upsert: (
    db: DatabaseWrapper,
    data: {
      id: string
      name?: string
      thumbnail?: string
      nativeName?: string
      englishName?: string
      genres?: string
      popularityScore?: number
      status?: string
      episodeCount?: number
      type?: string
      anilistId?: number
      isAdult?: number | null
      episodeDuration?: number
    }
  ) => {
    const row = {
      id: data.id,
      name: data.name ?? null,
      thumbnail: data.thumbnail ?? null,
      nativeName: data.nativeName ?? null,
      englishName: data.englishName ?? null,
      genres: data.genres ?? null,
      popularityScore: data.popularityScore ?? null,
      status: data.status ?? null,
      episodeCount: data.episodeCount ?? null,
      type: data.type ?? null,
      anilistId: data.anilistId ?? null,
      isAdult: data.isAdult ?? null,
      episodeDuration: data.episodeDuration ?? null,
    }
    return getDrizzle(db)
      .insert(showsMeta)
      .values(row)
      .onConflictDoUpdate({
        target: showsMeta.id,
        set: {
          name: sql`COALESCE(NULLIF(${row.name}, ''), ${showsMeta.name})`,
          thumbnail: sql`COALESCE(NULLIF(${row.thumbnail}, ''), ${showsMeta.thumbnail})`,
          nativeName: sql`COALESCE(NULLIF(${row.nativeName}, ''), ${showsMeta.nativeName})`,
          englishName: sql`COALESCE(NULLIF(${row.englishName}, ''), ${showsMeta.englishName})`,
          genres: sql`COALESCE(NULLIF(${row.genres}, ''), ${showsMeta.genres})`,
          popularityScore: sql`COALESCE(${row.popularityScore}, ${showsMeta.popularityScore})`,
          status: sql`COALESCE(NULLIF(${row.status}, ''), ${showsMeta.status})`,
          episodeCount: sql`COALESCE(${row.episodeCount}, ${showsMeta.episodeCount})`,
          type: sql`COALESCE(NULLIF(${row.type}, ''), ${showsMeta.type})`,
          anilistId: sql`COALESCE(${row.anilistId}, ${showsMeta.anilistId})`,
          isAdult: sql`COALESCE(${row.isAdult}, ${showsMeta.isAdult})`,
          episodeDuration: sql`COALESCE(NULLIF(${row.episodeDuration}, 0), ${showsMeta.episodeDuration})`,
        },
      })
  },

  updateEpisodeCount: (db: DatabaseWrapper, id: string, episodeCount: number) =>
    getDrizzle(db).update(showsMeta).set({ episodeCount }).where(eq(showsMeta.id, id)),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    getDrizzle(db).update(showsMeta).set({ status }).where(eq(showsMeta.id, id)),

  cleanupOrphanedMeta: (db: DatabaseWrapper) =>
    getDrizzle(db).run(sql`
      DELETE FROM shows_meta WHERE id NOT IN (SELECT id FROM watchlist) AND id NOT IN (SELECT showId FROM queue)`),

  getShowIdsMissingMeta: (db: DatabaseWrapper) =>
    getDrizzle(db).all<{ id: string }>(sql`
      SELECT DISTINCT we.showId as id FROM watched_episodes we
      LEFT JOIN shows_meta sm ON sm.id = we.showId
      WHERE sm.thumbnail IS NULL OR TRIM(sm.thumbnail) = ''`),

  getAdultIds: async (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return []
    const rows = await getDrizzle(db)
      .select({ id: showsMeta.id })
      .from(showsMeta)
      .where(and(inArray(showsMeta.id, ids), eq(showsMeta.isAdult, 1)))
    return rows.map((r) => r.id)
  },

  getGenresById: async (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return new Map<string, string[]>()
    const rows = await getDrizzle(db)
      .select({ id: showsMeta.id, genres: showsMeta.genres })
      .from(showsMeta)
      .where(inArray(showsMeta.id, ids))
    return new Map(rows.map((r) => [r.id, r.genres ? (JSON.parse(r.genres) as string[]) : []]))
  },

  backfillNamesFromWatchlist: (db: DatabaseWrapper) =>
    getDrizzle(db).run(sql`
      UPDATE shows_meta SET name = (SELECT w.name FROM watchlist w WHERE w.id = shows_meta.id)
      WHERE (name IS NULL OR TRIM(name) = '')
      AND EXISTS (SELECT 1 FROM watchlist w WHERE w.id = shows_meta.id AND w.name IS NOT NULL AND TRIM(w.name) != '')`),
}

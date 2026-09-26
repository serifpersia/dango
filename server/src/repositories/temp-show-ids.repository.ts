import { sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { tempShowIds } from '../db/schema-anime.js'
import { TEMP_SHOW_ID_PREFIX } from '../lib/temp-ids.js'

export interface TempShowRow {
  id: string
  provider: string
  nativeId: string
  title: string
  thumbnail: string
  createdAt: number
}

export const TempShowIdsRepository = {
  getById: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<TempShowRow>(
      sql`SELECT * FROM temp_show_ids WHERE id = ${id}`
    )
    return rows[0]
  },

  getByProviderNative: async (db: DatabaseWrapper, provider: string, nativeId: string) => {
    const rows = await getDrizzle(db).all<TempShowRow>(
      sql`SELECT * FROM temp_show_ids WHERE provider = ${provider} AND nativeId = ${nativeId}`
    )
    return rows[0]
  },

  count: async (db: DatabaseWrapper) => {
    const rows = await getDrizzle(db).all<{ total: number }>(
      sql`SELECT COUNT(*) as total FROM temp_show_ids`
    )
    return rows[0]?.total || 0
  },

  allocate: async (
    db: DatabaseWrapper,
    data: { provider: string; nativeId: string; title: string; thumbnail?: string }
  ): Promise<TempShowRow> => {
    const existing = await TempShowIdsRepository.getByProviderNative(
      db,
      data.provider,
      data.nativeId
    )
    if (existing) return existing

    const prefixLen = TEMP_SHOW_ID_PREFIX.length + 1
    const maxRows = await getDrizzle(db).all<{ maxId: number | null }>(sql`
      SELECT MAX(CAST(SUBSTR(id, ${prefixLen}) AS INTEGER)) as maxId FROM temp_show_ids WHERE id LIKE ${`${TEMP_SHOW_ID_PREFIX}%`}`)
    const next = (maxRows[0]?.maxId || 0) + 1
    const id = `${TEMP_SHOW_ID_PREFIX}${next}`

    try {
      await getDrizzle(db)
        .insert(tempShowIds)
        .values({
          id,
          provider: data.provider,
          nativeId: data.nativeId,
          title: data.title,
          thumbnail: data.thumbnail || '',
          createdAt: Date.now(),
        })
    } catch {
      const winner = await TempShowIdsRepository.getByProviderNative(
        db,
        data.provider,
        data.nativeId
      )
      if (winner) return winner
      throw new Error('temp id allocation failed')
    }

    return (await TempShowIdsRepository.getById(db, id)) as TempShowRow
  },

  purge: async (db: DatabaseWrapper): Promise<number> => {
    const total = await TempShowIdsRepository.count(db)
    if (total === 0) return 0
    const likePattern = `${TEMP_SHOW_ID_PREFIX}%`
    await getDrizzle(db).run(sql`DELETE FROM watchlist WHERE id LIKE ${likePattern}`)
    await getDrizzle(db).run(sql`DELETE FROM watched_episodes WHERE showId LIKE ${likePattern}`)
    await getDrizzle(db).run(sql`DELETE FROM queue WHERE showId LIKE ${likePattern}`)
    await getDrizzle(db).run(sql`DELETE FROM shows_meta WHERE id LIKE ${likePattern}`)
    await getDrizzle(db).run(
      sql`DELETE FROM dismissed_notifications WHERE showId LIKE ${likePattern}`
    )
    await getDrizzle(db).run(
      sql`DELETE FROM discovered_notifications WHERE showId LIKE ${likePattern}`
    )
    await getDrizzle(db).run(sql`
      DELETE FROM legacy_id_mapping WHERE legacyId LIKE ${likePattern} OR numericId LIKE ${likePattern}`)
    await getDrizzle(db).delete(tempShowIds)
    return total
  },
}

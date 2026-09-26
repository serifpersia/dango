import { and, eq, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { queue } from '../db/schema-anime.js'

export interface QueueRow {
  id: number
  showId: string
  episodeNumber: string
  queue_order: number
  name?: string
  thumbnail?: string
  nativeName?: string
  englishName?: string
  type?: string
}

export interface SuggestedEpisode {
  showId: string
  episodeNumber: string
  resumeTime: number
}

export const QueueRepository = {
  getAll: (db: DatabaseWrapper) =>
    getDrizzle(db).all<QueueRow>(sql`
      SELECT
        q.id,
        q.showId,
        q.episodeNumber,
        q.queue_order,
        COALESCE(NULLIF(sm.name, ''), w.name) as name,
        COALESCE(NULLIF(sm.thumbnail, ''), NULLIF(w.thumbnail, ''), '') as thumbnail,
        COALESCE(NULLIF(sm.nativeName, ''), w.nativeName) as nativeName,
        COALESCE(NULLIF(sm.englishName, ''), w.englishName) as englishName,
        COALESCE(NULLIF(sm.type, ''), w.type) as type
      FROM queue q
      LEFT JOIN shows_meta sm ON q.showId = sm.id
      LEFT JOIN watchlist w ON q.showId = w.id
      ORDER BY q.queue_order ASC, q.id ASC`),

  getByEpisode: async (db: DatabaseWrapper, showId: string, episodeNumber: string) => {
    const rows = await getDrizzle(db).all<QueueRow>(
      sql`SELECT * FROM queue WHERE showId = ${showId} AND episodeNumber = ${episodeNumber}`
    )
    return rows[0]
  },

  getByShow: (db: DatabaseWrapper, showId: string) =>
    getDrizzle(db).all<QueueRow>(
      sql`SELECT * FROM queue WHERE showId = ${showId} ORDER BY queue_order ASC`
    ),

  getMaxOrder: async (db: DatabaseWrapper) => {
    const rows = await getDrizzle(db).all<{ maxOrder: number }>(
      sql`SELECT COALESCE(MAX(queue_order), -1) as maxOrder FROM queue`
    )
    return rows[0]?.maxOrder ?? -1
  },

  addToEnd: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    getDrizzle(db).run(sql`
      INSERT INTO queue (showId, episodeNumber, queue_order) VALUES
      (${showId}, ${episodeNumber}, (SELECT COALESCE(MAX(queue_order), -1) + 1 FROM queue))`),

  removeEpisode: (db: DatabaseWrapper, showId: string, episodeNumber: string) =>
    getDrizzle(db)
      .delete(queue)
      .where(and(eq(queue.showId, showId), eq(queue.episodeNumber, episodeNumber))),

  addManyToEnd: async (
    db: DatabaseWrapper,
    episodes: { showId: string; episodeNumber: string }[]
  ) => {
    if (episodes.length === 0) return
    let nextOrder = (await QueueRepository.getMaxOrder(db)) + 1
    for (const episode of episodes) {
      const existing = await QueueRepository.getByEpisode(db, episode.showId, episode.episodeNumber)
      if (existing) continue
      await getDrizzle(db).insert(queue).values({
        showId: episode.showId,
        episodeNumber: episode.episodeNumber,
        queueOrder: nextOrder,
      })
      nextOrder += 1
    }
  },

  removeMany: (db: DatabaseWrapper, showId: string, episodeNumbers: string[]) => {
    if (episodeNumbers.length === 0) return Promise.resolve()
    return getDrizzle(db).run(sql`
      DELETE FROM queue WHERE showId = ${showId} AND episodeNumber IN (${sql.join(
        episodeNumbers.map((e) => sql`${e}`),
        sql`, `
      )})`)
  },

  clear: (db: DatabaseWrapper) => getDrizzle(db).delete(queue),

  reorder: (
    db: DatabaseWrapper,
    items: { id?: number; showId?: string; episodeNumber?: string }[]
  ) =>
    Promise.all(
      items.map((item, index) => {
        if (item.id !== undefined) {
          return getDrizzle(db)
            .update(queue)
            .set({ queueOrder: index })
            .where(eq(queue.id, item.id))
        }
        return getDrizzle(db)
          .update(queue)
          .set({ queueOrder: index })
          .where(
            and(
              eq(queue.showId, item.showId ?? ''),
              eq(queue.episodeNumber, item.episodeNumber ?? '')
            )
          )
      })
    ),

  cleanupOrphanedShowsMeta: (db: DatabaseWrapper) =>
    getDrizzle(db).run(sql`
      DELETE FROM shows_meta WHERE id NOT IN (SELECT id FROM watchlist) AND id NOT IN (SELECT showId FROM queue)`),
}

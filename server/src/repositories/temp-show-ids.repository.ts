import { DatabaseWrapper } from '../db'
import { dbGet, dbRun } from '../utils/db-utils'
import { TEMP_SHOW_ID_PREFIX } from '../lib/temp-ids'

export interface TempShowRow {
  id: string
  provider: string
  nativeId: string
  title: string
  thumbnail: string
  createdAt: number
}

export const TempShowIdsRepository = {
  getById: (db: DatabaseWrapper, id: string) =>
    dbGet<TempShowRow>(db, 'SELECT * FROM temp_show_ids WHERE id = ?', [id]),

  getByProviderNative: (db: DatabaseWrapper, provider: string, nativeId: string) =>
    dbGet<TempShowRow>(db, 'SELECT * FROM temp_show_ids WHERE provider = ? AND nativeId = ?', [
      provider,
      nativeId,
    ]),

  count: (db: DatabaseWrapper) => {
    const row = dbGet<{ total: number }>(db, 'SELECT COUNT(*) as total FROM temp_show_ids')
    return row?.total || 0
  },

  allocate: (
    db: DatabaseWrapper,
    data: { provider: string; nativeId: string; title: string; thumbnail?: string }
  ): TempShowRow => {
    const existing = TempShowIdsRepository.getByProviderNative(db, data.provider, data.nativeId)
    if (existing) return existing

    const prefixLen = TEMP_SHOW_ID_PREFIX.length + 1
    const maxRow = dbGet<{ maxId: number | null }>(
      db,
      `SELECT MAX(CAST(SUBSTR(id, ?) AS INTEGER)) as maxId FROM temp_show_ids WHERE id LIKE '${TEMP_SHOW_ID_PREFIX}%'`,
      [prefixLen]
    )
    const next = (maxRow?.maxId || 0) + 1
    const id = `${TEMP_SHOW_ID_PREFIX}${next}`

    try {
      dbRun(
        db,
        'INSERT INTO temp_show_ids (id, provider, nativeId, title, thumbnail, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [id, data.provider, data.nativeId, data.title, data.thumbnail || '', Date.now()]
      )
    } catch {
      // Lost a race with a concurrent allocate — return whatever won.
      const winner = TempShowIdsRepository.getByProviderNative(db, data.provider, data.nativeId)
      if (winner) return winner
      throw new Error('temp id allocation failed')
    }

    return TempShowIdsRepository.getById(db, id) as TempShowRow
  },

  purge: (db: DatabaseWrapper): number => {
    const total = TempShowIdsRepository.count(db)
    if (total === 0) return 0
    const like = `${TEMP_SHOW_ID_PREFIX}%`
    dbRun(db, 'DELETE FROM watchlist WHERE id LIKE ?', [like])
    dbRun(db, 'DELETE FROM watched_episodes WHERE showId LIKE ?', [like])
    dbRun(db, 'DELETE FROM queue WHERE showId LIKE ?', [like])
    dbRun(db, 'DELETE FROM shows_meta WHERE id LIKE ?', [like])
    dbRun(db, 'DELETE FROM dismissed_notifications WHERE showId LIKE ?', [like])
    dbRun(db, 'DELETE FROM discovered_notifications WHERE showId LIKE ?', [like])
    dbRun(db, 'DELETE FROM legacy_id_mapping WHERE legacyId LIKE ? OR numericId LIKE ?', [
      like,
      like,
    ])
    dbRun(db, 'DELETE FROM temp_show_ids')
    return total
  },
}

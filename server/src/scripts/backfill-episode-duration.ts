import path from 'node:path'
import { CONFIG } from '../config.js'
import { DatabaseWrapper } from '../db.js'
import { anilistRequest } from '../lib/anilist.js'
import { dbAll, dbRun } from '../utils/db-utils.js'

const BATCH_SIZE = 50

async function main(): Promise<void> {
  const dbName = CONFIG.IS_DEV ? CONFIG.DB_NAME_DEV : CONFIG.DB_NAME_PROD
  const db = await DatabaseWrapper.create(path.join(CONFIG.ROOT, dbName))
  db.configure('busyTimeout', 10000)

  const cols = dbAll<{ name: string }>(db, 'PRAGMA table_info(shows_meta)')
  if (!cols.some((c) => c.name === 'episodeDuration')) {
    db.run('ALTER TABLE shows_meta ADD COLUMN episodeDuration INTEGER')
  }

  const missing = dbAll<{ id: string; anilistId: number }>(
    db,
    'SELECT id, anilistId FROM shows_meta WHERE anilistId IS NOT NULL AND episodeDuration IS NULL'
  )
  if (missing.length === 0) {
    console.log('Nothing to backfill.')
    db.close()
    return
  }

  let updated = 0
  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const batch = missing.slice(i, i + BATCH_SIZE)
    const res = await anilistRequest<{ Page: { media: { id: number; duration: number }[] } }>(
      `query ($ids: [Int]) { Page(perPage: ${BATCH_SIZE}) { media(id_in: $ids, type: ANIME) { id duration } } }`,
      { ids: batch.map((b) => b.anilistId) }
    )
    for (const m of res?.data?.Page?.media ?? []) {
      if (!m.duration || m.duration <= 0) continue
      const row = batch.find((b) => b.anilistId === m.id)
      if (!row) continue
      dbRun(db, 'UPDATE shows_meta SET episodeDuration = ? WHERE id = ?', [m.duration, row.id])
      updated++
    }
    console.log(
      `Progress: ${Math.min(i + BATCH_SIZE, missing.length)}/${missing.length} (updated ${updated})`
    )
  }

  console.log(`Done. Updated ${updated} of ${missing.length} shows.`)
  db.close()
}

main().catch((err) => {
  console.error(err?.message || err)
  process.exit(1)
})

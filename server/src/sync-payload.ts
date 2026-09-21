import path from 'path'
import logger from './logger.js'
import { CONFIG } from './config.js'
import type { DatabaseWrapper } from './db.js'
import { dbAll, dbGet } from './utils/db-utils.js'
import { isTempSyncRow } from './lib/temp-ids.js'

const log = logger.child({ module: 'SyncPayload' })

export type SyncRow = Record<string, string | number | null>
export type SyncPayload<TTable extends string = string> = {
  version: number
  exportedAt: string
  tables: Record<TTable, SyncRow[]>
}

export const ANIME_SYNC_TABLES = [
  'watchlist',
  'watched_episodes',
  'queue',
  'settings',
  'shows_meta',
  'sync_metadata',
  'dismissed_notifications',
  'discovered_notifications',
] as const

export const MANGA_SYNC_TABLES = ['manga_library', 'manga_progress', 'sync_metadata'] as const

export const TV_SYNC_TABLES = ['tv_library', 'tv_progress', 'sync_metadata'] as const

export function readPayloadVersion<TTable extends string>(payload: SyncPayload<TTable>): number {
  const meta = (payload.tables as Record<string, SyncRow[] | undefined>)['sync_metadata']
  const row = meta?.find((r) => r.key === 'db_version')
  const v = row?.value
  return typeof v === 'number' ? v : Number(v || payload.version || 0)
}

export function normalizePayload<TTable extends string>(
  input: unknown,
  tables: readonly TTable[],
  label: string
): SyncPayload<TTable> {
  if (!input || typeof input !== 'object' || !('tables' in input)) {
    throw new Error(`Invalid ${label} sync payload.`)
  }
  const payload = input as SyncPayload<TTable>
  for (const table of tables) {
    if (!Array.isArray((payload.tables as Record<string, unknown>)?.[table as string])) {
      throw new Error(`Invalid ${label} sync payload: missing ${String(table)}.`)
    }
  }
  return payload
}

export function exportTables<TTable extends string>(
  db: DatabaseWrapper,
  tables: readonly TTable[]
): SyncPayload<TTable> {
  const out = {} as Record<TTable, SyncRow[]>
  for (const table of tables) {
    const rows = dbAll<SyncRow>(db, `SELECT * FROM "${String(table).replace(/"/g, '""')}"`)
    out[table] = rows.filter((row) => !isTempSyncRow(row))
  }
  return {
    version: readPayloadVersion({ version: 0, exportedAt: '', tables: out }),
    exportedAt: new Date().toISOString(),
    tables: out,
  }
}

export function importTables<TTable extends string>(
  db: DatabaseWrapper,
  tables: readonly TTable[],
  payload: SyncPayload<TTable>,
  opts: { libraryTables: readonly TTable[]; backupName: string }
): void {
  const asRec = payload.tables as Record<string, SyncRow[] | undefined>
  const remoteLibraryRows = opts.libraryTables.reduce(
    (n, t) => n + (asRec[t as string]?.length ?? 0),
    0
  )
  const localLibraryRows =
    opts.libraryTables.length === 0
      ? 1
      : (dbGet<{ n: number }>(
          db,
          `SELECT ${opts.libraryTables
            .map((t) => `(SELECT COUNT(*) FROM "${String(t).replace(/"/g, '""')}")`)
            .join(' + ')} AS n`
        )?.n ?? 0)
  if (remoteLibraryRows === 0 && localLibraryRows > 0) {
    throw new Error('Sync down refused: remote library is empty while local library has data')
  }
  try {
    db.backup(path.join(CONFIG.ROOT, opts.backupName))
  } catch (err) {
    log.warn({ err }, 'Pre-sync backup failed, continuing without backup')
  }
  const localColumns = new Map<string, Set<string>>()
  for (const table of tables) {
    const cols = db.all<{ name: string }>(`PRAGMA table_info("${String(table)}")`)
    localColumns.set(String(table), new Set(cols.map((c) => c.name)))
  }
  db.serialize(() => {
    for (const table of tables) {
      db.run(`DELETE FROM "${String(table).replace(/"/g, '""')}"`)
    }
    for (const table of tables) {
      const known = localColumns.get(String(table))
      for (const row of asRec[String(table)] || []) {
        if (isTempSyncRow(row)) continue
        const columns = Object.keys(row).filter((c) => known?.has(c))
        if (columns.length === 0) continue
        const columnSql = columns.map((c) => `"${c.replace(/"/g, '""')}"`).join(', ')
        const placeholders = columns.map(() => '?').join(', ')
        const values = columns.map((c) => row[c])
        db.run(
          `INSERT INTO "${String(table).replace(/"/g, '""')}" (${columnSql}) VALUES (${placeholders})`,
          values
        )
      }
    }
  })
}

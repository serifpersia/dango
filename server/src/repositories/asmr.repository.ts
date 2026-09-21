import { DatabaseWrapper } from '../db.js'
import { dbAll, dbGet, dbRun } from '../utils/db-utils.js'

export type AsmrStatus = 'Listening' | 'Completed' | 'On-Hold' | 'Dropped' | 'Planned'

export const ASMR_STATUSES: AsmrStatus[] = [
  'Listening',
  'Completed',
  'On-Hold',
  'Dropped',
  'Planned',
]

export interface AsmrLibraryRow {
  id: string
  rjCode: string
  title: string
  thumbnail: string
  status: string
  isAdult?: number | null
  lastTrackIndex?: number | null
  lastTrackLabel?: string | null
  lastPosition?: number | null
  updatedAt?: number | null
  [key: string]: unknown
}

export interface AsmrProgressRow {
  workId: string
  trackIndex: number
  trackLabel: string
  currentTime: number
  duration: number
  updatedAt: number
  title?: string | null
  thumbnail?: string | null
  rjCode?: string | null
  isAdult?: number | null
}

export function buildAsmrId(rjCode: string): string {
  return String(rjCode).trim().toUpperCase()
}

export const AsmrLibraryRepository = {
  getById: (db: DatabaseWrapper, id: string) =>
    dbGet<AsmrLibraryRow>(db, 'SELECT * FROM asmr_library WHERE id = ?', [id]),

  exists: (db: DatabaseWrapper, id: string) => {
    const row = dbGet<{ inLibrary: number }>(
      db,
      'SELECT EXISTS(SELECT 1 FROM asmr_library WHERE id = ?) as inLibrary',
      [id]
    )
    return !!(row && row.inLibrary)
  },

  getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
    let query = 'SELECT * FROM asmr_library'
    const params: (string | number)[] = []

    if (status && status !== 'All') {
      query += ' WHERE status = ?'
      params.push(status)
    }

    query += ' ORDER BY updatedAt DESC'

    if (limit !== undefined && offset !== undefined) {
      query += ' LIMIT ? OFFSET ?'
      params.push(limit, offset)
    }

    return dbAll<AsmrLibraryRow>(db, query, params)
  },

  getCount: (db: DatabaseWrapper, status?: string) => {
    let query = 'SELECT COUNT(*) as total FROM asmr_library'
    const params: string[] = []

    if (status && status !== 'All') {
      query += ' WHERE status = ?'
      params.push(status)
    }

    const row = dbGet<{ total: number }>(db, query, params)
    return row?.total || 0
  },

  getIds: (db: DatabaseWrapper) =>
    dbAll<{ id: string }>(db, 'SELECT id FROM asmr_library').map((r) => r.id),

  upsert: (
    db: DatabaseWrapper,
    data: {
      id: string
      rjCode: string
      title: string
      thumbnail: string
      status: string
      isAdult?: boolean
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO asmr_library (id, rjCode, title, thumbnail, status, isAdult, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(id) DO UPDATE SET
          rjCode = COALESCE(NULLIF(EXCLUDED.rjCode, ''), asmr_library.rjCode),
          title = COALESCE(NULLIF(EXCLUDED.title, ''), asmr_library.title),
          thumbnail = COALESCE(NULLIF(EXCLUDED.thumbnail, ''), asmr_library.thumbnail),
          status = COALESCE(NULLIF(EXCLUDED.status, ''), asmr_library.status),
          isAdult = COALESCE(EXCLUDED.isAdult, asmr_library.isAdult),
          updatedAt = strftime('%s', 'now')`,
      [data.id, data.rjCode, data.title, data.thumbnail, data.status, data.isAdult ? 1 : 0]
    ),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    dbRun(
      db,
      "UPDATE asmr_library SET status = ?, updatedAt = strftime('%s', 'now') WHERE id = ?",
      [status, id]
    ),

  updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    dbRun(
      db,
      `UPDATE asmr_library SET status = ?, updatedAt = strftime('%s', 'now') WHERE id IN (${placeholders})`,
      [status, ...ids]
    )
  },

  touchProgress: (
    db: DatabaseWrapper,
    id: string,
    progress: { trackIndex: number; trackLabel: string; position: number }
  ) =>
    dbRun(
      db,
      `UPDATE asmr_library SET lastTrackIndex = ?, lastTrackLabel = ?, lastPosition = ?, updatedAt = strftime('%s', 'now') WHERE id = ?`,
      [progress.trackIndex, progress.trackLabel, progress.position, id]
    ),

  delete: (db: DatabaseWrapper, id: string) =>
    dbRun(db, 'DELETE FROM asmr_library WHERE id = ?', [id]),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    dbRun(db, `DELETE FROM asmr_library WHERE id IN (${placeholders})`, ids)
  },
}

export const AsmrProgressRepository = {
  getByWork: (db: DatabaseWrapper, workId: string) =>
    dbAll<AsmrProgressRow>(
      db,
      'SELECT workId, trackIndex, trackLabel, currentTime, duration, updatedAt FROM asmr_progress WHERE workId = ? ORDER BY updatedAt DESC',
      [workId]
    ),

  getTrack: (db: DatabaseWrapper, workId: string, trackIndex: number) =>
    dbGet<AsmrProgressRow>(
      db,
      'SELECT workId, trackIndex, trackLabel, currentTime, duration, updatedAt FROM asmr_progress WHERE workId = ? AND trackIndex = ?',
      [workId, trackIndex]
    ),

  getLatest: (db: DatabaseWrapper, workId: string) =>
    dbGet<AsmrProgressRow>(
      db,
      'SELECT workId, trackIndex, trackLabel, currentTime, duration, updatedAt FROM asmr_progress WHERE workId = ? ORDER BY updatedAt DESC LIMIT 1',
      [workId]
    ),

  upsert: (
    db: DatabaseWrapper,
    data: {
      workId: string
      trackIndex: number
      trackLabel: string
      currentTime: number
      duration: number
      title?: string | null
      thumbnail?: string | null
      rjCode?: string | null
      isAdult?: number | null
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO asmr_progress (workId, trackIndex, trackLabel, currentTime, duration, title, thumbnail, rjCode, isAdult, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(workId, trackIndex) DO UPDATE SET
          trackLabel = COALESCE(NULLIF(EXCLUDED.trackLabel, ''), asmr_progress.trackLabel),
          currentTime = EXCLUDED.currentTime,
          duration = EXCLUDED.duration,
          title = COALESCE(EXCLUDED.title, asmr_progress.title),
          thumbnail = COALESCE(EXCLUDED.thumbnail, asmr_progress.thumbnail),
          rjCode = COALESCE(EXCLUDED.rjCode, asmr_progress.rjCode),
          isAdult = COALESCE(EXCLUDED.isAdult, asmr_progress.isAdult),
          updatedAt = strftime('%s', 'now')`,
      [
        data.workId,
        data.trackIndex,
        data.trackLabel,
        data.currentTime,
        data.duration,
        data.title ?? null,
        data.thumbnail ?? null,
        data.rjCode ?? null,
        data.isAdult ?? null,
      ]
    ),

  deleteByWork: (db: DatabaseWrapper, workId: string) =>
    dbRun(db, 'DELETE FROM asmr_progress WHERE workId = ?', [workId]),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    dbRun(db, `DELETE FROM asmr_progress WHERE workId IN (${placeholders})`, ids)
  },

  deleteTrack: (db: DatabaseWrapper, workId: string, trackIndex: number) =>
    dbRun(db, 'DELETE FROM asmr_progress WHERE workId = ? AND trackIndex = ?', [
      workId,
      trackIndex,
    ]),

  getContinueListening: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    return dbAll<AsmrLibraryRow & Partial<AsmrProgressRow>>(
      db,
      `SELECT p.workId as id,
              COALESCE(l.rjCode, p.rjCode, p.workId) as rjCode,
              COALESCE(l.title, p.title) as title,
              COALESCE(l.thumbnail, p.thumbnail) as thumbnail,
              COALESCE(l.isAdult, p.isAdult) as isAdult,
              l.status as watchlistStatus,
              p.trackIndex, p.trackLabel, p.currentTime, p.duration, p.updatedAt as progressAt
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY workId ORDER BY updatedAt DESC) as rn
         FROM asmr_progress
       ) p
       LEFT JOIN asmr_library l ON p.workId = l.id
       WHERE p.rn = 1
         AND (l.status IS NULL OR l.status = 'Listening')
       ORDER BY p.updatedAt DESC
       ${limitClause}`
    )
  },
}

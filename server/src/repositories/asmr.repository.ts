import { eq, inArray, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { asmrLibrary, asmrProgress } from '../db/schema-asmr.js'

export const ASMR_STATUSES: string[] = ['Listening', 'Completed', 'On-Hold', 'Dropped', 'Planned']

export type AsmrStatus = (typeof ASMR_STATUSES)[number]

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
  getById: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<AsmrLibraryRow>(
      sql`SELECT * FROM asmr_library WHERE id = ${id}`
    )
    return rows[0]
  },

  getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
    const q = sql`SELECT * FROM asmr_library`
    if (status && status !== 'All') {
      q.append(sql` WHERE status = ${status}`)
    }
    q.append(sql` ORDER BY updatedAt DESC`)
    if (limit !== undefined && offset !== undefined) {
      q.append(sql` LIMIT ${limit} OFFSET ${offset}`)
    }
    return getDrizzle(db).all<AsmrLibraryRow>(q)
  },

  getCount: async (db: DatabaseWrapper, status?: string) => {
    if (status && status !== 'All') {
      const rows = await getDrizzle(db).all<{ total: number }>(
        sql`SELECT COUNT(*) as total FROM asmr_library WHERE status = ${status}`
      )
      return rows[0]?.total || 0
    }
    const rows = await getDrizzle(db).all<{ total: number }>(
      sql`SELECT COUNT(*) as total FROM asmr_library`
    )
    return rows[0]?.total || 0
  },

  getIds: async (db: DatabaseWrapper) => {
    const rows = await getDrizzle(db).all<{ id: string }>(sql`SELECT id FROM asmr_library`)
    return rows.map((r) => r.id)
  },

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
    getDrizzle(db).run(sql`
      INSERT INTO asmr_library (id, rjCode, title, thumbnail, status, isAdult, updatedAt)
      VALUES (${data.id}, ${data.rjCode}, ${data.title}, ${data.thumbnail}, ${data.status}, ${data.isAdult ? 1 : 0}, strftime('%s', 'now'))
      ON CONFLICT(id) DO UPDATE SET
         rjCode = COALESCE(NULLIF(EXCLUDED.rjCode, ''), asmr_library.rjCode),
         title = COALESCE(NULLIF(EXCLUDED.title, ''), asmr_library.title),
         thumbnail = COALESCE(NULLIF(EXCLUDED.thumbnail, ''), asmr_library.thumbnail),
         status = COALESCE(NULLIF(EXCLUDED.status, ''), asmr_library.status),
         isAdult = COALESCE(EXCLUDED.isAdult, asmr_library.isAdult),
         updatedAt = strftime('%s', 'now')`),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    getDrizzle(db).run(sql`
      UPDATE asmr_library SET status = ${status}, updatedAt = strftime('%s', 'now') WHERE id = ${id}`),

  updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).run(sql`
      UPDATE asmr_library SET status = ${status}, updatedAt = strftime('%s', 'now') WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  },

  touchProgress: (
    db: DatabaseWrapper,
    id: string,
    progress: { trackIndex: number; trackLabel: string; position: number }
  ) =>
    getDrizzle(db).run(sql`
      UPDATE asmr_library SET lastTrackIndex = ${progress.trackIndex}, lastTrackLabel = ${progress.trackLabel}, lastPosition = ${progress.position}, updatedAt = strftime('%s', 'now') WHERE id = ${id}`),

  delete: (db: DatabaseWrapper, id: string) =>
    getDrizzle(db).delete(asmrLibrary).where(eq(asmrLibrary.id, id)),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).delete(asmrLibrary).where(inArray(asmrLibrary.id, ids))
  },
}

export const AsmrProgressRepository = {
  getByWork: (db: DatabaseWrapper, workId: string) =>
    getDrizzle(db).all<AsmrProgressRow>(sql`
      SELECT workId, trackIndex, trackLabel, currentTime, duration, updatedAt FROM asmr_progress WHERE workId = ${workId} ORDER BY updatedAt DESC`),

  getTrack: async (db: DatabaseWrapper, workId: string, trackIndex: number) => {
    const rows = await getDrizzle(db).all<AsmrProgressRow>(sql`
      SELECT workId, trackIndex, trackLabel, currentTime, duration, updatedAt FROM asmr_progress WHERE workId = ${workId} AND trackIndex = ${trackIndex}`)
    return rows[0]
  },

  getLatest: async (db: DatabaseWrapper, workId: string) => {
    const rows = await getDrizzle(db).all<AsmrProgressRow>(sql`
      SELECT workId, trackIndex, trackLabel, currentTime, duration, updatedAt FROM asmr_progress WHERE workId = ${workId} ORDER BY updatedAt DESC LIMIT 1`)
    return rows[0]
  },

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
    getDrizzle(db).run(sql`
      INSERT INTO asmr_progress (workId, trackIndex, trackLabel, currentTime, duration, title, thumbnail, rjCode, isAdult, updatedAt)
      VALUES (${data.workId}, ${data.trackIndex}, ${data.trackLabel}, ${data.currentTime}, ${data.duration}, ${data.title ?? null}, ${data.thumbnail ?? null}, ${data.rjCode ?? null}, ${data.isAdult ?? null}, strftime('%s', 'now'))
      ON CONFLICT(workId, trackIndex) DO UPDATE SET
         trackLabel = COALESCE(NULLIF(EXCLUDED.trackLabel, ''), asmr_progress.trackLabel),
         currentTime = EXCLUDED.currentTime,
         duration = EXCLUDED.duration,
         title = COALESCE(EXCLUDED.title, asmr_progress.title),
         thumbnail = COALESCE(EXCLUDED.thumbnail, asmr_progress.thumbnail),
         rjCode = COALESCE(EXCLUDED.rjCode, asmr_progress.rjCode),
         isAdult = COALESCE(EXCLUDED.isAdult, asmr_progress.isAdult),
         updatedAt = strftime('%s', 'now')`),

  deleteByWork: (db: DatabaseWrapper, workId: string) =>
    getDrizzle(db).delete(asmrProgress).where(eq(asmrProgress.workId, workId)),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).delete(asmrProgress).where(inArray(asmrProgress.workId, ids))
  },

  deleteTrack: (db: DatabaseWrapper, workId: string, trackIndex: number) =>
    getDrizzle(db).run(sql`
      DELETE FROM asmr_progress WHERE workId = ${workId} AND trackIndex = ${trackIndex}`),

  getContinueListening: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    return getDrizzle(db).all<AsmrLibraryRow & Partial<AsmrProgressRow>>(sql`
      SELECT p.workId as id,
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
      ${sql.raw(limitClause)}`)
  },
}

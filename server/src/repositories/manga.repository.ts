import { DatabaseWrapper } from '../db.js'
import { dbAll, dbGet, dbRun } from '../utils/db-utils.js'

export type MangaStatus = 'Reading' | 'Completed' | 'On-Hold' | 'Dropped' | 'Planned'

export const MANGA_STATUSES: MangaStatus[] = [
  'Reading',
  'Completed',
  'On-Hold',
  'Dropped',
  'Planned',
]

export interface MangaLibraryRow {
  id: string
  provider: string
  mangaId: string
  title: string
  cover: string
  status: string
  author?: string | null
  altTitle?: string | null
  contentRating?: string | null
  lastChapterId?: string | null
  lastChapterNumber?: string | null
  lastPage?: number | null
  updatedAt?: number | null
  [key: string]: unknown
}

export interface MangaProgressRow {
  mangaId: string
  chapterId: string
  chapterNumber: string
  page: number
  pageCount: number
  updatedAt: number
  title?: string | null
  cover?: string | null
  provider?: string | null
  altTitle?: string | null
  contentRating?: string | null
}

export function buildMangaId(provider: string, mangaId: string): string {
  return `${provider.toLowerCase()}:${mangaId}`
}

export const MangaLibraryRepository = {
  getById: (db: DatabaseWrapper, id: string) =>
    dbGet<MangaLibraryRow>(db, 'SELECT * FROM manga_library WHERE id = ?', [id]),

  exists: (db: DatabaseWrapper, id: string) => {
    const row = dbGet<{ inLibrary: number }>(
      db,
      'SELECT EXISTS(SELECT 1 FROM manga_library WHERE id = ?) as inLibrary',
      [id]
    )
    return !!(row && row.inLibrary)
  },

  getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
    let query = 'SELECT * FROM manga_library'
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

    return dbAll<MangaLibraryRow>(db, query, params)
  },

  getCount: (db: DatabaseWrapper, status?: string) => {
    let query = 'SELECT COUNT(*) as total FROM manga_library'
    const params: string[] = []

    if (status && status !== 'All') {
      query += ' WHERE status = ?'
      params.push(status)
    }

    const row = dbGet<{ total: number }>(db, query, params)
    return row?.total || 0
  },

  getIds: (db: DatabaseWrapper) =>
    dbAll<{ id: string }>(db, 'SELECT id FROM manga_library').map((r) => r.id),

  upsert: (
    db: DatabaseWrapper,
    data: {
      id: string
      provider: string
      mangaId: string
      title: string
      cover: string
      status: string
      author?: string
      altTitle?: string
      contentRating?: string
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO manga_library (id, provider, mangaId, title, cover, status, author, altTitle, contentRating, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(id) DO UPDATE SET
          provider = COALESCE(NULLIF(EXCLUDED.provider, ''), manga_library.provider),
          title = COALESCE(NULLIF(EXCLUDED.title, ''), manga_library.title),
          cover = COALESCE(NULLIF(EXCLUDED.cover, ''), manga_library.cover),
          status = COALESCE(NULLIF(EXCLUDED.status, ''), manga_library.status),
          author = COALESCE(NULLIF(EXCLUDED.author, ''), manga_library.author),
          altTitle = COALESCE(NULLIF(EXCLUDED.altTitle, ''), manga_library.altTitle),
          contentRating = COALESCE(EXCLUDED.contentRating, manga_library.contentRating),
          updatedAt = strftime('%s', 'now')`,
      [
        data.id,
        data.provider,
        data.mangaId,
        data.title,
        data.cover,
        data.status,
        data.author || null,
        data.altTitle || null,
        data.contentRating || null,
      ]
    ),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    dbRun(
      db,
      "UPDATE manga_library SET status = ?, updatedAt = strftime('%s', 'now') WHERE id = ?",
      [status, id]
    ),

  updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    dbRun(
      db,
      `UPDATE manga_library SET status = ?, updatedAt = strftime('%s', 'now') WHERE id IN (${placeholders})`,
      [status, ...ids]
    )
  },

  touchProgress: (
    db: DatabaseWrapper,
    id: string,
    progress: { chapterId: string; chapterNumber: string; page: number }
  ) =>
    dbRun(
      db,
      `UPDATE manga_library SET lastChapterId = ?, lastChapterNumber = ?, lastPage = ?, updatedAt = strftime('%s', 'now') WHERE id = ?`,
      [progress.chapterId, progress.chapterNumber, progress.page, id]
    ),

  delete: (db: DatabaseWrapper, id: string) =>
    dbRun(db, 'DELETE FROM manga_library WHERE id = ?', [id]),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    dbRun(db, `DELETE FROM manga_library WHERE id IN (${placeholders})`, ids)
  },
}

export const MangaProgressRepository = {
  getByManga: (db: DatabaseWrapper, mangaId: string) =>
    dbAll<MangaProgressRow>(
      db,
      'SELECT mangaId, chapterId, chapterNumber, page, pageCount, updatedAt FROM manga_progress WHERE mangaId = ? ORDER BY updatedAt DESC',
      [mangaId]
    ),

  getChapter: (db: DatabaseWrapper, mangaId: string, chapterId: string) =>
    dbGet<MangaProgressRow>(
      db,
      'SELECT mangaId, chapterId, chapterNumber, page, pageCount, updatedAt FROM manga_progress WHERE mangaId = ? AND chapterId = ?',
      [mangaId, chapterId]
    ),

  getLatest: (db: DatabaseWrapper, mangaId: string) =>
    dbGet<MangaProgressRow>(
      db,
      'SELECT mangaId, chapterId, chapterNumber, page, pageCount, updatedAt FROM manga_progress WHERE mangaId = ? ORDER BY updatedAt DESC LIMIT 1',
      [mangaId]
    ),

  upsert: (
    db: DatabaseWrapper,
    data: {
      mangaId: string
      chapterId: string
      chapterNumber: string
      page: number
      pageCount: number
      title?: string | null
      cover?: string | null
      provider?: string | null
      altTitle?: string | null
      contentRating?: string | null
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO manga_progress (mangaId, chapterId, chapterNumber, page, pageCount, title, cover, provider, altTitle, contentRating, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(mangaId, chapterId) DO UPDATE SET
          chapterNumber = COALESCE(NULLIF(EXCLUDED.chapterNumber, ''), manga_progress.chapterNumber),
          page = EXCLUDED.page,
          pageCount = EXCLUDED.pageCount,
          title = COALESCE(EXCLUDED.title, manga_progress.title),
          cover = COALESCE(EXCLUDED.cover, manga_progress.cover),
          provider = COALESCE(EXCLUDED.provider, manga_progress.provider),
          altTitle = COALESCE(EXCLUDED.altTitle, manga_progress.altTitle),
          contentRating = COALESCE(EXCLUDED.contentRating, manga_progress.contentRating),
          updatedAt = strftime('%s', 'now')`,
      [
        data.mangaId,
        data.chapterId,
        data.chapterNumber,
        data.page,
        data.pageCount,
        data.title ?? null,
        data.cover ?? null,
        data.provider ?? null,
        data.altTitle ?? null,
        data.contentRating ?? null,
      ]
    ),

  deleteByManga: (db: DatabaseWrapper, mangaId: string) =>
    dbRun(db, 'DELETE FROM manga_progress WHERE mangaId = ?', [mangaId]),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return
    const placeholders = ids.map(() => '?').join(', ')
    dbRun(db, `DELETE FROM manga_progress WHERE mangaId IN (${placeholders})`, ids)
  },

  deleteChapter: (db: DatabaseWrapper, mangaId: string, chapterId: string) =>
    dbRun(db, 'DELETE FROM manga_progress WHERE mangaId = ? AND chapterId = ?', [
      mangaId,
      chapterId,
    ]),

  getContinueReading: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    return dbAll<MangaLibraryRow & Partial<MangaProgressRow>>(
      db,
      `SELECT p.mangaId as id,
              COALESCE(l.mangaId, SUBSTR(p.mangaId, INSTR(p.mangaId, ':') + 1)) as mangaId,
              COALESCE(l.provider, p.provider) as provider,
              COALESCE(l.title, p.title) as title, COALESCE(l.cover, p.cover) as cover,
              COALESCE(l.author, '') as author, COALESCE(l.altTitle, p.altTitle) as altTitle,
              COALESCE(l.contentRating, p.contentRating) as contentRating,
              l.status as watchlistStatus,
              p.chapterId, p.chapterNumber, p.page, p.pageCount, p.updatedAt as progressAt
       FROM (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY mangaId ORDER BY updatedAt DESC) as rn
         FROM manga_progress
       ) p
       LEFT JOIN manga_library l ON p.mangaId = l.id
       WHERE p.rn = 1
         AND (l.status IS NULL OR l.status = 'Reading')
       ORDER BY p.updatedAt DESC
       ${limitClause}`
    )
  },
}

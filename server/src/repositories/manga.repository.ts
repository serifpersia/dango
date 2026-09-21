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
    }
  ) =>
    dbRun(
      db,
      `INSERT INTO manga_progress (mangaId, chapterId, chapterNumber, page, pageCount, updatedAt)
       VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
       ON CONFLICT(mangaId, chapterId) DO UPDATE SET
          chapterNumber = COALESCE(NULLIF(EXCLUDED.chapterNumber, ''), manga_progress.chapterNumber),
          page = EXCLUDED.page,
          pageCount = EXCLUDED.pageCount,
          updatedAt = strftime('%s', 'now')`,
      [data.mangaId, data.chapterId, data.chapterNumber, data.page, data.pageCount]
    ),

  deleteByManga: (db: DatabaseWrapper, mangaId: string) =>
    dbRun(db, 'DELETE FROM manga_progress WHERE mangaId = ?', [mangaId]),

  deleteChapter: (db: DatabaseWrapper, mangaId: string, chapterId: string) =>
    dbRun(db, 'DELETE FROM manga_progress WHERE mangaId = ? AND chapterId = ?', [
      mangaId,
      chapterId,
    ]),

  getContinueReading: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    return dbAll<MangaLibraryRow & Partial<MangaProgressRow>>(
      db,
      `SELECT l.*, p.chapterId, p.chapterNumber, p.page, p.pageCount, p.updatedAt as progressAt
       FROM manga_library l
       LEFT JOIN (
         SELECT *, ROW_NUMBER() OVER (PARTITION BY mangaId ORDER BY updatedAt DESC) as rn
         FROM manga_progress
       ) p ON p.mangaId = l.id AND p.rn = 1
       WHERE l.status = 'Reading'
       ORDER BY COALESCE(p.updatedAt, l.updatedAt) DESC
       ${limitClause}`
    )
  },
}

import { eq, inArray, sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'
import { mangaLibrary, mangaProgress } from '../db/schema-manga.js'

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
  anilistId?: number | null
  anilistIdSource?: string | null
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
  getById: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<MangaLibraryRow>(
      sql`SELECT * FROM manga_library WHERE id = ${id}`
    )
    return rows[0]
  },

  exists: async (db: DatabaseWrapper, id: string) => {
    const rows = await getDrizzle(db).all<{ inLibrary: number }>(
      sql`SELECT EXISTS(SELECT 1 FROM manga_library WHERE id = ${id}) as inLibrary`
    )
    return !!(rows[0] && rows[0].inLibrary)
  },

  getAll: (db: DatabaseWrapper, status?: string, limit?: number, offset?: number) => {
    const q = sql`SELECT * FROM manga_library`
    if (status && status !== 'All') {
      q.append(sql` WHERE status = ${status}`)
    }
    q.append(sql` ORDER BY updatedAt DESC`)
    if (limit !== undefined && offset !== undefined) {
      q.append(sql` LIMIT ${limit} OFFSET ${offset}`)
    }
    return getDrizzle(db).all<MangaLibraryRow>(q)
  },

  getCount: async (db: DatabaseWrapper, status?: string) => {
    if (status && status !== 'All') {
      const rows = await getDrizzle(db).all<{ total: number }>(
        sql`SELECT COUNT(*) as total FROM manga_library WHERE status = ${status}`
      )
      return rows[0]?.total || 0
    }
    const rows = await getDrizzle(db).all<{ total: number }>(
      sql`SELECT COUNT(*) as total FROM manga_library`
    )
    return rows[0]?.total || 0
  },

  getIds: async (db: DatabaseWrapper) => {
    const rows = await getDrizzle(db).all<{ id: string }>(sql`SELECT id FROM manga_library`)
    return rows.map((r) => r.id)
  },

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
      anilistId?: number | null
      anilistIdSource?: string | null
    }
  ) =>
    getDrizzle(db).run(sql`
      INSERT INTO manga_library (id, provider, mangaId, title, cover, status, author, altTitle, contentRating, anilistId, anilistIdSource, updatedAt)
      VALUES (${data.id}, ${data.provider}, ${data.mangaId}, ${data.title}, ${data.cover}, ${data.status}, ${data.author || null}, ${data.altTitle || null}, ${data.contentRating || null}, ${data.anilistId ?? null}, ${data.anilistIdSource ?? null}, strftime('%s', 'now'))
      ON CONFLICT(id) DO UPDATE SET
         provider = COALESCE(NULLIF(EXCLUDED.provider, ''), manga_library.provider),
         title = COALESCE(NULLIF(EXCLUDED.title, ''), manga_library.title),
         cover = COALESCE(NULLIF(EXCLUDED.cover, ''), manga_library.cover),
         status = COALESCE(NULLIF(EXCLUDED.status, ''), manga_library.status),
         author = COALESCE(NULLIF(EXCLUDED.author, ''), manga_library.author),
         altTitle = COALESCE(NULLIF(EXCLUDED.altTitle, ''), manga_library.altTitle),
         contentRating = COALESCE(EXCLUDED.contentRating, manga_library.contentRating),
         anilistId = COALESCE(EXCLUDED.anilistId, manga_library.anilistId),
         anilistIdSource = COALESCE(EXCLUDED.anilistIdSource, manga_library.anilistIdSource),
         updatedAt = strftime('%s', 'now')`),

  setAnilistId: (db: DatabaseWrapper, id: string, anilistId: number, source?: string) =>
    source
      ? getDrizzle(db)
          .update(mangaLibrary)
          .set({ anilistId, anilistIdSource: source })
          .where(eq(mangaLibrary.id, id))
      : getDrizzle(db).update(mangaLibrary).set({ anilistId }).where(eq(mangaLibrary.id, id)),

  getByAnilistId: (db: DatabaseWrapper, anilistId: number) =>
    getDrizzle(db).all<MangaLibraryRow>(
      sql`SELECT * FROM manga_library WHERE anilistId = ${anilistId}`
    ),

  updateStatus: (db: DatabaseWrapper, id: string, status: string) =>
    getDrizzle(db).run(sql`
      UPDATE manga_library SET status = ${status}, updatedAt = strftime('%s', 'now') WHERE id = ${id}`),

  updateStatusMany: (db: DatabaseWrapper, ids: string[], status: string) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).run(sql`
      UPDATE manga_library SET status = ${status}, updatedAt = strftime('%s', 'now') WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`)
  },

  touchProgress: (
    db: DatabaseWrapper,
    id: string,
    progress: { chapterId: string; chapterNumber: string; page: number }
  ) =>
    getDrizzle(db).run(sql`
      UPDATE manga_library SET lastChapterId = ${progress.chapterId}, lastChapterNumber = ${progress.chapterNumber}, lastPage = ${progress.page}, updatedAt = strftime('%s', 'now') WHERE id = ${id}`),

  setProgressPointer: (db: DatabaseWrapper, id: string, chapterNumber: string) =>
    getDrizzle(db).run(sql`
      UPDATE manga_library SET lastChapterNumber = ${chapterNumber}, updatedAt = strftime('%s', 'now') WHERE id = ${id}`),

  delete: (db: DatabaseWrapper, id: string) =>
    getDrizzle(db).delete(mangaLibrary).where(eq(mangaLibrary.id, id)),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).delete(mangaLibrary).where(inArray(mangaLibrary.id, ids))
  },
}

export const MangaProgressRepository = {
  getByManga: (db: DatabaseWrapper, mangaId: string) =>
    getDrizzle(db).all<MangaProgressRow>(sql`
      SELECT mangaId, chapterId, chapterNumber, page, pageCount, updatedAt FROM manga_progress WHERE mangaId = ${mangaId} ORDER BY updatedAt DESC`),

  getChapter: async (db: DatabaseWrapper, mangaId: string, chapterId: string) => {
    const rows = await getDrizzle(db).all<MangaProgressRow>(sql`
      SELECT mangaId, chapterId, chapterNumber, page, pageCount, updatedAt FROM manga_progress WHERE mangaId = ${mangaId} AND chapterId = ${chapterId}`)
    return rows[0]
  },

  getLatest: async (db: DatabaseWrapper, mangaId: string) => {
    const rows = await getDrizzle(db).all<MangaProgressRow>(sql`
      SELECT mangaId, chapterId, chapterNumber, page, pageCount, updatedAt FROM manga_progress WHERE mangaId = ${mangaId} ORDER BY updatedAt DESC LIMIT 1`)
    return rows[0]
  },

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
    getDrizzle(db).run(sql`
      INSERT INTO manga_progress (mangaId, chapterId, chapterNumber, page, pageCount, title, cover, provider, altTitle, contentRating, updatedAt)
      VALUES (${data.mangaId}, ${data.chapterId}, ${data.chapterNumber}, ${data.page}, ${data.pageCount}, ${data.title ?? null}, ${data.cover ?? null}, ${data.provider ?? null}, ${data.altTitle ?? null}, ${data.contentRating ?? null}, strftime('%s', 'now'))
      ON CONFLICT(mangaId, chapterId) DO UPDATE SET
         chapterNumber = COALESCE(NULLIF(EXCLUDED.chapterNumber, ''), manga_progress.chapterNumber),
         page = EXCLUDED.page,
         pageCount = EXCLUDED.pageCount,
         title = COALESCE(EXCLUDED.title, manga_progress.title),
         cover = COALESCE(EXCLUDED.cover, manga_progress.cover),
         provider = COALESCE(EXCLUDED.provider, manga_progress.provider),
         altTitle = COALESCE(EXCLUDED.altTitle, manga_progress.altTitle),
         contentRating = COALESCE(EXCLUDED.contentRating, manga_progress.contentRating),
         updatedAt = strftime('%s', 'now')`),

  deleteByManga: (db: DatabaseWrapper, mangaId: string) =>
    getDrizzle(db).delete(mangaProgress).where(eq(mangaProgress.mangaId, mangaId)),

  deleteMany: (db: DatabaseWrapper, ids: string[]) => {
    if (ids.length === 0) return Promise.resolve()
    return getDrizzle(db).delete(mangaProgress).where(inArray(mangaProgress.mangaId, ids))
  },

  deleteChapter: (db: DatabaseWrapper, mangaId: string, chapterId: string) =>
    getDrizzle(db).run(sql`
      DELETE FROM manga_progress WHERE mangaId = ${mangaId} AND chapterId = ${chapterId}`),

  deleteSyntheticChapters: (db: DatabaseWrapper, mangaId: string, keepChapterId: string) =>
    getDrizzle(db).run(sql`
      DELETE FROM manga_progress WHERE mangaId = ${mangaId} AND chapterId LIKE 'anilist:ch:%' AND chapterId != ${keepChapterId}`),

  moveSyntheticChapters: (db: DatabaseWrapper, fromMangaId: string, toMangaId: string) =>
    getDrizzle(db).run(sql`
      UPDATE manga_progress SET mangaId = ${toMangaId}, updatedAt = strftime('%s', 'now') WHERE mangaId = ${fromMangaId} AND chapterId LIKE 'anilist:ch:%'`),

  getContinueReading: (db: DatabaseWrapper, limit?: number) => {
    const limitClause = typeof limit === 'number' ? `LIMIT ${limit}` : ''
    return getDrizzle(db).all<MangaLibraryRow & Partial<MangaProgressRow>>(sql`
      SELECT p.mangaId as id,
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
      ${sql.raw(limitClause)}`)
  },
}

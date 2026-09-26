import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const mangaLibrary = sqliteTable(
  'manga_library',
  {
    id: text('id').notNull(),
    provider: text('provider').notNull(),
    mangaId: text('mangaId').notNull(),
    title: text('title'),
    cover: text('cover'),
    status: text('status'),
    author: text('author'),
    altTitle: text('altTitle'),
    contentRating: text('contentRating'),
    lastChapterId: text('lastChapterId'),
    lastChapterNumber: text('lastChapterNumber'),
    lastPage: integer('lastPage'),
    updatedAt: integer('updatedAt'),
    anilistId: integer('anilistId'),
    anilistIdSource: text('anilistIdSource'),
  },
  (t) => [primaryKey({ columns: [t.id] })]
)

export const mangaProgress = sqliteTable(
  'manga_progress',
  {
    mangaId: text('mangaId').notNull(),
    chapterId: text('chapterId').notNull(),
    chapterNumber: text('chapterNumber'),
    page: integer('page'),
    pageCount: integer('pageCount'),
    updatedAt: integer('updatedAt'),
    title: text('title'),
    cover: text('cover'),
    provider: text('provider'),
    altTitle: text('altTitle'),
    contentRating: text('contentRating'),
  },
  (t) => [primaryKey({ columns: [t.mangaId, t.chapterId] })]
)

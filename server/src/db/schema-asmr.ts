import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const asmrProgress = sqliteTable(
  'asmr_progress',
  {
    workId: text('workId').notNull(),
    trackIndex: integer('trackIndex').notNull(),
    trackLabel: text('trackLabel'),
    currentTime: real('currentTime'),
    duration: real('duration'),
    updatedAt: integer('updatedAt'),
    title: text('title'),
    thumbnail: text('thumbnail'),
    rjCode: text('rjCode'),
    isAdult: integer('isAdult'),
  },
  (t) => [primaryKey({ columns: [t.workId, t.trackIndex] })]
)

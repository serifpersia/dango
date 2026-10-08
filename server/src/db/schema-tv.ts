import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const tvProgress = sqliteTable(
  'tv_progress',
  {
    mediaId: text('mediaId').notNull(),
    season: integer('season').notNull(),
    episode: integer('episode').notNull(),
    currentTime: real('currentTime'),
    duration: real('duration'),
    updatedAt: integer('updatedAt'),
    title: text('title'),
    poster: text('poster'),
    backdrop: text('backdrop'),
    year: text('year'),
    overview: text('overview'),
    tmdbId: integer('tmdbId'),
    mediaType: text('mediaType'),
    adult: integer('adult'),
    completed: integer('completed'),
  },
  (t) => [primaryKey({ columns: [t.mediaId, t.season, t.episode] })]
)

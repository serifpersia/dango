import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const tvLibrary = sqliteTable(
  'tv_library',
  {
    id: text('id').notNull(),
    tmdbId: integer('tmdbId').notNull(),
    mediaType: text('mediaType').notNull(),
    title: text('title'),
    poster: text('poster'),
    backdrop: text('backdrop'),
    year: text('year'),
    overview: text('overview'),
    status: text('status'),
    adult: integer('adult'),
    lastSeason: integer('lastSeason'),
    lastEpisode: integer('lastEpisode'),
    updatedAt: integer('updatedAt'),
  },
  (t) => [primaryKey({ columns: [t.id] })]
)

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

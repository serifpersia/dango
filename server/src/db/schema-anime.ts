import { sql } from 'drizzle-orm'
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const watchedEpisodes = sqliteTable(
  'watched_episodes',
  {
    showId: text('showId').notNull(),
    episodeNumber: text('episodeNumber').notNull(),
    watchedAt: text('watchedAt'),
    currentTime: real('currentTime'),
    duration: real('duration'),
  },
  (t) => [primaryKey({ columns: [t.showId, t.episodeNumber] })]
)

export const watchlist = sqliteTable(
  'watchlist',
  {
    id: text('id').notNull(),
    name: text('name'),
    thumbnail: text('thumbnail'),
    status: text('status'),
    nativeName: text('nativeName'),
    englishName: text('englishName'),
    type: text('type'),
  },
  (t) => [primaryKey({ columns: [t.id] })]
)

export const showsMeta = sqliteTable(
  'shows_meta',
  {
    id: text('id').notNull(),
    name: text('name'),
    thumbnail: text('thumbnail'),
    nativeName: text('nativeName'),
    englishName: text('englishName'),
    episodeCount: integer('episodeCount'),
    status: text('status'),
    genres: text('genres'),
    popularityScore: integer('popularityScore'),
    type: text('type'),
    anilistId: integer('anilistId'),
    isAdult: integer('isAdult'),
    episodeDuration: integer('episodeDuration'),
  },
  (t) => [primaryKey({ columns: [t.id] })]
)

export const settings = sqliteTable(
  'settings',
  {
    key: text('key').notNull(),
    value: text('value'),
  },
  (t) => [primaryKey({ columns: [t.key] })]
)

export const queue = sqliteTable('queue', {
  id: integer('id'),
  showId: text('showId').notNull(),
  episodeNumber: text('episodeNumber').notNull(),
  queueOrder: integer('queue_order').notNull(),
})

export const discoveredNotifications = sqliteTable(
  'discovered_notifications',
  {
    showId: text('showId').notNull(),
    episodeNumber: text('episodeNumber').notNull(),
    discoveredAt: text('discoveredAt').default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [primaryKey({ columns: [t.showId, t.episodeNumber] })]
)

export const dismissedNotifications = sqliteTable(
  'dismissed_notifications',
  {
    showId: text('showId').notNull(),
    episodeNumber: text('episodeNumber').notNull(),
    dismissedAt: text('dismissedAt').default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [primaryKey({ columns: [t.showId, t.episodeNumber] })]
)

export const tempShowIds = sqliteTable(
  'temp_show_ids',
  {
    id: text('id').notNull(),
    provider: text('provider').notNull(),
    nativeId: text('nativeId').notNull(),
    title: text('title').notNull(),
    thumbnail: text('thumbnail'),
    createdAt: integer('createdAt').notNull(),
  },
  (t) => [primaryKey({ columns: [t.id] })]
)

export const legacyIdMapping = sqliteTable(
  'legacy_id_mapping',
  {
    legacyId: text('legacyId').notNull(),
    numericId: text('numericId'),
  },
  (t) => [primaryKey({ columns: [t.legacyId] })]
)

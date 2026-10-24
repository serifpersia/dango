import assert from 'node:assert/strict'
import '../test-helpers.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { getTableColumns } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import {
  dismissedNotifications,
  discoveredNotifications,
  queue,
  settings,
  showsMeta,
  tempShowIds,
  watchlist,
  watchedEpisodes,
} from './schema-anime.js'
import { mangaLibrary, mangaProgress } from './schema-manga.js'
import { tvLibrary, tvProgress } from './schema-tv.js'
import { asmrLibrary, asmrProgress } from './schema-asmr.js'
import {
  initializeAsmrDatabase,
  initializeDatabase,
  initializeMangaDatabase,
  initializeTvDatabase,
} from './ddl.js'

type Init = (dbPath: string) => Promise<{
  all: <T>(q: string) => T[]
  close: () => void
}>
const CASES: { name: string; init: Init; tables: Record<string, SQLiteTable> }[] = [
  {
    name: 'anime',
    init: initializeDatabase,
    tables: {
      watchlist,
      watched_episodes: watchedEpisodes,
      queue,
      settings,
      shows_meta: showsMeta,
      discovered_notifications: discoveredNotifications,
      dismissed_notifications: dismissedNotifications,
      temp_show_ids: tempShowIds,
    },
  },
  {
    name: 'manga',
    init: initializeMangaDatabase,
    tables: { manga_library: mangaLibrary, manga_progress: mangaProgress },
  },
  {
    name: 'tv',
    init: initializeTvDatabase,
    tables: { tv_library: tvLibrary, tv_progress: tvProgress },
  },
  {
    name: 'asmr',
    init: initializeAsmrDatabase,
    tables: { asmr_library: asmrLibrary, asmr_progress: asmrProgress },
  },
]

for (const { name, init, tables } of CASES) {
  test(`the ${name} drizzle schemas match the created tables`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-schema-'))
    const db = await init(path.join(dir, 'db.sqlite'))
    try {
      for (const [tableName, table] of Object.entries(tables)) {
        const runtime = db
          .all<{ name: string }>(`PRAGMA table_info("${tableName}")`)
          .map((c) => c.name)
          .sort()
        const schema = Object.values(getTableColumns(table))
          .map((c) => c.name)
          .sort()
        assert.deepEqual(schema, runtime, `${name}.${tableName} drifted from its schema`)
      }
    } finally {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
}

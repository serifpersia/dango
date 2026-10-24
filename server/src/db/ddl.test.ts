import assert from 'node:assert/strict'
import '../test-helpers.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  initializeAsmrDatabase,
  initializeDatabase,
  initializeMangaDatabase,
  initializeTvDatabase,
} from './ddl.js'

const ANIME_TABLES = [
  'watchlist',
  'watched_episodes',
  'queue',
  'settings',
  'shows_meta',
  'dismissed_notifications',
  'discovered_notifications',
  'sync_metadata',
  'legacy_id_mapping',
  'temp_show_ids',
]

function tableNames(db: { all: <T>(q: string) => T[] }): string[] {
  return db
    .all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`)
    .map((r) => r.name)
}

async function withTempPath(fn: (p: string) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-ddl-'))
  try {
    await fn(path.join(dir, 'db.sqlite'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('initializeDatabase creates every anime table and seeds db_version', async () => {
  await withTempPath(async (p) => {
    const db = await initializeDatabase(p)
    try {
      const tables = tableNames(db)
      for (const t of ANIME_TABLES) assert.ok(tables.includes(t), `missing table ${t}`)
      assert.equal(
        db.get<{ value: number }>(`SELECT value FROM sync_metadata WHERE key='db_version'`)?.value,
        1
      )
    } finally {
      db.close()
    }
  })
})

test('initializeMangaDatabase creates the manga tables', async () => {
  await withTempPath(async (p) => {
    const db = await initializeMangaDatabase(p)
    try {
      const tables = tableNames(db)
      assert.ok(tables.includes('manga_library'))
      assert.ok(tables.includes('manga_progress'))
      assert.ok(tables.includes('sync_metadata'))
    } finally {
      db.close()
    }
  })
})

test('initializeTvDatabase creates the tv tables', async () => {
  await withTempPath(async (p) => {
    const db = await initializeTvDatabase(p)
    try {
      const tables = tableNames(db)
      assert.ok(tables.includes('tv_library'))
      assert.ok(tables.includes('tv_progress'))
      assert.ok(tables.includes('sync_metadata'))
    } finally {
      db.close()
    }
  })
})

test('initializeAsmrDatabase creates the asmr tables', async () => {
  await withTempPath(async (p) => {
    const db = await initializeAsmrDatabase(p)
    try {
      const tables = tableNames(db)
      assert.ok(tables.includes('asmr_library'))
      assert.ok(tables.includes('asmr_progress'))
      assert.ok(tables.includes('sync_metadata'))
    } finally {
      db.close()
    }
  })
})

test('the initializers are idempotent - opening an existing db adds nothing', async () => {
  await withTempPath(async (p) => {
    const first = await initializeDatabase(p)
    first.close()
    const second = await initializeDatabase(p)
    try {
      const tables = tableNames(second)
      for (const t of ANIME_TABLES) assert.ok(tables.includes(t), `missing table ${t}`)
    } finally {
      second.close()
    }
  })
})

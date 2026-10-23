import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { DatabaseWrapper } from './db.js'

test('close truncates WAL with another connection open and stays idempotent', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dango-close-'))
  const dbPath = path.join(dir, 'test.db')
  const db = await DatabaseWrapper.create(dbPath)
  let reader: DatabaseSync | undefined
  try {
    db.run('PRAGMA journal_mode = WAL')
    db.run('CREATE TABLE items (id INTEGER PRIMARY KEY)')
    reader = new DatabaseSync(dbPath)
    reader.prepare('SELECT COUNT(*) FROM items').get()
    db.run('INSERT INTO items VALUES (1)')
    assert.ok(statSync(`${dbPath}-wal`).size > 0)
    db.close((error) => assert.equal(error, null))
    assert.equal(db.isClosedCheck(), true)
    assert.equal(statSync(`${dbPath}-wal`).size, 0)
    assert.equal(reader.prepare('SELECT id FROM items').get()?.id, 1)
    db.close((error) => assert.equal(error, null))
  } finally {
    db.close()
    reader?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

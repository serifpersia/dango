import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, test } from 'node:test'
import type { DatabaseWrapper } from '../db.js'
import { performAsmrWriteTransactionAsync, performWriteTransactionAsync } from './transaction.js'
import { createTestDb } from '../test-helpers.js'
import { setFrozen } from '../frozen.js'

let db: DatabaseWrapper
let cleanup: () => void
let manifestDir: string

beforeEach(async () => {
  const t = await createTestDb()
  db = t.db
  cleanup = t.cleanup
  manifestDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dango-manifest-'))
})

afterEach(() => {
  setFrozen(false)
  cleanup()
  fs.rmSync(manifestDir, { recursive: true, force: true })
})

test('performWriteTransactionAsync commits the work and bumps db_version', async () => {
  const before = db.get<{ value: number }>(
    `SELECT value FROM sync_metadata WHERE key='db_version'`
  )?.value

  await performWriteTransactionAsync(db, async (tx) => {
    tx.run(`INSERT INTO settings (key,value) VALUES ('k','v')`)
  })

  assert.equal(
    db.get<{ value: number }>(`SELECT value FROM sync_metadata WHERE key='db_version'`)?.value,
    (before ?? 0) + 1
  )
  assert.equal(db.get<{ value: string }>(`SELECT value FROM settings WHERE key='k'`)?.value, 'v')
})

test('performWriteTransactionAsync rolls back when the work throws', async () => {
  const before = db.get<{ value: number }>(
    `SELECT value FROM sync_metadata WHERE key='db_version'`
  )?.value

  await assert.rejects(
    performWriteTransactionAsync(db, async (tx) => {
      tx.run(`INSERT INTO settings (key,value) VALUES ('k','v')`)
      throw new Error('boom')
    })
  )

  assert.equal(db.get(`SELECT value FROM settings WHERE key='k'`), undefined)
  assert.equal(
    db.get<{ value: number }>(`SELECT value FROM sync_metadata WHERE key='db_version'`)?.value,
    before
  )
})

test('performWriteTransactionAsync writes the version through the callback', async () => {
  const manifest = path.join(manifestDir, 'manifest.json')
  let written = 0

  await performWriteTransactionAsync(
    db,
    async () => {},
    async (version) => {
      written = version
      fs.writeFileSync(manifest, JSON.stringify({ version }))
    }
  )

  const expected = db.get<{ value: number }>(
    `SELECT value FROM sync_metadata WHERE key='db_version'`
  )?.value
  assert.equal(written, expected)
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf-8')).version, expected)
})

test('frozen mode skips writes and version bump', async () => {
  const before = db.get<{ value: number }>(
    `SELECT value FROM sync_metadata WHERE key='db_version'`
  )?.value
  setFrozen(true)
  await performWriteTransactionAsync(db, async (tx) => {
    tx.run(`INSERT INTO settings (key,value) VALUES ('k','v')`)
  })
  assert.equal(db.get(`SELECT value FROM settings WHERE key='k'`), undefined)
  assert.equal(
    db.get<{ value: number }>(`SELECT value FROM sync_metadata WHERE key='db_version'`)?.value,
    before
  )
  await performWriteTransactionAsync(
    db,
    async (tx) => {
      tx.run(`INSERT INTO settings (key,value) VALUES ('k','v')`)
    },
    undefined,
    { allowWhenFrozen: true }
  )
  assert.equal(db.get<{ value: string }>(`SELECT value FROM settings WHERE key='k'`)?.value, 'v')
})

test('the per-kind wrapper bumps db_version like the generic one', async () => {
  const before = db.get<{ value: number }>(
    `SELECT value FROM sync_metadata WHERE key='db_version'`
  )?.value

  await performAsmrWriteTransactionAsync(db, async () => {})

  assert.equal(
    db.get<{ value: number }>(`SELECT value FROM sync_metadata WHERE key='db_version'`)?.value,
    (before ?? 0) + 1
  )
})

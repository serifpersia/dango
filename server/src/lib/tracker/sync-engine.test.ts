import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseWrapper } from '../../db.js'
import { assertDeleteCap, collectMediaIds, pushRemoteChanges } from './sync-engine.js'

test('collectMediaIds unions local, remote and the sync state keys', () => {
  const ids = collectMediaIds([1, 2], [2, 3], { '4': {}, nope: {}, '5': {} })
  assert.deepEqual(
    [...ids].sort((a, b) => a - b),
    [1, 2, 3, 4, 5]
  )
})

test('assertDeleteCap lets a small delete through and aborts a big one', () => {
  assert.doesNotThrow(() =>
    assertDeleteCap({ totalDeletes: 5, localItemCount: 10, fetched: 10, message: 'boom' })
  )
  assert.throws(
    () => assertDeleteCap({ totalDeletes: 6, localItemCount: 10, fetched: 10, message: 'boom' }),
    /boom/
  )
})

test('pushRemoteChanges sends the updates and deletes in batches of 10', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  t.after(() => db.close())
  const updates: number[][] = []
  const deletes: number[][] = []
  const tracker = {
    batchUpdateMediaEntries: async (entries: { mediaId: number }[]) => {
      updates.push(entries.map((e) => e.mediaId))
    },
    batchDeleteMediaEntries: async (ids: number[]) => {
      deletes.push(ids)
    },
  }

  await pushRemoteChanges(
    db,
    tracker,
    Array.from({ length: 12 }, (_, i) => ({ mediaId: i, status: 'CURRENT', progress: 0 })),
    Array.from({ length: 3 }, (_, i) => ({ showId: String(i), entryId: 100 + i }))
  )

  assert.equal(updates.length, 2)
  assert.equal(updates[0].length, 10)
  assert.equal(updates[1].length, 2)
  assert.deepEqual(deletes, [[100, 101, 102]])
})

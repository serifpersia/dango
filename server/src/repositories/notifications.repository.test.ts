import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import type { DatabaseWrapper } from '../db.js'
import { NotificationsRepository } from './notifications.repository.js'
import { createTestDb } from '../test-helpers.js'

let db: DatabaseWrapper
let cleanup: () => void

beforeEach(async () => {
  const t = await createTestDb()
  db = t.db
  cleanup = t.cleanup
})

afterEach(() => cleanup())

function seedDiscovered(
  showId: string,
  episode: string,
  status: string,
  discoveredDaysAgo = 0
): void {
  db.run(`INSERT OR IGNORE INTO watchlist (id,name,thumbnail,status) VALUES (?,?,? ,?)`, [
    showId,
    showId,
    'thumb',
    status,
  ])
  db.run(
    `INSERT INTO discovered_notifications (showId,episodeNumber,discoveredAt) VALUES (?,?,datetime('now', ?))`,
    [showId, episode, `-${discoveredDaysAgo} days`]
  )
}

test('getThisWeekDiscovered returns the oldest undiscovered episode of a watching show', async () => {
  seedDiscovered('a', '1', 'Watching')
  seedDiscovered('a', '2', 'Watching')

  const rows = await NotificationsRepository.getThisWeekDiscovered(db)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'a')
  assert.equal(rows[0].episodeNumber, '1')
})

test('getThisWeekDiscovered skips shows that are not being watched', async () => {
  seedDiscovered('a', '1', 'Completed')

  assert.deepEqual(await NotificationsRepository.getThisWeekDiscovered(db), [])
})

test('getThisWeekDiscovered skips episodes that were discovered more than 7 days ago', async () => {
  seedDiscovered('a', '1', 'Watching', 30)

  assert.deepEqual(await NotificationsRepository.getThisWeekDiscovered(db), [])
})

test('getThisWeekDiscovered skips episodes that were already watched', async () => {
  seedDiscovered('a', '1', 'Watching')
  db.run(`INSERT INTO watched_episodes (showId,episodeNumber) VALUES ('a','1')`)

  assert.deepEqual(await NotificationsRepository.getThisWeekDiscovered(db), [])
})

test('dismissed info notifications persist until cleared', async () => {
  await NotificationsRepository.addDismissedInfo(db, 'a', '5')
  await NotificationsRepository.addDismissedInfo(db, 'a', '5')

  assert.deepEqual(await NotificationsRepository.getAllDismissedInfo(db), [
    { showId: 'a', episodeNumber: '5' },
  ])

  await NotificationsRepository.clearDismissedInfo(db)
  assert.deepEqual(await NotificationsRepository.getAllDismissedInfo(db), [])
})

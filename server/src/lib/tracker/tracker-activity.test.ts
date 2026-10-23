import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseWrapper } from '../../db.js'
import { Hono } from 'hono'
import { withTrackerWrite, subscribeTrackerActivity } from './tracker-activity.js'
import { registerTrackerActivity } from '../../hono/tracker-activity.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function sseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  return {
    reader,
    readUntil: async (needle: string) => {
      let index = pending.indexOf(needle)
      while (index === -1) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('stream ended')
        pending += decoder.decode(chunk.value, { stream: true })
        index = pending.indexOf(needle)
      }
      const seen = pending.slice(0, index + needle.length)
      pending = pending.slice(index + needle.length)
      return seen
    },
  }
}

test('activity is scoped per provider and database, and stays active until concurrent writes finish', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  const other = await DatabaseWrapper.create(':memory:')
  t.after(() => {
    db.close()
    other.close()
  })
  const events: string[] = [],
    otherEvents: string[] = []
  const unsubscribe = subscribeTrackerActivity(db, (a) =>
    events.push(`${a.provider}:${a.updating}`)
  )
  const unsubscribeOther = subscribeTrackerActivity(other, (a) =>
    otherEvents.push(`${a.provider}:${a.updating}`)
  )
  const first = deferred(),
    second = deferred(),
    third = deferred()
  const a = withTrackerWrite(db, 'anilist', () => first.promise),
    b = withTrackerWrite(db, 'anilist', () => second.promise),
    c = withTrackerWrite(db, 'mal', () => third.promise)
  assert.deepEqual(events, ['anilist:false', 'mal:false', 'anilist:true', 'mal:true'])
  first.resolve()
  await a
  assert.equal(events.filter((e) => e === 'anilist:false').length, 1)
  second.resolve()
  await b
  assert.deepEqual(events.slice(-1), ['anilist:false'])
  third.resolve()
  await c
  assert.deepEqual(events.slice(-1), ['mal:false'])
  assert.deepEqual(otherEvents, ['anilist:false', 'mal:false'])
  unsubscribe()
  unsubscribeOther()
})

test('failed writes clear activity, and unsubscribed observers receive nothing', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  t.after(() => db.close())
  const events: string[] = []
  const unsubscribe = subscribeTrackerActivity(db, (a) =>
    events.push(`${a.provider}:${a.updating}`)
  )
  await assert.rejects(
    withTrackerWrite(db, 'mal', async () => {
      throw new Error('Network unavailable')
    })
  )
  assert.deepEqual(events, ['anilist:false', 'mal:false', 'mal:true', 'mal:false'])
  unsubscribe()
  await withTrackerWrite(db, 'mal', async () => {})
  assert.deepEqual(events, ['anilist:false', 'mal:false', 'mal:true', 'mal:false'])
})

test('SSE reports live write activity for both trackers and accepts disconnects', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  t.after(() => db.close())
  const app = new Hono()
  registerTrackerActivity(app, () => db)
  const response = await app.request('/api/tracker/activity')
  assert.match(response.headers.get('Content-Type') || '', /text\/event-stream/)
  const { reader, readUntil } = sseReader(response.body!)
  await readUntil('"provider":"anilist","updating":false')
  await readUntil('"provider":"mal","updating":false')

  const pendingWrite = deferred()
  const update = withTrackerWrite(db, 'anilist', () => pendingWrite.promise)
  const active = await readUntil('"provider":"anilist","updating":true')
  assert.match(active, /event: tracker-activity/)
  pendingWrite.resolve()
  await update
  const stopped = await readUntil('"provider":"anilist","updating":false')
  assert.match(stopped, /"updating":false/)
  await reader.cancel()
  await withTrackerWrite(db, 'mal', async () => {})
})

test('activity streams close cleanly before server shutdown', async (t) => {
  const db = await DatabaseWrapper.create(':memory:')
  t.after(() => db.close())
  const app = new Hono()
  registerTrackerActivity(app, () => db)
  const response = await app.request('/api/tracker/activity')
  const { reader, readUntil } = sseReader(response.body!)
  await readUntil('"provider":"anilist","updating":false')
  await readUntil('"provider":"mal","updating":false')
  const { closeTrackerActivityStreams } = await import('../../hono/tracker-activity.js')
  closeTrackerActivityStreams(db)
  assert.equal((await reader.read()).done, true)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker, { RoomsIndex, WatchRoom } from './worker.mjs'

const playback = {
  selection: {
    showId: '21',
    episode: '1',
    provider: 'example',
    mode: 'sub',
    source: 'Server 1',
    title: 'Example',
  },
  position: 100,
  playing: true,
  rate: 1,
}

function setup(env) {
  const values = new Map()
  const sockets = []
  let alarmAt = null
  const ctx = {
    blockConcurrencyWhile: (fn) => fn(),
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, structuredClone(value)),
      setAlarm: async (timestamp) => {
        alarmAt = timestamp
      },
      deleteAll: async () => {
        values.clear()
        alarmAt = null
      },
    },
    getWebSockets: () => sockets,
    acceptWebSocket: () => {},
  }
  const room = new WatchRoom(ctx, env)
  const socket = (host) => {
    let attachment = {
      id: crypto.randomUUID(),
      authenticated: true,
      host,
      status: 'ready',
      window: Date.now(),
      count: 0,
    }
    const messages = []
    const ws = {
      deserializeAttachment: () => attachment,
      serializeAttachment: (a) => {
        attachment = a
      },
      send: (raw) => messages.push(JSON.parse(raw)),
      close: (code) => {
        ws.closed = code
      },
      messages,
    }
    sockets.push(ws)
    return ws
  }
  return { room, ctx, socket, values, alarmAt: () => alarmAt }
}

async function connectHost(setupRoom, token) {
  const NativeResponse = globalThis.Response
  const NativePair = globalThis.WebSocketPair
  let socket
  globalThis.Response = class extends NativeResponse {
    constructor(body, init) {
      if (init?.status === 101) return { status: 101 }
      super(body, init)
    }
  }
  globalThis.WebSocketPair = class {
    constructor() {
      this[0] = {}
      this[1] = socket = setupRoom.socket(false)
    }
  }
  try {
    const response = await setupRoom.room.fetch(
      new Request('https://room/rooms/test/ws', {
        headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `dango-watch-along, ${token}` },
      })
    )
    return { response, socket }
  } finally {
    globalThis.Response = NativeResponse
    if (NativePair === undefined) delete globalThis.WebSocketPair
    else globalThis.WebSocketPair = NativePair
  }
}

test('room credentials stay private, guests cannot change playback, and host disconnect pauses', async (t) => {
  const { room, socket, values } = setup()
  await Promise.resolve()
  const id = crypto.randomUUID()
  const response = await room.fetch(
    new Request(`https://room/${id}`, { method: 'POST', body: JSON.stringify(playback) })
  )
  assert.equal(response.status, 201)
  const credentials = await response.json()
  assert.notEqual(credentials.hostToken, credentials.guestToken)
  assert.equal(credentials.hostToken.length, 64)
  const host = socket(true)
  const guest = socket(false)
  await room.webSocketMessage(host, JSON.stringify({ type: 'name', name: '  Alex  ' }))
  await room.webSocketMessage(
    guest,
    JSON.stringify({ type: 'name', name: 'Sam', id: host.deserializeAttachment().id, host: true })
  )
  assert.deepEqual(
    room.snapshot().members.map((member) => member.name),
    ['Alex', 'Sam']
  )
  assert.equal(guest.deserializeAttachment().host, false)
  await room.webSocketMessage(guest, JSON.stringify({ type: 'name', name: 'a'.repeat(33) }))
  assert.equal(guest.deserializeAttachment().name, 'Sam')
  await room.webSocketMessage(guest, JSON.stringify({ type: 'update', ...playback }))
  assert.equal(room.state.playing, false)
  assert.match(guest.messages.at(-1).error, /Only the host/)
  await room.webSocketMessage(host, JSON.stringify({ type: 'update', ...playback }))
  assert.equal(room.state.playing, true)
  assert.equal(guest.messages.at(-1).state.position, 100)
  assert.equal(JSON.stringify(guest.messages).includes(credentials.hostToken), false)
  assert.equal(JSON.stringify(guest.messages).includes(credentials.guestToken), false)
  await room.webSocketClose(host)
  assert.equal(room.state.playing, false)
  assert.equal(guest.messages.at(-1).state.hostOnline, false)
  assert.equal(values.get('room').playing, false)
  const restored = new WatchRoom({ ...room.ctx, blockConcurrencyWhile: (fn) => fn() })
  await Promise.resolve()
  assert.equal(restored.state.playing, false)
  await room.webSocketMessage(guest, JSON.stringify({ type: 'end' }))
  assert.ok(room.state)
  const deadline = room.deadline()
  t.mock.method(Date, 'now', () => deadline)
  await room.alarm()
  assert.equal(room.state, null)
  assert.equal(values.size, 0)
  assert.equal(guest.closed, 4004)
})

test('room preflight rejects invalid credentials and expired rooms', async () => {
  const { room } = setup()
  await Promise.resolve()
  const id = crypto.randomUUID()
  const created = await room.fetch(
    new Request(`https://room/${id}`, { method: 'POST', body: JSON.stringify(playback) })
  )
  const credentials = await created.json()
  const preflight = (token) =>
    room.fetch(
      new Request(`https://room/rooms/${id}`, { headers: { Authorization: `Bearer ${token}` } })
    )
  assert.equal((await preflight('wrong')).status, 403)
  assert.deepEqual((await (await preflight(credentials.hostToken)).json()).host, true)
  assert.deepEqual((await (await preflight(credentials.guestToken)).json()).host, false)
  room.state.expiresAt = Date.now() - 1
  assert.equal((await preflight(credentials.guestToken)).status, 404)
})

test('worker rejects invalid room creation and enforces the request limiter', async () => {
  const env = { ROOM_LIMIT: { limit: async () => ({ success: true }) } }
  const response = await worker.fetch(
    new Request('https://worker/rooms', { method: 'POST', body: '{}' }),
    env
  )
  assert.equal(response.status, 400)
  env.ROOM_LIMIT.limit = async () => ({ success: false })
  assert.equal(
    (
      await worker.fetch(
        new Request('https://worker/rooms', { method: 'POST', body: JSON.stringify(playback) }),
        env
      )
    ).status,
    429
  )
})

test('host reconnects within 60 seconds without extending the six-hour lifetime or losing the room', async (t) => {
  const setupRoom = setup()
  await Promise.resolve()
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const created = await setupRoom.room.fetch(
    new Request(`https://room/${crypto.randomUUID()}`, {
      method: 'POST',
      body: JSON.stringify(playback),
    })
  )
  const { hostToken } = await created.json()
  const expiry = setupRoom.room.state.expiresAt
  assert.equal(expiry, now + 6 * 60 * 60 * 1000)
  assert.equal(setupRoom.alarmAt(), now + 60000)
  const { response, socket: host } = await connectHost(setupRoom, hostToken)
  assert.equal(response.status, 101)
  assert.equal(setupRoom.alarmAt(), expiry)
  await setupRoom.room.webSocketMessage(host, JSON.stringify({ type: 'update', ...playback }))
  assert.equal(setupRoom.alarmAt(), expiry)
  await setupRoom.room.webSocketClose(host)
  const reconnectUntil = now + 60000
  assert.equal(setupRoom.alarmAt(), reconnectUntil)
  assert.equal(setupRoom.room.state.playing, false)
  now += 59000
  assert.equal((await connectHost(setupRoom, hostToken)).response.status, 101)
  assert.equal(setupRoom.alarmAt(), expiry)
  assert.equal(setupRoom.room.state.expiresAt, expiry)
  now = reconnectUntil
  await setupRoom.room.alarm()
  assert.ok(setupRoom.room.state)
  assert.equal(setupRoom.alarmAt(), expiry)
  now = expiry
  await setupRoom.room.alarm()
  assert.equal(setupRoom.values.size, 0)
  assert.equal(setupRoom.alarmAt(), null)
  assert.equal(setupRoom.room.state, null)
  await setupRoom.room.alarm()
  assert.equal(setupRoom.values.size, 0)
})

test('a missed reconnect deadline deletes the room and rejects late host recovery', async (t) => {
  const setupRoom = setup()
  await Promise.resolve()
  let now = Date.now()
  t.mock.method(Date, 'now', () => now)
  const created = await setupRoom.room.fetch(
    new Request(`https://room/${crypto.randomUUID()}`, {
      method: 'POST',
      body: JSON.stringify(playback),
    })
  )
  const { hostToken } = await created.json()
  const { socket: host } = await connectHost(setupRoom, hostToken)
  const guest = setupRoom.socket(false)
  await setupRoom.room.webSocketClose(host)
  const deadline = setupRoom.alarmAt()
  await setupRoom.room.webSocketMessage(guest, JSON.stringify({ type: 'status', status: 'ready' }))
  assert.equal(setupRoom.alarmAt(), deadline)
  now += 60000
  assert.equal((await connectHost(setupRoom, hostToken)).response.status, 404)
  assert.equal(guest.closed, 4004)
  assert.equal(setupRoom.values.size, 0)
  assert.equal(setupRoom.room.state, null)
  assert.equal(setupRoom.alarmAt(), null)
})

test('admin can list and end active rooms', async () => {
  const values = new Map()
  const index = new RoomsIndex({
    storage: {
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
      list: async ({ prefix } = {}) =>
        new Map([...values].filter(([key]) => key.startsWith(prefix || ''))),
    },
  })
  const rooms = new Map()
  const env = {
    ADMIN_TOKEN: 'test-admin-token',
    ROOMS: { idFromName: (name) => name, get: (name) => rooms.get(name) },
    ROOMS_INDEX: { idFromName: (name) => name, get: () => index },
  }
  const { room, socket } = setup(env)
  await Promise.resolve()
  const id = crypto.randomUUID()
  const created = await room.fetch(
    new Request(`https://room/${id}`, { method: 'POST', body: JSON.stringify(playback) })
  )
  assert.equal(created.status, 201)
  assert.equal(values.get(`room:${id}`), room.state.expiresAt)
  rooms.set(id, room)
  socket(true)
  const admin = (method, path, token = env.ADMIN_TOKEN) =>
    worker.fetch(
      new Request(`https://worker${path}`, {
        method,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
      env
    )
  assert.equal((await admin('GET', '/admin/rooms', '')).status, 401)
  const listed = await (await admin('GET', '/admin/rooms')).json()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].id, id)
  assert.equal(listed[0].members.length, 1)
  const idle = await admin('DELETE', '/admin/rooms?idleMinutes=60')
  assert.deepEqual(await idle.json(), { ok: true, ended: 0 })
  assert.ok(room.state)
  assert.equal((await admin('DELETE', '/admin/rooms?idleMinutes=nope')).status, 400)
  assert.equal((await admin('DELETE', `/admin/rooms/${id}`)).status, 200)
  assert.equal(room.state, null)
  assert.deepEqual(await (await admin('GET', '/admin/rooms')).json(), [])
  assert.equal(values.size, 0)
})

test('a room that never receives its host connection is also cleaned up after 60 seconds', async (t) => {
  const setupRoom = setup()
  await Promise.resolve()
  const now = Date.now()
  await setupRoom.room.fetch(
    new Request(`https://room/${crypto.randomUUID()}`, {
      method: 'POST',
      body: JSON.stringify(playback),
    })
  )
  t.mock.method(Date, 'now', () => now + 60001)
  await setupRoom.room.alarm()
  assert.equal(setupRoom.values.size, 0)
  assert.equal(setupRoom.room.state, null)
})

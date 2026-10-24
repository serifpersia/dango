import {
  parseWatchPlayback,
  parseWatchName,
  watchPosition,
  WATCH_ROOM_ID,
} from '../../server/src/lib/watch-along.ts'
import { invitePage } from './invite.mjs'

const LIFE = 6 * 60 * 60 * 1000
const RECONNECT_GRACE = 60 * 1000
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
}
const json = (body, status = 200) => Response.json(body, { status, headers })
const token = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('')

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method === 'GET' && url.pathname === '/health')
      return json({ status: 'ok', protocol: 1 })
    if (request.method === 'GET' && url.pathname === '/join')
      return new Response(invitePage, {
        headers: {
          ...headers,
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy':
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
      })
    const match =
      request.method === 'GET' && url.pathname.match(/^\/rooms\/([0-9a-f-]{36})(\/ws)?$/)
    if ((request.method === 'POST' && url.pathname === '/rooms') || match) {
      const allowed = await env.ROOM_LIMIT.limit({
        key: request.headers.get('CF-Connecting-IP') || 'unknown',
      })
      if (!allowed.success) return json({ error: 'Too many requests. Try again shortly.' }, 429)
      if (match) {
        if (match[2] && request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
          return json({ error: 'WebSocket required' }, 426)
        return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request)
      }
      try {
        if (Number(request.headers.get('Content-Length')) > 8192)
          return json({ error: 'Request too large' }, 413)
        const body = await request.text()
        if (body.length > 8192) return json({ error: 'Request too large' }, 413)
        const playback = parseWatchPlayback(JSON.parse(body))
        const id = crypto.randomUUID()
        return env.ROOMS.get(env.ROOMS.idFromName(id)).fetch(
          new Request(`https://room/${id}`, {
            method: 'POST',
            body: JSON.stringify(playback),
          })
        )
      } catch {
        return json({ error: 'Invalid room selection' }, 400)
      }
    }
    return json({ error: 'Not found' }, 404)
  },
}

export class WatchRoom {
  constructor(ctx) {
    this.ctx = ctx
    this.state = null
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get('room')) || null
    })
  }

  async fetch(request) {
    if (request.method === 'POST') {
      if (this.state) return json({ error: 'Room already exists' }, 409)
      const id = new URL(request.url).pathname.slice(1)
      if (!WATCH_ROOM_ID.test(id)) return json({ error: 'Invalid room' }, 400)
      const hostToken = token()
      const guestToken = token()
      this.state = {
        ...parseWatchPlayback(await request.json()),
        playing: false,
        id,
        hostToken,
        guestToken,
        revision: 1,
        updatedAt: Date.now(),
        expiresAt: Date.now() + LIFE,
        hostReconnectUntil: Date.now() + RECONNECT_GRACE,
      }
      await this.save()
      await this.ctx.storage.setAlarm(this.deadline())
      return json({ id, hostToken, guestToken, expiresAt: this.state.expiresAt }, 201)
    }
    if (!this.state || Date.now() >= this.deadline()) {
      if (this.state) await this.end('Room expired')
      return json({ error: 'Room expired or does not exist' }, 404)
    }
    const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '')
      .split(',')
      .map((p) => p.trim())
    const upgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    const credential = upgrade
      ? protocols[1]
      : request.headers.get('Authorization')?.replace(/^Bearer /, '')
    if (
      (upgrade && protocols[0] !== 'dango-watch-along') ||
      !credential ||
      (credential !== this.state.hostToken && credential !== this.state.guestToken)
    )
      return json({ error: 'Invalid invite' }, 403)
    const host = credential === this.state.hostToken
    if (!upgrade) return json({ host, expiresAt: this.state.expiresAt })
    if (host) {
      for (const old of this.sockets()) {
        const a = old.deserializeAttachment()
        if (a.host) {
          old.serializeAttachment({ ...a, authenticated: false })
          old.close(4009, 'Host connected elsewhere')
        }
      }
    }
    const members = this.sockets()
    if (
      members.length >= 16 ||
      (!host && members.filter((ws) => !ws.deserializeAttachment().host).length >= 15)
    )
      return json({ error: 'Room is full' }, 409)
    const pair = new WebSocketPair()
    this.ctx.acceptWebSocket(pair[1])
    const id = crypto.randomUUID()
    pair[1].serializeAttachment({
      id,
      host,
      authenticated: true,
      status: 'loading',
      name: '',
      window: Date.now(),
      count: 0,
    })
    if (host) {
      this.state.hostReconnectUntil = null
      await this.save()
      await this.ctx.storage.setAlarm(this.deadline())
    }
    pair[1].send(JSON.stringify({ type: 'joined', id, host }))
    this.broadcast()
    return new Response(null, {
      status: 101,
      webSocket: pair[0],
      headers: { 'Sec-WebSocket-Protocol': 'dango-watch-along' },
    })
  }

  save() {
    return this.ctx.storage.put('room', this.state)
  }

  deadline() {
    return Math.min(this.state.expiresAt, this.state.hostReconnectUntil ?? Infinity)
  }

  sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.deserializeAttachment()?.authenticated)
  }

  snapshot() {
    const members = this.sockets().map((ws) => {
      const { id, host, status, name } = ws.deserializeAttachment()
      return { id, host, status, name }
    })
    const { selection, position, playing, rate, revision, updatedAt, expiresAt } = this.state
    return {
      selection,
      position,
      playing,
      rate,
      revision,
      updatedAt,
      expiresAt,
      hostOnline: members.some((m) => m.host),
      members,
    }
  }

  broadcast() {
    const message = JSON.stringify({
      type: 'state',
      state: this.snapshot(),
      serverTime: Date.now(),
    })
    for (const ws of this.sockets()) {
      try {
        ws.send(message)
      } catch {
        /* ignore */
      }
    }
  }

  async webSocketMessage(ws, raw) {
    if (!this.state || Date.now() >= this.deadline()) {
      await this.end('Room expired')
      return
    }
    const a = ws.deserializeAttachment()
    if (typeof raw !== 'string' || raw.length > 8192) {
      ws.close(4000, 'Invalid message')
      return
    }
    if (Date.now() - a.window > 10000) {
      a.window = Date.now()
      a.count = 0
    }
    if (++a.count > 40) {
      ws.close(4008, 'Too many messages')
      return
    }
    ws.serializeAttachment(a)
    try {
      const msg = JSON.parse(raw)
      if (!a.authenticated) return
      if (msg.type === 'name') {
        const name = parseWatchName(msg.name)
        if (a.name !== name) {
          ws.serializeAttachment({ ...a, name })
          this.broadcast()
        }
        return
      }
      if (msg.type === 'ping' && Number.isFinite(msg.sentAt)) {
        ws.send(JSON.stringify({ type: 'pong', sentAt: msg.sentAt, serverTime: Date.now() }))
        return
      }
      if (
        msg.type === 'status' &&
        ['loading', 'ready', 'buffering', 'blocked', 'error'].includes(msg.status)
      ) {
        if (a.status !== msg.status) {
          ws.serializeAttachment({ ...a, status: msg.status })
          this.broadcast()
        }
        return
      }
      if (!a.host) {
        ws.send(JSON.stringify({ type: 'error', error: 'Only the host controls playback' }))
        return
      }
      if (msg.type === 'end') {
        await this.end('Host ended the room')
        return
      }
      if (msg.type === 'update') {
        this.state = {
          ...this.state,
          ...parseWatchPlayback(msg),
          revision: this.state.revision + 1,
          updatedAt: Date.now(),
        }
        await this.save()
        this.broadcast()
      }
    } catch {
      ws.send(JSON.stringify({ type: 'error', error: 'Invalid message' }))
    }
  }

  async webSocketClose(ws) {
    const a = ws.deserializeAttachment()
    if (!a?.authenticated) return
    ws.serializeAttachment({ ...a, authenticated: false })
    if (a.host && this.state) {
      this.state = {
        ...this.state,
        position: watchPosition(this.state, Date.now()),
        playing: false,
        updatedAt: Date.now(),
        revision: this.state.revision + 1,
        hostReconnectUntil: Date.now() + RECONNECT_GRACE,
      }
      await this.save()
      await this.ctx.storage.setAlarm(this.deadline())
    }
    if (this.state) this.broadcast()
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws)
    ws.close(1011, 'Connection error')
  }

  async end(reason) {
    for (const ws of this.ctx.getWebSockets()) ws.close(4004, reason)
    this.state = null
    await this.ctx.storage.deleteAll()
  }

  async alarm() {
    if (!this.state || Date.now() >= this.deadline()) await this.end('Room expired')
    else await this.ctx.storage.setAlarm(this.deadline())
  }
}

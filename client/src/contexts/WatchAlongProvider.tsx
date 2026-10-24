import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router'
import { trpcClient } from '../lib/trpc'
import { WatchAlongContext } from './WatchAlongContext'
import { parseWatchInvite, watchAlongPath } from '../lib/watchAlong'
import type { WatchPlayback, WatchRoom, WatchSession } from '../lib/watchAlong'
import { useLocalStorage } from '../hooks/useLocalStorage'

const SESSION_KEY = 'dango-watch-along'

export function WatchAlongProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [displayName, setDisplayName] = useLocalStorage('watchAlongName', '')
  const [session, setSession] = useState<WatchSession | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
      if (!saved) return null
      const guest = parseWatchInvite(`${saved.id}.${saved.guestToken}`, '')
      const auth = parseWatchInvite(`${saved.id}.${saved.token}`, '')
      return { ...guest, token: auth.token, host: saved.host === true }
    } catch {
      return null
    }
  })
  const [room, setRoom] = useState<WatchRoom | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [selfId, setSelfId] = useState('')
  const [clock, setClock] = useState({ offset: 0, latency: 0 })
  const socket = useRef<WebSocket | null>(null)
  const { data: config } = useQuery({
    queryKey: ['watch-along-config'],
    queryFn: () => trpcClient.settings.watchAlong.query(),
  })
  const workerUrl = config?.workerUrl.replace(/\/$/, '') || ''

  useEffect(() => {
    try {
      if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
      else sessionStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
  }, [session])

  const send = useCallback((message: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(message))
  }, [])

  useEffect(() => {
    if (!connected) return
    const timer = setTimeout(() => send({ type: 'name', name: displayName }), 250)
    return () => clearTimeout(timer)
  }, [connected, selfId, displayName, send])

  const leave = useCallback(() => {
    if (session?.host) send({ type: 'end' })
    socket.current?.close(1000, 'Left room')
    setSession(null)
    setRoom(null)
    setConnected(false)
    setError('')
  }, [send, session])

  const create = async (playback: WatchPlayback) => {
    if (!workerUrl) throw new Error('Watch along is unavailable. Check your server configuration.')
    const response = await fetch(`${workerUrl}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(playback),
      signal: AbortSignal.timeout(15000),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Could not create room')
    const guest = parseWatchInvite(`${data.id}.${data.guestToken}`, workerUrl)
    const host = parseWatchInvite(`${data.id}.${data.hostToken}`, workerUrl)
    setError('')
    setRoom(null)
    setSession({ ...guest, token: host.token, host: true })
  }

  const join = (invite: string) => {
    if (!workerUrl) throw new Error('Watch along is unavailable. Check your server configuration.')
    const next = parseWatchInvite(invite, workerUrl)
    setError('')
    setRoom(null)
    setSession(next)
  }

  useEffect(() => {
    if (!session || !workerUrl) return
    let stopped = false
    let failures = 0
    let retry: ReturnType<typeof setTimeout>
    let heartbeat: ReturnType<typeof setInterval>
    let lastMessage = Date.now()
    const connect = async () => {
      if (stopped) return
      try {
        const response = await fetch(`${workerUrl}/rooms/${session.id}`, {
          headers: { Authorization: `Bearer ${session.token}` },
          signal: AbortSignal.timeout(10000),
        })
        if (stopped) return
        if (!response.ok) {
          const data = await response.json()
          if ([403, 404, 409].includes(response.status)) {
            setError(data.error || 'Unable to join room')
            setSession(null)
            setRoom(null)
            return
          }
          throw new Error(data.error || 'Room service unavailable')
        }
      } catch {
        if (stopped) return
        setError('Cannot reach the room service. Retrying…')
        retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(failures++, 4)))
        return
      }
      const url = new URL(`${workerUrl}/rooms/${session.id}/ws`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(url, ['dango-watch-along', session.token])
      socket.current = ws
      ws.onopen = () => {
        lastMessage = Date.now()
      }
      ws.onmessage = (event) => {
        if (stopped || socket.current !== ws) return
        lastMessage = Date.now()
        try {
          const message = JSON.parse(event.data)
          if (message.type === 'joined') {
            if (message.host !== session.host) {
              ws.close(4003, 'Invalid role')
              return
            }
            failures = 0
            setConnected(true)
            setError('')
            setSelfId(message.id)
            ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }))
          } else if (message.type === 'state') {
            setRoom((previous) =>
              previous && previous.revision > message.state.revision ? previous : message.state
            )
          } else if (message.type === 'pong') {
            const rtt = Date.now() - message.sentAt
            setClock({ offset: message.serverTime - (message.sentAt + rtt / 2), latency: rtt / 2 })
          } else if (message.type === 'error') setError(message.error)
        } catch {
          setError('Invalid response from the room service.')
        }
      }
      ws.onclose = (event) => {
        if (stopped || socket.current !== ws) return
        clearInterval(heartbeat)
        setConnected(false)
        if ([4003, 4004, 4009].includes(event.code)) {
          setError(event.reason || 'Room closed')
          setSession(null)
          setRoom(null)
          return
        }
        setError('Connection lost. Reconnecting…')
        retry = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(failures++, 4)))
      }
      ws.onerror = () => ws.close()
      heartbeat = setInterval(() => {
        if (Date.now() - lastMessage > 25000) ws.close()
        else if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'ping', sentAt: Date.now() }))
      }, 10000)
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(heartbeat)
      socket.current?.close(1000, 'Leaving connection')
      socket.current = null
      setConnected(false)
    }
  }, [session, workerUrl])

  useEffect(() => {
    if (!session || session.host || !room) return
    const path = watchAlongPath(room.selection)
    if (`${location.pathname}${location.search}` !== path) navigate(path, { replace: true })
  }, [session, room, location.pathname, location.search, navigate])

  return (
    <WatchAlongContext.Provider
      value={{
        workerUrl,
        displayName,
        setDisplayName,
        session,
        room,
        connected,
        error,
        selfId,
        clock,
        create,
        join,
        leave,
        send,
      }}
    >
      {children}
    </WatchAlongContext.Provider>
  )
}

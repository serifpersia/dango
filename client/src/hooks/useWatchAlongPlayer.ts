import { useCallback, useEffect, useRef, useState } from 'react'
import { useWatchAlong } from '../contexts/WatchAlongContext'
import { sameWatchSelection, watchPosition } from '../lib/watchAlong'
import type { WatchSelection } from '../lib/watchAlong'
import type { PlayerEngine } from '../lib/player/engine'

export function useWatchAlongPlayer(
  engine: PlayerEngine,
  selection: WatchSelection | null,
  loading: boolean
) {
  const watch = useWatchAlong()
  const latest = useRef({ watch, selection, loading })
  latest.current = { watch, selection, loading }
  const [needsPlayback, setNeedsPlayback] = useState(false)
  const lastStatus = useRef('')
  const lastPublished = useRef('')
  const hostConnection = useRef('')
  const wasInRoom = useRef(false)
  const guest = !!watch.session && !watch.session.host

  useEffect(() => {
    if (!watch.session && wasInRoom.current) engine.applyRemotePlayback(undefined, false, 1)
    wasInRoom.current = !!watch.session
    engine.setPlaybackLocked(!!watch.session && (guest || !watch.connected))
    if (watch.session && !watch.connected) engine.applyRemotePlayback(undefined, false, 1)
    return () => engine.setPlaybackLocked(false)
  }, [engine, guest, watch.connected, watch.session])

  const sync = useCallback(
    (userGesture = false) => {
      const { watch, selection, loading } = latest.current
      const media = engine.mediaRef.current
      if (!watch.session || !watch.room || !media) return
      if (watch.session.host) {
        if (
          watch.connected &&
          watch.selfId !== hostConnection.current &&
          !loading &&
          selection &&
          media.readyState >= 1
        ) {
          hostConnection.current = watch.selfId
          if (sameWatchSelection(selection, watch.room.selection))
            engine.applyRemotePlayback(watch.room.position, false, watch.room.rate)
        }
        return
      }
      const room = watch.room
      const matches = selection && sameWatchSelection(selection, room.selection)
      if (!watch.connected || loading || !matches || media.readyState < 1) {
        engine.applyRemotePlayback(undefined, false, room.rate)
        return
      }
      const fresh = Date.now() + watch.clock.offset - room.updatedAt < 15000
      if (room.playing && !fresh) {
        engine.applyRemotePlayback(undefined, false, room.rate)
        return
      }
      const playing = room.playing && room.hostOnline && fresh
      const target = Math.min(
        media.duration || Infinity,
        watchPosition({ ...room, playing }, Date.now() + watch.clock.offset)
      )
      const drift = target - media.currentTime
      const seek = Math.abs(drift) > (playing ? 1.25 : 0.15)
      const rate =
        playing && !seek && Math.abs(drift) > 0.15
          ? Math.min(4, Math.max(0.25, room.rate * (drift > 0 ? 1.03 : 0.97)))
          : room.rate
      const blocked = engine.getState().playBlocked
      engine.applyRemotePlayback(
        seek ? target : undefined,
        playing && (!blocked || userGesture),
        rate
      )
      setNeedsPlayback(blocked && playing)
    },
    [engine]
  )

  useEffect(() => {
    if (!watch.session) return
    const publish = () => {
      const { watch, selection, loading } = latest.current
      const media = engine.mediaRef.current
      if (!watch.connected || !watch.session?.host || !watch.room) return
      if (!selection || loading || !media || media.readyState < 1) {
        if (watch.room.playing) watch.send({ type: 'update', ...watch.room, playing: false })
        return
      }
      sync()
      const state = engine.getState()
      const playing = !media.paused && !media.ended && !state.isBuffering
      const message = {
        type: 'update',
        selection,
        position:
          media.currentTime + (playing ? (watch.clock.latency / 1000) * media.playbackRate : 0),
        playing,
        rate: media.playbackRate,
      }
      const key = JSON.stringify(message)
      if (!playing && lastPublished.current === key) return
      lastPublished.current = key
      watch.send(message)
    }
    const tick = () => {
      const { watch, selection, loading } = latest.current
      const state = engine.getState()
      const media = engine.mediaRef.current
      const status =
        state.error || (!loading && !selection)
          ? 'error'
          : state.playBlocked
            ? 'blocked'
            : loading || !media || media.readyState < 1
              ? 'loading'
              : state.isBuffering
                ? 'buffering'
                : 'ready'
      if (watch.connected && `${watch.selfId}:${status}` !== lastStatus.current) {
        lastStatus.current = `${watch.selfId}:${status}`
        watch.send({ type: 'status', status })
      }
      sync()
    }
    let bound: HTMLMediaElement | null = null
    const events = [
      'play',
      'pause',
      'seeked',
      'ratechange',
      'playing',
      'waiting',
      'canplay',
      'ended',
    ]
    let pending: ReturnType<typeof setTimeout>
    const changed = () => {
      clearTimeout(pending)
      pending = setTimeout(publish, 100)
    }
    const timer = setInterval(() => {
      const media = engine.mediaRef.current
      if (bound !== media) {
        events.forEach((event) => bound?.removeEventListener(event, changed))
        bound = media
        events.forEach((event) => bound?.addEventListener(event, changed))
      }
      tick()
    }, 500)
    const checkpoint = setInterval(publish, 3000)
    return () => {
      clearInterval(timer)
      clearInterval(checkpoint)
      clearTimeout(pending)
      events.forEach((event) => bound?.removeEventListener(event, changed))
      const { watch } = latest.current
      if (watch.session?.host && watch.room && watch.connected)
        watch.send({
          type: 'update',
          ...watch.room,
          playing: false,
          position: engine.mediaRef.current?.currentTime ?? watch.room.position,
        })
    }
  }, [engine, watch.session, sync])

  useEffect(() => {
    sync()
  }, [watch.room, watch.connected, selection, loading, sync])

  return { needsPlayback, enablePlayback: () => sync(true) }
}

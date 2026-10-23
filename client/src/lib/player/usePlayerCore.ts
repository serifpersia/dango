import { useLayoutEffect, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createPlayerEngine } from './engine'
import type { PlayerEngine } from './engine'
import type { PlayerPreferences } from './types'

export function usePlayerState(engine: PlayerEngine) {
  return useSyncExternalStore(engine.subscribe, engine.getState)
}

export function usePlayerTimeline(engine: PlayerEngine) {
  return useSyncExternalStore(engine.subscribeTimeline, engine.getTimeline)
}

export function usePlayerCore<T extends HTMLMediaElement = HTMLVideoElement>(
  preferences: PlayerPreferences = {}
) {
  const initialPreferences = useRef(preferences)
  const engine = useMemo(() => createPlayerEngine(initialPreferences.current), [])
  useLayoutEffect(() => {
    engine.connect()
  })
  useEffect(() => () => engine.destroy(), [engine])
  return useMemo(() => ({ engine, mediaRef: engine.mediaRef as { current: T | null } }), [engine])
}

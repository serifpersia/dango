import { createContext, useContext } from 'react'
import type { WatchPlayback, WatchRoom, WatchSession } from '../lib/watchAlong'

export interface WatchAlongValue {
  workerUrl: string
  displayName: string
  setDisplayName: (name: string) => void
  session: WatchSession | null
  room: WatchRoom | null
  connected: boolean
  error: string
  selfId: string
  clock: { offset: number; latency: number }
  create: (playback: WatchPlayback) => Promise<void>
  join: (invite: string) => void
  leave: () => void
  send: (message: object) => void
}

export const WatchAlongContext = createContext<WatchAlongValue | null>(null)

export function useWatchAlong() {
  const value = useContext(WatchAlongContext)
  if (!value) throw new Error('WatchAlongProvider is missing')
  return value
}

import { afterEach, expect, it, vi } from 'vitest'
import { useWatchAlongPlayer } from './useWatchAlongPlayer'
import type { PlayerEngine } from '../lib/player/engine'

const { effects, watch } = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  watch: {
    session: { host: true },
    connected: true,
    selfId: 'connection-one',
    room: {
      selection: {
        showId: '21',
        episode: '1',
        provider: 'example',
        mode: 'sub' as const,
        source: 'one',
        title: 'Example',
      },
      position: 125,
      rate: 1,
    },
  },
}))

vi.mock('react', () => ({
  useEffect: (effect: () => unknown) => effects.push(effect),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
  useCallback: (callback: unknown) => callback,
}))
vi.mock('../contexts/WatchAlongContext', () => ({ useWatchAlong: () => watch }))
afterEach(() => {
  effects.length = 0
})

it('restores the host position once on reconnect before publishing fresh playback', () => {
  const applyRemotePlayback = vi.fn()
  useWatchAlongPlayer(
    {
      mediaRef: { current: { readyState: 1 } },
      applyRemotePlayback,
    } as unknown as PlayerEngine,
    watch.room.selection,
    false
  )
  effects[2]()
  expect(applyRemotePlayback).toHaveBeenCalledWith(125, false, 1)
  effects[2]()
  expect(applyRemotePlayback).toHaveBeenCalledTimes(1)
  watch.selfId = 'connection-two'
  effects[2]()
  expect(applyRemotePlayback).toHaveBeenCalledTimes(2)
})

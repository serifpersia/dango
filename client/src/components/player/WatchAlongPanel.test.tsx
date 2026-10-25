import { beforeEach, expect, it, vi } from 'vitest'
import WatchAlongPanel from './WatchAlongPanel'

const { effects, panel, watch } = vi.hoisted(() => ({
  effects: [] as (() => void)[],
  panel: { open: false },
  watch: {
    session: null as { id: string; guestToken: string; host: boolean } | null,
    workerUrl: '',
    room: null,
    error: '',
    displayName: '',
  },
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (value: unknown) => [value, vi.fn()],
  useRef: () => ({ current: panel }),
  useEffect: (effect: () => void) => effects.push(effect),
}))
vi.mock('../../contexts/WatchAlongContext', () => ({ useWatchAlong: () => watch }))

beforeEach(() => {
  effects.length = 0
  panel.open = false
  watch.session = null
})

it('starts collapsed outside a room and uses a native disclosure', () => {
  expect(WatchAlongPanel({}).type).toBe('details')
  effects.forEach((effect) => effect())
  expect(panel.open).toBe(false)
})

it.each([true, false])('opens automatically when joining a room (host: %s)', (host) => {
  watch.session = { id: 'room', guestToken: 'guest', host }
  WatchAlongPanel({})
  effects.forEach((effect) => effect())
  expect(panel.open).toBe(true)
})

it('opens to show an enable-playback prompt', () => {
  WatchAlongPanel({ needsPlayback: true })
  effects.forEach((effect) => effect())
  expect(panel.open).toBe(true)
})

it('preserves manual expansion outside a room', () => {
  panel.open = true
  WatchAlongPanel({})
  effects.forEach((effect) => effect())
  expect(panel.open).toBe(true)
})

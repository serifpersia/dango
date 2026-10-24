import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  forgetWatchHost,
  parseWatchInvite,
  readWatchSession,
  rememberWatchSession,
  watchAlongPath,
} from './watchAlong'

const id = '12f45a67-89ab-4cde-8fab-123456789abc'
const token = 'a'.repeat(64)
const guestToken = 'b'.repeat(64)
const hostSession = { id, token, guestToken, host: true }
const guestSession = { id, token: guestToken, guestToken, host: false }

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

describe('watch-along session storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recovers a host session from localStorage when the tab storage is empty', () => {
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('localStorage', memoryStorage())
    rememberWatchSession(hostSession)
    sessionStorage.removeItem('dango-watch-along')
    expect(readWatchSession()).toEqual(hostSession)
  })

  it('prefers the current tab session over a stale host entry', () => {
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('localStorage', memoryStorage())
    rememberWatchSession(hostSession)
    rememberWatchSession(guestSession)
    expect(readWatchSession()).toEqual(guestSession)
  })

  it('keeps guests out of the host store and forgets host intent on request', () => {
    vi.stubGlobal('sessionStorage', memoryStorage())
    vi.stubGlobal('localStorage', memoryStorage())
    rememberWatchSession(guestSession)
    expect(localStorage.getItem('dango-watch-along-host')).toBeNull()
    rememberWatchSession(hostSession)
    forgetWatchHost()
    expect(readWatchSession()).toEqual(hostSession)
    expect(localStorage.getItem('dango-watch-along-host')).toBeNull()
  })
})

describe('watch-along invites', () => {
  const worker = 'https://rooms.example.com'
  it('accepts a code or an invite from the configured service', () => {
    expect(parseWatchInvite(`${worker}/join#${id}.${token}`, worker)).toEqual({
      id,
      token,
      guestToken: token,
      host: false,
    })
    expect(parseWatchInvite(`${id}.${token}`, worker).id).toBe(id)
  })
  it('rejects incomplete invites, extra credentials, and links to other services', () => {
    for (const value of [
      id,
      `${id}.${token}.extra`,
      `https://other.example/join#${id}.${token}`,
      `${worker}/other#${id}.${token}`,
    ])
      expect(() => parseWatchInvite(value, worker)).toThrow()
  })
  it('routes anime, television seasons, and movies to their own players', () => {
    const selection = {
      showId: '21',
      episode: '4',
      provider: 'example',
      mode: 'sub' as const,
      source: 'one',
      title: 'Example',
    }
    expect(watchAlongPath(selection)).toBe('/watch/21/4')
    expect(watchAlongPath({ ...selection, kind: 'tv', season: 2 })).toBe(
      '/tv/21/watch?type=tv&s=2&e=4'
    )
    expect(watchAlongPath({ ...selection, kind: 'movie' })).toBe('/tv/21/watch?type=movie')
  })
})

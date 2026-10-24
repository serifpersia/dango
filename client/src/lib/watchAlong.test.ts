import { describe, expect, it } from 'vitest'
import { parseWatchInvite, watchAlongPath } from './watchAlong'

describe('watch-along invites', () => {
  const worker = 'https://rooms.example.com'
  const id = '12f45a67-89ab-4cde-8fab-123456789abc'
  const token = 'a'.repeat(64)
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

import { describe, it, expect } from 'vitest'
import {
  musicThumbCandidates,
  musicCoverUrl,
  forgetThumb,
  rememberThumb,
} from './musicThumb'

const yt3 = (size: number, token: string) =>
  `https://yt3.googleusercontent.com/${token}=w${size}-h${size}-l90-rj`

const decoded = (candidate: string) => decodeURIComponent(candidate)

describe('musicThumbCandidates', () => {
  it('upgrades the size suffix on session art and proxies it', () => {
    const c = musicThumbCandidates('nFOlaUH5jrE', [{ url: yt3(120, 'TOKENA') }])
    expect(c).toHaveLength(2)
    expect(c[0]).toContain('w544-h544')
    expect(decoded(c[0])).toContain('yt3.googleusercontent.com')
    expect(c[0].startsWith('/api/image-proxy?url=')).toBe(true)
  })

  it('appends the permanent ytimg fallback last', () => {
    const c = musicThumbCandidates('nFOlaUH5jrE', [])
    expect(c).toHaveLength(1)
    expect(decoded(c[0])).toContain('i.ytimg.com/vi/nFOlaUH5jrE/hqdefault.jpg')
  })

  it('asks the proxy to fail hard so dead art triggers the next candidate', () => {
    const c = musicThumbCandidates('nFOlaUH5jrE', [{ url: yt3(120, 'TOKENA') }])
    expect(c[0]).toContain('strict=1')
  })

  it('omits the ytimg fallback for ids that are not video ids', () => {
    const c = musicThumbCandidates('VLPLxyzPlaylistId', [{ url: yt3(120, 'TOKENB') }])
    expect(c).toHaveLength(1)
    expect(decoded(c[0])).not.toContain('ytimg')
  })

  it('tries the remembered winner first', () => {
    const winner = musicThumbCandidates('pgXNn8fOhHM', [])[0]
    rememberThumb('pgXNn8fOhHM', winner)
    const c = musicThumbCandidates('pgXNn8fOhHM', [{ url: yt3(120, 'TOKENA') }])
    expect(c[0]).toBe(winner)
    expect(c).toHaveLength(2)
  })

  it('drops a failed url and falls through permanently', () => {
    const bad = musicThumbCandidates('wOBNhe3zi7k', [{ url: yt3(120, 'TOKEND') }])[0]
    expect(decoded(bad)).toContain('googleusercontent')
    forgetThumb(bad)
    const c = musicThumbCandidates('wOBNhe3zi7k', [{ url: yt3(120, 'TOKEND') }])
    expect(c).not.toContain(bad)
    expect(c).toHaveLength(1)
    expect(decoded(c[0])).toContain('i.ytimg.com')
  })

  it('collapses duplicate thumbnails', () => {
    const c = musicThumbCandidates('AoZtPp9CdjI', [
      { url: yt3(120, 'TOKENC') },
      { url: yt3(120, 'TOKENC') },
    ])
    expect(c).toHaveLength(2)
  })
})

describe('musicCoverUrl', () => {
  it('returns a direct https url, never the proxy wrapper', () => {
    const cover = musicCoverUrl('nFOlaUH5jrE', [{ url: yt3(120, 'TOKENA') }])
    expect(cover.startsWith('https://')).toBe(true)
    expect(cover).not.toContain('/api/image-proxy')
    expect(cover).toContain('w544-h544')
  })

  it('falls back to the permanent url when there is no thumbnail', () => {
    expect(musicCoverUrl('nFOlaUH5jrE')).toBe(
      'https://i.ytimg.com/vi/nFOlaUH5jrE/hqdefault.jpg'
    )
  })

  it('returns empty for ids that are neither video ids nor thumbnailed', () => {
    expect(musicCoverUrl('VLPLxyzPlaylistId')).toBe('')
    expect(musicCoverUrl(undefined)).toBe('')
  })
})

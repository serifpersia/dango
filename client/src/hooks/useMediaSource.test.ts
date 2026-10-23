import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaSource } from './useMediaSource'
import type { PlayerEngine } from '../lib/player/engine'

const { effects } = vi.hoisted(() => ({ effects: [] as (() => unknown)[] }))
vi.mock('react', () => ({
  useEffect: (effect: () => unknown) => effects.push(effect),
  useRef: (current: unknown) => ({ current }),
}))

describe('anime source resume position', () => {
  beforeEach(() => {
    effects.length = 0
    vi.stubGlobal('document', { body: { classList: { contains: () => false } } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([0, 45, 240])(
    'keeps an explicit quality-switch position of %s over saved progress',
    (position) => {
      const loadSource = vi.fn()
      const { seekToTimeRef } = useMediaSource({
        engine: { loadSource } as unknown as PlayerEngine,
        videoRef: { current: { firstChild: null } as HTMLVideoElement },
        selectedSource: { sourceName: 'Source', links: [] },
        selectedLink: { link: 'https://example.com/video.m3u8', hls: true, resolutionStr: '720p' },
        loadingVideo: false,
        testClipActive: false,
        resumeTime: 120,
        showResumeModal: false,
        calibReturnRef: { current: null },
        setAvailableSubtitles: vi.fn(),
        setActiveSubtitleTrack: vi.fn(),
        onFatalError: vi.fn(),
      })
      seekToTimeRef.current = position
      effects[1]()
      expect(loadSource).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ initialTime: position, autoPlay: true })
      )
      expect(seekToTimeRef.current).toBeNull()
    }
  )
})

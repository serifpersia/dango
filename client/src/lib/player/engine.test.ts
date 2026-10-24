import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayerEngine } from './engine'
import { loadHls } from '../hls'

vi.mock('../hls', () => ({
  loadHls: vi.fn(),
  canPlayHlsNatively: (media: HTMLMediaElement) =>
    media.canPlayType('application/vnd.apple.mpegurl') !== '',
}))

class Media extends EventTarget {
  tagName = 'VIDEO'
  paused = true
  ended = false
  seeking = false
  readyState = 0
  currentTime = 0
  duration = 120
  volume = 1
  muted = false
  playbackRate = 1
  src = ''
  error: { message: string } | null = null
  buffered = { length: 0, start: () => 0, end: () => 0 }
  seekable = { length: 0, start: () => 0, end: () => 0 }
  textTracks = Object.assign([] as TextTrack[], {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  querySelector = vi.fn(() => null)
  canPlayType = vi.fn(() => '')
  load = vi.fn(() => {
    this.currentTime = 0
  })
  removeAttribute = vi.fn(() => {
    this.src = ''
  })
  play = vi.fn(async () => {
    this.paused = false
    this.dispatchEvent(new Event('play'))
  })
  pause = vi.fn(() => {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  })
}

class HlsMock {
  static Events = {
    ERROR: 'error',
    MANIFEST_PARSED: 'manifest',
    AUDIO_TRACKS_UPDATED: 'audio-tracks',
    AUDIO_TRACK_SWITCHED: 'audio-switch',
    SUBTITLE_TRACKS_UPDATED: 'subtitle-tracks',
    SUBTITLE_TRACK_SWITCH: 'subtitle-switch',
    LEVEL_SWITCHED: 'level-switch',
  }
  audioTracks: { name: string; lang: string }[] = []
  subtitleTracks: { name: string; lang: string }[] = []
  levels: { height: number; bitrate: number }[] = []
  audioTrack = -1
  subtitleTrack = -1
  currentLevel = -1
  static isSupported = () => true
  static instances: HlsMock[] = []
  handlers = new Map<string, ((...args: unknown[]) => void)[]>()
  constructor() {
    HlsMock.instances.push(this)
  }
  on(name: string, callback: (...args: unknown[]) => void) {
    this.handlers.set(name, [...(this.handlers.get(name) ?? []), callback])
  }
  once = this.on
  loadSource = vi.fn()
  attachMedia = vi.fn()
  destroy = vi.fn()
  emit(name: string, data?: unknown) {
    this.handlers.get(name)?.forEach((callback) => callback(name, data))
  }
}

describe('player engine', () => {
  const engines: ReturnType<typeof createPlayerEngine>[] = []
  function setup(tagName = 'VIDEO') {
    const media = new Media()
    media.tagName = tagName
    const engine = createPlayerEngine({ volumeKey: 'volume', mutedKey: 'muted' })
    engines.push(engine)
    engine.mediaRef.current = media as unknown as HTMLMediaElement
    engine.connect()
    return { media, engine }
  }

  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() })
    vi.mocked(loadHls)
      .mockReset()
      .mockResolvedValue(HlsMock as unknown as NonNullable<Awaited<ReturnType<typeof loadHls>>>)
    HlsMock.instances = []
  })
  afterEach(() => {
    engines.forEach((engine) => engine.destroy())
    engines.length = 0
    vi.unstubAllGlobals()
  })

  it.each(['VIDEO', 'AUDIO'])(
    'reads native events and isolates timeline updates for %s',
    (kind) => {
      const { engine, media } = setup(kind)
      const stateChanged = vi.fn()
      const timeChanged = vi.fn()
      engine.subscribe(stateChanged)
      engine.subscribeTimeline(timeChanged)
      media.dispatchEvent(new Event('loadedmetadata'))
      expect(engine.getState().duration).toBe(120)
      stateChanged.mockClear()
      media.currentTime = 42
      media.buffered = {
        length: 2,
        start: (index = 0) => (index === 0 ? 0 : 80),
        end: (index = 0) => (index === 0 ? 60 : 120),
      }
      media.dispatchEvent(new Event('timeupdate'))
      expect(engine.getTimeline()).toEqual({ currentTime: 42, bufferedEnd: 60 })
      expect(timeChanged).toHaveBeenCalledOnce()
      expect(stateChanged).not.toHaveBeenCalled()
      media.duration = Infinity
      media.dispatchEvent(new Event('durationchange'))
      expect(engine.getState().duration).toBe(0)
    }
  )

  it('locks guest transport controls while allowing room updates and personal volume', async () => {
    const { engine, media } = setup()
    engine.setPlaybackLocked(true)
    await engine.play()
    engine.seek(50)
    engine.setPlaybackRate(2)
    engine.setSpeedBoost(true)
    engine.startScrubbing()
    expect(media.paused).toBe(true)
    expect(media.currentTime).toBe(0)
    expect(media.playbackRate).toBe(1)
    expect(engine.getState().isScrubbing).toBe(false)
    engine.setVolume(0.3)
    expect(media.volume).toBe(0.3)
    engine.applyRemotePlayback(40, true, 1.5)
    expect(media.currentTime).toBe(40)
    expect(media.playbackRate).toBe(1.5)
    expect(media.paused).toBe(false)
    engine.pause()
    expect(media.paused).toBe(false)
    engine.applyRemotePlayback(undefined, false, 1)
    expect(media.paused).toBe(true)
    engine.setPlaybackLocked(false)
    engine.seek(60)
    expect(media.currentTime).toBe(60)
  })

  it('clamps seeks and volume and restores audible volume when unmuting', () => {
    const { engine, media } = setup()
    engine.seek(-10)
    expect(media.currentTime).toBe(0)
    engine.seek(999)
    expect(media.currentTime).toBe(120)
    engine.seek(NaN)
    expect(media.currentTime).toBe(120)
    engine.setVolume(-1)
    expect(engine.getState().isMuted).toBe(true)
    engine.toggleMute()
    expect(media.volume).toBe(0.5)
    expect(media.muted).toBe(false)
    engine.setVolume(2)
    expect(media.volume).toBe(1)
    engine.setVolume(NaN)
    expect(media.volume).toBe(1)
    expect(localStorage.setItem).toHaveBeenCalledWith('volume', '1')
  })

  it('treats blocked autoplay as recoverable and does not leak old play errors', async () => {
    const { engine, media } = setup()
    media.play.mockRejectedValueOnce(new DOMException('Blocked', 'NotAllowedError'))
    expect(await engine.play()).toBe(false)
    expect(engine.getState()).toMatchObject({ playBlocked: true, error: null, isBuffering: false })
    expect(await engine.play()).toBe(true)
    expect(engine.getState().playBlocked).toBe(false)
    let reject!: (error: Error) => void
    media.play.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise
        })
    )
    const pending = engine.play()
    engine.loadSource({ url: '/new.mp4' })
    reject(new Error('Old stream failed'))
    await pending
    expect(engine.getState().error).toBe(null)
  })

  it('resumes scrubbing only when playback was active', async () => {
    const { engine, media } = setup()
    await engine.play()
    engine.startScrubbing()
    engine.startScrubbing()
    expect(media.paused).toBe(true)
    engine.seek(30)
    engine.endScrubbing()
    expect(media.play).toHaveBeenCalledTimes(2)
    engine.pause()
    engine.startScrubbing()
    engine.endScrubbing()
    expect(media.paused).toBe(true)
  })

  it('cancels lazy HLS setup when another source replaces it', async () => {
    const { engine, media } = setup()
    let resolve!: (value: Awaited<ReturnType<typeof loadHls>>) => void
    vi.mocked(loadHls).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      })
    )
    const ready = vi.fn()
    engine.loadSource({ url: '/old.m3u8', hls: true }, { onReady: ready, autoPlay: true })
    engine.loadSource({ url: '/current.mp4' })
    resolve(HlsMock as unknown as NonNullable<Awaited<ReturnType<typeof loadHls>>>)
    await Promise.resolve()
    expect(HlsMock.instances).toHaveLength(0)
    expect(media.src).toBe('/current.mp4')
    expect(ready).not.toHaveBeenCalled()
    expect(media.play).not.toHaveBeenCalled()
  })

  it('owns each HLS instance, reports fatal errors, and disposes only once', async () => {
    const { engine } = setup()
    const failed = vi.fn()
    const configure = vi.fn()
    const dispose = engine.loadSource(
      { url: '/test.m3u8', hls: true },
      { onHls: configure, onError: failed }
    )
    await Promise.resolve()
    const first = HlsMock.instances[0]
    expect(configure).toHaveBeenCalledBefore(first.loadSource)
    first.emit('error', { fatal: true, details: 'networkError' })
    expect(failed).toHaveBeenCalledOnce()
    expect(engine.getState().error).toContain('networkError')
    dispose()
    expect(first.destroy).toHaveBeenCalledOnce()
    engine.loadSource({ url: '/next.m3u8', hls: true })
    await Promise.resolve()
    const second = HlsMock.instances[1]
    dispose()
    expect(second.destroy).not.toHaveBeenCalled()
    expect(engine.getHls()).toBe(second)
  })

  it('supports native HLS and reports unsupported HLS instead of silently stalling', async () => {
    const { engine, media } = setup('AUDIO')
    vi.mocked(loadHls).mockResolvedValue(null)
    engine.loadSource({ url: '/unsupported.m3u8', hls: true })
    await Promise.resolve()
    await Promise.resolve()
    expect(engine.getState().error).toContain('HLS playback is unavailable')
    media.canPlayType.mockReturnValue('probably')
    engine.loadSource({ url: '/native.m3u8', hls: true })
    await Promise.resolve()
    expect(media.src).toBe('/native.m3u8')
    expect(engine.getState().error).toBe(null)
  })

  it('removes stale resume listeners and releases handlers on teardown', () => {
    const { engine, media } = setup()
    engine.loadSource({ url: '/first.mp4' }, { initialTime: 60 })
    engine.loadSource({ url: '/second.mp4' }, { initialTime: 10 })
    media.dispatchEvent(new Event('loadedmetadata'))
    expect(media.currentTime).toBe(10)
    const timeChanged = vi.fn()
    engine.subscribeTimeline(timeChanged)
    engine.destroy()
    timeChanged.mockClear()
    media.currentTime = 90
    media.dispatchEvent(new Event('timeupdate'))
    expect(timeChanged).not.toHaveBeenCalled()
    expect(engine.getTimeline().currentTime).toBe(10)
  })
})

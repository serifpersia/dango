import { canPlayHlsNatively, loadHls } from '../hls'
import type Hls from 'hls.js'
import type {
  PlayerPreferences,
  PlayerSource,
  PlayerSourceOptions,
  PlayerState,
  PlayerTimeline,
} from './types'
import { subscribeFullscreen, toggleFullscreen, getFullscreenElement } from '../fullscreen'

let activeMedia: HTMLMediaElement | null = null

function stored(key: string | undefined): string | null {
  try {
    return key ? localStorage.getItem(key) : null
  } catch {
    return null
  }
}

function persist(key: string | undefined, value: number | boolean) {
  try {
    if (key) localStorage.setItem(key, String(value))
  } catch {
    // ignore
  }
}

export function createPlayerEngine(preferences: PlayerPreferences = {}) {
  const savedVolume = Number.parseFloat(stored(preferences.volumeKey) ?? '')
  let state: PlayerState = {
    isPlaying: false,
    isBuffering: false,
    isMuted: stored(preferences.mutedKey) === 'true',
    volume: Number.isFinite(savedVolume) ? Math.max(0, Math.min(1, savedVolume)) : 1,
    duration: 0,
    playbackRate: 1,
    isScrubbing: false,
    isFullscreen: false,
    showControls: true,
    isSpeedBoostActive: false,
    audioTracks: [],
    subtitleTracks: [],
    qualities: [],
    activeAudioTrack: -1,
    activeSubtitleTrack: -1,
    activeQuality: -1,
    error: null,
    playBlocked: false,
  }
  let timeline: PlayerTimeline = { currentTime: 0, bufferedEnd: 0 }
  const listeners = new Set<() => void>()
  const timelineListeners = new Set<() => void>()
  const mediaRef = { current: null as HTMLMediaElement | null }
  const containerRef = { current: null as HTMLDivElement | null }
  let connected: HTMLMediaElement | null = null
  let removeListeners = () => {}
  let disposeSource = () => {}
  let sourceGeneration = 0
  let wasPlayingBeforeScrub = false
  let basePlaybackRate = 1
  let destroyed = false
  let hls: Hls | null = null

  function update(patch: Partial<PlayerState>) {
    if (
      Object.entries(patch).every(([key, value]) =>
        Object.is(state[key as keyof PlayerState], value)
      )
    )
      return
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  function updateTimeline(patch: PlayerTimeline) {
    if (timeline.currentTime === patch.currentTime && timeline.bufferedEnd === patch.bufferedEnd)
      return
    timeline = patch
    timelineListeners.forEach((listener) => listener())
  }

  function captureTimeline(media: HTMLMediaElement | null) {
    if (!media) return
    let bufferedEnd = 0
    for (let i = 0; i < media.buffered.length; i++) {
      if (
        media.buffered.start(i) <= media.currentTime &&
        media.buffered.end(i) >= media.currentTime
      ) {
        bufferedEnd = media.buffered.end(i)
        break
      }
    }
    updateTimeline({
      currentTime: Number.isFinite(media.currentTime) ? media.currentTime : 0,
      bufferedEnd,
    })
  }

  function readTimeline() {
    captureTimeline(mediaRef.current)
  }

  function connect() {
    const media = mediaRef.current
    if (connected === media) return
    if (connected) {
      if (activeMedia === connected) activeMedia = media
      captureTimeline(connected)
      disposeSource()
      connected.pause()
      connected.removeAttribute('src')
      connected.load()
    }
    removeListeners()
    connected = media
    if (!media) return
    destroyed = false
    if (!activeMedia) activeMedia = media
    media.volume = state.volume
    media.muted = state.isMuted
    media.playbackRate = state.playbackRate
    const nativeTracks = () => {
      const tracks = Array.from(media.textTracks)
      if (!tracks.length) return
      const active = tracks.findIndex((track) => track.mode === 'showing')
      update({
        subtitleTracks: tracks.map((track, id) => ({
          id,
          label: track.label || track.language || `Track ${id + 1}`,
          language: track.language,
        })),
        ...(active >= 0 ? { activeSubtitleTrack: active } : {}),
      })
    }
    const events: Record<string, () => void> = {
      play: () => {
        activeMedia = media
        update({ isPlaying: true, playBlocked: false, error: null })
      },
      playing: () => update({ isPlaying: true, isBuffering: false, playBlocked: false }),
      pause: () => update({ isPlaying: false, isBuffering: false }),
      ended: () => {
        update({ isPlaying: false, isBuffering: false })
        readTimeline()
      },
      waiting: () => {
        if (!media.paused && (media.readyState < 3 || media.seeking)) update({ isBuffering: true })
      },
      canplay: () => update({ isBuffering: false }),
      seeking: () => {
        if (!media.paused) update({ isBuffering: true })
        readTimeline()
      },
      seeked: () => {
        update({ isBuffering: false })
        readTimeline()
      },
      timeupdate: () => {
        readTimeline()
        if (!media.paused && !media.seeking) update({ isBuffering: false })
      },
      progress: readTimeline,
      loadedmetadata: () => {
        media.playbackRate = state.playbackRate
        update({ duration: Number.isFinite(media.duration) ? media.duration : 0 })
        nativeTracks()
      },
      durationchange: () =>
        update({ duration: Number.isFinite(media.duration) ? media.duration : 0 }),
      ratechange: () => {
        if (!state.isSpeedBoostActive) basePlaybackRate = media.playbackRate
        if (media.defaultPlaybackRate !== media.playbackRate)
          media.defaultPlaybackRate = media.playbackRate
        update({ playbackRate: media.playbackRate })
      },
      volumechange: () => {
        update({ volume: media.volume, isMuted: media.muted })
        persist(preferences.volumeKey, media.volume)
        persist(preferences.mutedKey, media.muted)
      },
      error: () =>
        update({
          error: media.error?.message || 'Unable to play this source.',
          isPlaying: false,
          isBuffering: false,
        }),
    }
    Object.entries(events).forEach(([name, listener]) => media.addEventListener(name, listener))
    media.textTracks.addEventListener('addtrack', nativeTracks)
    media.textTracks.addEventListener('removetrack', nativeTracks)
    media.textTracks.addEventListener('change', nativeTracks)
    const getVideo = () => (media.tagName === 'VIDEO' ? (media as HTMLVideoElement) : null)
    const syncFullscreen = () => {
      const element = getFullscreenElement(getVideo())
      update({
        isFullscreen: element !== null && (element === media || element === containerRef.current),
      })
    }
    const unsubscribeFullscreen =
      typeof document === 'undefined' ? () => {} : subscribeFullscreen(getVideo, syncFullscreen)
    if (typeof document !== 'undefined') syncFullscreen()
    removeListeners = () => {
      Object.entries(events).forEach(([name, listener]) =>
        media.removeEventListener(name, listener)
      )
      unsubscribeFullscreen()
      media.textTracks.removeEventListener('addtrack', nativeTracks)
      media.textTracks.removeEventListener('removetrack', nativeTracks)
      media.textTracks.removeEventListener('change', nativeTracks)
    }
  }

  async function play() {
    const media = mediaRef.current
    if (!media) return false
    activeMedia = media
    const generation = sourceGeneration
    try {
      await media.play()
      return generation === sourceGeneration
    } catch (error) {
      if (generation === sourceGeneration) {
        const blocked = error instanceof Error && error.name === 'NotAllowedError'
        const aborted = error instanceof Error && error.name === 'AbortError'
        update({
          isPlaying: false,
          isBuffering: false,
          playBlocked: blocked,
          ...(!blocked && !aborted
            ? { error: error instanceof Error ? error.message : 'Playback failed.' }
            : {}),
        })
      }
      return false
    }
  }

  function pause() {
    mediaRef.current?.pause()
  }
  function togglePlay() {
    if (mediaRef.current?.paused) void play()
    else pause()
  }

  function seek(time: number) {
    const media = mediaRef.current
    if (!media || !Number.isFinite(time)) return
    let target = Math.max(0, time)
    if (Number.isFinite(media.duration)) target = Math.min(media.duration, target)
    else if (media.seekable.length) {
      for (let i = 0; i < media.seekable.length; i++) {
        if (target <= media.seekable.end(i)) {
          target = Math.max(media.seekable.start(i), target)
          break
        }
        if (i === media.seekable.length - 1) target = media.seekable.end(i)
      }
    }
    media.currentTime = target
    readTimeline()
  }

  function seekRelative(delta: number) {
    seek((mediaRef.current?.currentTime ?? timeline.currentTime) + delta)
  }

  function setVolume(value: number) {
    if (!Number.isFinite(value)) return
    const volume = Math.max(0, Math.min(1, value))
    update({ volume, isMuted: volume === 0 })
    if (mediaRef.current) {
      mediaRef.current.volume = volume
      mediaRef.current.muted = volume === 0
    }
    persist(preferences.volumeKey, volume)
    persist(preferences.mutedKey, volume === 0)
  }

  function toggleMute() {
    const isMuted = !state.isMuted
    if (!isMuted && state.volume === 0) setVolume(0.5)
    update({ isMuted })
    if (mediaRef.current) mediaRef.current.muted = isMuted
    persist(preferences.mutedKey, isMuted)
  }

  function setPlaybackRate(rate: number) {
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) return
    basePlaybackRate = rate
    const playbackRate = state.isSpeedBoostActive ? 2 : rate
    update({ playbackRate })
    if (mediaRef.current) mediaRef.current.playbackRate = playbackRate
  }

  function startScrubbing() {
    if (state.isScrubbing) return
    wasPlayingBeforeScrub = !!mediaRef.current && !mediaRef.current.paused
    update({ isScrubbing: true })
    pause()
  }

  function endScrubbing() {
    if (!state.isScrubbing) return
    update({ isScrubbing: false })
    if (wasPlayingBeforeScrub) void play()
    wasPlayingBeforeScrub = false
  }

  function loadSource(source: PlayerSource, options: PlayerSourceOptions = {}) {
    disposeSource()
    connect()
    const media = mediaRef.current
    const generation = ++sourceGeneration
    if (!media) return () => {}
    let cancelled = false
    let instance: Hls | null = null
    const current = () =>
      !cancelled && sourceGeneration === generation && mediaRef.current === media
    media.pause()
    media.removeAttribute('src')
    media.load()
    update({
      duration: 0,
      isPlaying: false,
      isBuffering: true,
      isScrubbing: false,
      error: null,
      playBlocked: false,
      audioTracks: [],
      subtitleTracks: [],
      qualities: [],
      activeAudioTrack: -1,
      activeSubtitleTrack: -1,
      activeQuality: -1,
    })
    updateTimeline({ currentTime: 0, bufferedEnd: 0 })
    const loaded = () => {
      if (!current()) return
      if (options.initialTime && options.initialTime > 0) seek(options.initialTime)
    }
    media.addEventListener('loadedmetadata', loaded, { once: true })
    const ready = () => {
      if (!current()) return
      options.onReady?.()
      if (options.autoPlay && current()) void play()
    }
    const fail = (error: unknown) => {
      if (!current()) return
      const err = error instanceof Error ? error : new Error(String(error))
      update({ error: err.message, isPlaying: false, isBuffering: false })
      options.onError?.(err)
    }
    const dispose = () => {
      if (cancelled) return
      cancelled = true
      media.removeEventListener('loadedmetadata', loaded)
      media.removeEventListener('error', sourceError)
      instance?.destroy()
      if (hls === instance) hls = null
      instance = null
      if (sourceGeneration === generation) sourceGeneration++
    }
    const sourceError = () => {
      fail(new Error(media.error?.message || 'Unable to play this source.'))
      dispose()
    }
    media.addEventListener('error', sourceError)
    disposeSource = dispose
    void (async () => {
      if (source.hls) {
        const HlsClass = await loadHls()
        if (!current()) return
        if (HlsClass?.isSupported()) {
          instance = new HlsClass({ enableWorker: true, ...options.hlsConfig })
          hls = instance
          const player = instance
          const refreshTracks = () => {
            if (!current()) return
            update({
              audioTracks: player.audioTracks.map((track, id) => ({
                id,
                label: track.name || track.lang || `Track ${id + 1}`,
                language: track.lang,
              })),
              ...(media.querySelector('track')
                ? {}
                : {
                    subtitleTracks: player.subtitleTracks.map((track, id) => ({
                      id,
                      label: track.name || track.lang || `Track ${id + 1}`,
                      language: track.lang,
                    })),
                  }),
              qualities: player.levels.map((level, id) => ({
                id,
                label: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}k`,
              })),
              activeAudioTrack: player.audioTrack,
              ...(media.querySelector('track')
                ? {}
                : { activeSubtitleTrack: player.subtitleTrack }),
              activeQuality: player.currentLevel,
            })
          }
          for (const event of [
            HlsClass.Events.MANIFEST_PARSED,
            HlsClass.Events.AUDIO_TRACKS_UPDATED,
            HlsClass.Events.AUDIO_TRACK_SWITCHED,
            HlsClass.Events.SUBTITLE_TRACKS_UPDATED,
            HlsClass.Events.SUBTITLE_TRACK_SWITCH,
            HlsClass.Events.LEVEL_SWITCHED,
          ])
            player.on(event, refreshTracks)
          instance.on(HlsClass.Events.ERROR, (_event, data) => {
            if (data.fatal && current()) {
              fail(new Error(`Stream failed (${data.details}). Try another source or reload.`))
              dispose()
            }
          })
          instance.once(HlsClass.Events.MANIFEST_PARSED, ready)
          options.onHls?.(instance, HlsClass)
          if (!current()) return
          instance.loadSource(source.url)
          instance.attachMedia(media)
          return
        }
        if (!canPlayHlsNatively(media))
          throw new Error('HLS playback is unavailable in this browser.')
      }
      if (!current()) return
      media.src = source.url
      media.load()
      ready()
    })().catch((error) => {
      fail(error)
      dispose()
    })
    return dispose
  }

  return {
    mediaRef,
    containerRef,
    connect,
    getState: () => state,
    getTimeline: () => timeline,
    getHls: () => hls,
    isActive: () => activeMedia === mediaRef.current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribeTimeline: (listener: () => void) => {
      timelineListeners.add(listener)
      return () => {
        timelineListeners.delete(listener)
      }
    },
    play,
    pause,
    togglePlay,
    seek,
    seekRelative,
    setVolume,
    toggleMute,
    setPlaybackRate,
    setAudioTrack: (id: number) => {
      if (hls && state.audioTracks.some((track) => track.id === id)) {
        hls.audioTrack = id
        update({ activeAudioTrack: id })
      }
    },
    setSubtitleTrack: (id: number) => {
      if (id !== -1 && !state.subtitleTracks.some((track) => track.id === id)) return
      const media = mediaRef.current
      if (media?.querySelector('track')) {
        Array.from(media.textTracks).forEach((track, index) => {
          track.mode = index === id ? 'showing' : 'disabled'
        })
      } else if (hls) hls.subtitleTrack = id
      update({ activeSubtitleTrack: id })
    },
    setQuality: (id: number) => {
      if (hls && (id === -1 || state.qualities.some((quality) => quality.id === id))) {
        hls.currentLevel = id
        update({ activeQuality: id })
      }
    },
    setSpeedBoost: (isSpeedBoostActive: boolean) => {
      const playbackRate = isSpeedBoostActive ? 2 : basePlaybackRate
      update({ isSpeedBoostActive, playbackRate })
      if (mediaRef.current) mediaRef.current.playbackRate = playbackRate
    },
    setShowControls: (showControls: boolean) => update({ showControls }),
    startScrubbing,
    endScrubbing,
    loadSource,
    unload: () => {
      const media = mediaRef.current
      captureTimeline(media)
      disposeSource()
      if (media) {
        media.pause()
        media.removeAttribute('src')
        media.load()
      }
      update({ isPlaying: false, isBuffering: false, duration: 0, error: null })
      updateTimeline({ currentTime: 0, bufferedEnd: 0 })
    },
    toggleFullscreen: () => {
      const media = mediaRef.current
      void toggleFullscreen(
        containerRef.current,
        media?.tagName === 'VIDEO' ? (media as HTMLVideoElement) : null
      ).catch((error: unknown) =>
        update({ error: error instanceof Error ? error.message : 'Fullscreen failed.' })
      )
    },
    reset: () => {
      update({ duration: 0, isBuffering: false, error: null })
      updateTimeline({ currentTime: 0, bufferedEnd: 0 })
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      const media = connected ?? mediaRef.current
      captureTimeline(media)
      removeListeners()
      connected = null
      disposeSource()
      media?.pause()
      media?.removeAttribute('src')
      media?.load()
      if (activeMedia === media) activeMedia = null
    },
  }
}

export type PlayerEngine = ReturnType<typeof createPlayerEngine>

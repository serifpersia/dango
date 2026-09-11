import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  FaPlay,
  FaPause,
  FaVolumeUp,
  FaVolumeMute,
  FaVolumeDown,
  FaExpand,
  FaCompress,
  FaCog,
  FaChevronLeft,
  FaCheck,
  FaClosedCaptioning,
  FaServer,
} from 'react-icons/fa'
import { MdReplay10, MdForward10 } from 'react-icons/md'
import styles from './TvPlayerControls.module.css'
import { pickSubtitleIndex } from '../../lib/subtitles'
import { MenuSlider, SegmentedRow, SwatchRow } from '../player/MenuControls'
import {
  BG_COLOR_PRESETS,
  DEFAULT_SUBTITLE_STYLE,
  TEXT_COLOR_PRESETS,
  buildCueCss,
  loadSubtitleStyle,
  type SubtitleEdge,
  type SubtitleStyleSettings,
} from '../../lib/subtitleStyle'

type SettingsView =
  'main' | 'quality' | 'subtitles' | 'subtitle-style' | 'audio' | 'server' | 'av-sync' | null

interface TvPlayerControlsProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  title: string
  audioTracks: { language: string; label: string }[]
  selectedAudioTrack: number
  onAudioTrackChange: (index: number) => void
  subtitles: { language: string; label: string; url: string }[]
  selectedSubtitle: number
  onSubtitleChange: (index: number) => void
  streams: { quality: string; type: string }[]
  qualityIdx: number
  onQualityChange: (idx: number) => void
  onBack: () => void
  children?: React.ReactNode
  movyServers?: readonly string[]
  selectedMovyServer?: string
  onMovyServerSelect?: (city: string) => void
  isMovySource?: boolean
  videoDelayEnabled?: boolean
  onVideoDelayToggle?: (value: boolean) => void
  videoDelayMs?: number
  onVideoDelayChange?: (ms: number) => void
  onCalibrateAvSync?: () => void
}

const TvPlayerControls: React.FC<TvPlayerControlsProps> = ({
  videoRef,
  title,
  audioTracks,
  selectedAudioTrack,
  onAudioTrackChange,
  subtitles,
  selectedSubtitle,
  onSubtitleChange,
  streams,
  qualityIdx,
  onQualityChange,
  onBack,
  children,
  movyServers = [],
  selectedMovyServer = 'atlanta',
  onMovyServerSelect,
  isMovySource = false,
  videoDelayEnabled = false,
  onVideoDelayToggle,
  videoDelayMs = 0,
  onVideoDelayChange,
  onCalibrateAvSync,
}) => {
  const [isPlaying, setIsPlaying] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(() => {
    try {
      const saved = parseFloat(localStorage.getItem('playerVolume') || '1')
      return isNaN(saved) ? 1 : Math.max(0, Math.min(1, saved))
    } catch {
      return 1
    }
  })
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('playerMuted') === 'true')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [settingsView, setSettingsView] = useState<SettingsView>(null)
  const [hoverTime, setHoverTime] = useState<{ time: number; position: number | null }>({
    time: 0,
    position: null,
  })
  const [isScrubbing, setIsScrubbing] = useState(false)
  const [initialSubtitleStyle] = useState(loadSubtitleStyle)
  const [subtitleFontSize, setSubtitleFontSize] = useState(initialSubtitleStyle.fontSize)
  const [subtitlePosition, setSubtitlePosition] = useState(initialSubtitleStyle.position)
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState(initialSubtitleStyle.bgOpacity)
  const [subtitleBgColor, setSubtitleBgColor] = useState(initialSubtitleStyle.bgColor)
  const [subtitleTextColor, setSubtitleTextColor] = useState(initialSubtitleStyle.textColor)
  const [subtitleEdge, setSubtitleEdge] = useState<SubtitleEdge>(initialSubtitleStyle.edge)
  const [subtitleBold, setSubtitleBold] = useState(initialSubtitleStyle.bold)
  const persistSubtitleSetting = (key: string, value: string | number | boolean) => {
    try {
      localStorage.setItem(key, String(value))
    } catch {
      // ignore
    }
  }
  const [pendingDelayMs, setPendingDelayMs] = useState<number | null>(null)
  const shownDelayMs = pendingDelayMs ?? videoDelayMs
  useEffect(() => {
    setPendingDelayMs(null)
  }, [videoDelayMs])
  const commitDelay = () => {
    if (pendingDelayMs !== null) {
      onVideoDelayChange?.(pendingDelayMs)
      setPendingDelayMs(null)
    }
  }
  const inactivityTimer = useRef<number | null>(null)
  const lastInteractionTimeRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<number | null>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const updateState = () => {
      setIsPlaying(!video.paused)
      setCurrentTime(video.currentTime)
      setDuration(video.duration || 0)
    }

    video.addEventListener('play', updateState)
    video.addEventListener('pause', updateState)
    video.addEventListener('timeupdate', updateState)
    video.addEventListener('loadedmetadata', updateState)
    video.addEventListener('volumechange', () => {
      setVolume(video.volume)
      setIsMuted(video.muted)
    })

    return () => {
      video.removeEventListener('play', updateState)
      video.removeEventListener('pause', updateState)
      video.removeEventListener('timeupdate', updateState)
      video.removeEventListener('loadedmetadata', updateState)
      video.removeEventListener('volumechange', updateState)
    }
  }, [videoRef])

  useEffect(() => {
    const styleId = 'tv-player-subtitle-style'
    let styleTag = document.getElementById(styleId)
    if (!styleTag) {
      styleTag = document.createElement('style')
      styleTag.id = styleId
      document.head.appendChild(styleTag)
    }

    const subtitleStyle: SubtitleStyleSettings = {
      fontSize: subtitleFontSize,
      position: subtitlePosition,
      bgOpacity: subtitleBgOpacity,
      bgColor: subtitleBgColor,
      textColor: subtitleTextColor,
      edge: subtitleEdge,
      bold: subtitleBold,
    }
    styleTag.textContent = buildCueCss(subtitleStyle)

    const video = videoRef.current
    if (video) {
      const getLift = () => {
        const raw = Number(subtitlePosition)
        return isNaN(raw) ? 0 : Math.max(0, Math.min(100, raw))
      }

      const setCueLine = (cue: unknown, line: number) => {
        try {
          const vttCue = cue as { snapToLines?: boolean; line?: number }
          vttCue.snapToLines = false
          vttCue.line = line
        } catch {
          // ignore
        }
      }

      const cueMetrics = () => {
        const px = (isNaN(subtitleFontSize) ? 1.8 : subtitleFontSize) * 16
        const h = video.videoHeight || video.clientHeight || 720
        const w = video.videoWidth || video.clientWidth || 1280
        return { step: ((px * 1.3) / h) * 100, chars: Math.max(20, Math.floor(w / (px * 0.55))) }
      }

      const restackTrack = (track: TextTrack) => {
        const pos = Math.max(0, Math.min(100, 100 - getLift()))
        const active = Array.from(track.activeCues ?? [])
        if (active.length <= 1) {
          active.forEach((cue) => setCueLine(cue, pos))
          return
        }
        const { step, chars } = cueMetrics()
        let bottom = pos
        for (let i = active.length - 1; i >= 0; i--) {
          const text = String((active[i] as { text?: unknown }).text ?? '').replace(/<[^>]*>/g, '')
          const visual = text
            .split('\n')
            .reduce((n, seg) => n + Math.max(1, Math.ceil(seg.length / chars)), 0)
          const top = bottom - visual * step
          setCueLine(active[i], Math.max(0, top))
          bottom = top - step * 0.4
        }
      }

      const updateCuePosition = () => {
        const pos = Math.max(0, Math.min(100, 100 - getLift()))
        Array.from(video.textTracks).forEach((track) => {
          if (!track.cues) return
          Array.from(track.cues).forEach((cue: unknown) => setCueLine(cue, pos))
          if (track.mode === 'showing') restackTrack(track)
        })
      }

      updateCuePosition()
      const handleCueChange = (e: Event) => {
        const track = e.target as TextTrack
        if (track.mode === 'showing') restackTrack(track)
      }
      const handleAddTrack = () => {
        Array.from(video.textTracks).forEach((t) => {
          t.removeEventListener('cuechange', handleCueChange)
          t.addEventListener('cuechange', handleCueChange)
        })
        updateCuePosition()
      }
      Array.from(video.textTracks).forEach((t) => {
        t.addEventListener('cuechange', handleCueChange)
      })
      video.textTracks.addEventListener('addtrack', handleAddTrack)
      const trackElements = Array.from(video.querySelectorAll('track'))
      const handleTrackLoad = () => updateCuePosition()
      trackElements.forEach((el) => el.addEventListener('load', handleTrackLoad))
      return () => {
        Array.from(video.textTracks).forEach((t) => {
          t.removeEventListener('cuechange', handleCueChange)
        })
        video.textTracks.removeEventListener('addtrack', handleAddTrack)
        trackElements.forEach((el) => el.removeEventListener('load', handleTrackLoad))
      }
    }
  }, [
    subtitleFontSize,
    subtitlePosition,
    subtitleBgOpacity,
    subtitleBgColor,
    subtitleTextColor,
    subtitleEdge,
    subtitleBold,
    selectedSubtitle,
    subtitles,
    videoRef,
  ])

  const handleUserActivity = useCallback(
    (e: MouseEvent | TouchEvent) => {
      const container = containerRef.current
      if (!container) return

      const interactionDelay = e.type === 'touchstart' ? 800 : 500
      if (Date.now() - lastInteractionTimeRef.current < interactionDelay) return

      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          setShowControls(true)
          container.style.cursor = 'default'

          if (inactivityTimer.current) clearTimeout(inactivityTimer.current)

          if (isPlaying && !settingsView && !isScrubbing) {
            inactivityTimer.current = window.setTimeout(() => {
              setShowControls(false)
              if (document.fullscreenElement) {
                container.style.cursor = 'none'
              }
            }, 3000)
          }
          rafIdRef.current = null
        })
      }
    },
    [isPlaying, settingsView, isScrubbing]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    container.addEventListener('mousemove', handleUserActivity)
    const handleTouch = (e: TouchEvent) => handleUserActivity(e)
    container.addEventListener('touchstart', handleTouch, { passive: true })

    const handleMouseLeave = () => {
      setShowControls(false)
    }
    container.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      container.removeEventListener('mousemove', handleUserActivity)
      container.removeEventListener('touchstart', handleTouch)
      container.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [handleUserActivity])

  useEffect(() => {
    if (isScrubbing || settingsView) {
      setShowControls(true)
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [isScrubbing, settingsView])

  useEffect(() => {
    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current)
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }

  const isOverUi = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    return !!(
      target.closest(`.${styles.controlsOverlay}`) || target.closest(`.${styles.settingsPanel}`)
    )
  }

  const handleContainerClick = (e: React.MouseEvent) => {
    if (isOverUi(e)) return

    const isHiding = showControls
    setShowControls(!showControls)
    if (isHiding) lastInteractionTimeRef.current = Date.now()

    clickCountRef.current += 1
    if (clickTimerRef.current) clearTimeout(clickTimerRef.current)

    if (clickCountRef.current === 2) {
      toggleFullscreen()
      clickCountRef.current = 0
      return
    }

    clickTimerRef.current = setTimeout(() => {
      clickCountRef.current = 0
    }, 250)
  }

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current
    if (!video || !progressBarRef.current || isNaN(duration) || duration === 0) return
    const rect = progressBarRef.current.getBoundingClientRect()
    const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    video.currentTime = percent * duration
  }

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || !duration) return
    const rect = progressBarRef.current.getBoundingClientRect()
    const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setHoverTime({ time: percent * duration, position: e.clientX - rect.left })
  }

  const handleThumbMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const video = videoRef.current
    if (!video) return
    setIsScrubbing(true)
    video.pause()
  }

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isScrubbing || !progressBarRef.current || !duration) return
      const rect = progressBarRef.current.getBoundingClientRect()
      const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const video = videoRef.current
      if (video) video.currentTime = percent * duration
      setHoverTime({ time: percent * duration, position: e.clientX - rect.left })
    }
    const handleMouseUp = () => {
      if (isScrubbing) {
        setIsScrubbing(false)
        setHoverTime({ time: 0, position: null })
        videoRef.current?.play().catch(() => {})
      }
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isScrubbing, duration, videoRef])

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    const newVolume = parseFloat(e.target.value)
    video.volume = newVolume
    video.muted = newVolume === 0
    localStorage.setItem('playerVolume', newVolume.toString())
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    localStorage.setItem('playerMuted', video.muted.toString())
  }

  const toggleFullscreen = () => {
    const container = containerRef.current
    if (!container) return
    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen().catch(() => {})
      setIsFullscreen(false)
    }
  }

  const formatTime = (time: number) => {
    if (!time || isNaN(time)) return '0:00'
    const h = Math.floor(time / 3600)
    const m = Math.floor((time % 3600) / 60)
    const s = Math.floor(time % 60)
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0
  const hasSubtitles = subtitles.length > 0
  const isSubtitleActive = selectedSubtitle >= 0

  const openSettings = () => {
    setSettingsView('main')
    setShowControls(true)
  }

  const toggleSubtitles = () => {
    if (isSubtitleActive) {
      onSubtitleChange(-1)
      return
    }
    let lastKey: string | null = null
    try {
      lastKey = localStorage.getItem('tvLastSubtitle')
    } catch {
      // ignore
    }
    onSubtitleChange(pickSubtitleIndex(subtitles, { lastKey, enabled: true }))
  }

  const closeSettings = () => {
    setSettingsView(null)
  }

  const renderMainSettings = () => (
    <>
      {streams.length > 1 && (
        <button className={styles.menuItem} onClick={() => setSettingsView('quality')}>
          <span>Quality</span>
          <span className={styles.currentValue}>{streams[qualityIdx]?.quality || 'Auto'}</span>
        </button>
      )}
      {isMovySource && movyServers.length > 0 && (
        <button className={styles.menuItem} onClick={() => setSettingsView('server')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FaServer size={12} /> Movy Server
          </span>
          <span className={styles.currentValue} style={{ textTransform: 'capitalize' }}>
            {selectedMovyServer}
          </span>
        </button>
      )}
      {hasSubtitles && (
        <button className={styles.menuItem} onClick={() => setSettingsView('subtitles')}>
          <span>Subtitles</span>
          <span className={styles.currentValue}>
            {isSubtitleActive
              ? subtitles[selectedSubtitle]?.label || subtitles[selectedSubtitle]?.language
              : 'Off'}
          </span>
        </button>
      )}
      {hasSubtitles && (
        <button className={styles.menuItem} onClick={() => setSettingsView('subtitle-style')}>
          <span>Subtitle Style</span>
          <span className={styles.currentValue}>
            {subtitleFontSize.toFixed(1)}x · {subtitlePosition}
          </span>
        </button>
      )}
      {audioTracks.length > 0 && (
        <button className={styles.menuItem} onClick={() => setSettingsView('audio')}>
          <span>Audio Track</span>
          <span className={styles.currentValue}>
            {audioTracks[selectedAudioTrack]?.label || audioTracks[selectedAudioTrack]?.language}
          </span>
        </button>
      )}
      <button className={styles.menuItem} onClick={() => setSettingsView('av-sync')}>
        <span>A/V Sync</span>
        <span className={styles.currentValue}>
          {videoDelayEnabled ? `${videoDelayMs}ms` : 'Off'}
        </span>
      </button>
    </>
  )

  const renderQualitySettings = () =>
    streams.map((s, i) => (
      <button
        key={i}
        className={`${styles.menuItem} ${i === qualityIdx ? styles.active : ''}`}
        onClick={() => onQualityChange(i)}
      >
        <span>{s.quality}</span>
        {i === qualityIdx && <FaCheck size={12} />}
      </button>
    ))

  const renderSubtitleSettings = () => (
    <>
      <button
        className={`${styles.menuItem} ${!isSubtitleActive ? styles.active : ''}`}
        onClick={() => onSubtitleChange(-1)}
      >
        <span>Off</span>
        {!isSubtitleActive && <FaCheck size={12} />}
      </button>
      {subtitles.map((track, i) => (
        <button
          key={i}
          className={`${styles.menuItem} ${i === selectedSubtitle ? styles.active : ''}`}
          onClick={() => onSubtitleChange(i)}
        >
          <span>{track.label || track.language}</span>
          {i === selectedSubtitle && <FaCheck size={12} />}
        </button>
      ))}
    </>
  )

  const renderSubtitleStyleSettings = () => (
    <>
      <MenuSlider
        label="Font Size"
        display={subtitleFontSize.toFixed(1)}
        min={0.5}
        max={10}
        step={0.5}
        value={subtitleFontSize}
        percent={((subtitleFontSize - 0.5) / 9.5) * 100}
        onChange={(v) => {
          if (Number.isFinite(v)) {
            setSubtitleFontSize(v)
            persistSubtitleSetting('subtitleFontSize', v)
          }
        }}
      />
      <MenuSlider
        label="Vertical Position"
        display={`${subtitlePosition}`}
        min={0}
        max={100}
        step={1}
        value={subtitlePosition}
        percent={subtitlePosition}
        onChange={(v) => {
          if (Number.isFinite(v)) {
            const rounded = Math.round(v)
            setSubtitlePosition(rounded)
            persistSubtitleSetting('subtitlePosition', rounded)
          }
        }}
      />
      <MenuSlider
        label="Background Opacity"
        display={`${Math.round(subtitleBgOpacity * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        value={subtitleBgOpacity}
        percent={subtitleBgOpacity * 100}
        onChange={(v) => {
          if (Number.isFinite(v)) {
            setSubtitleBgOpacity(v)
            persistSubtitleSetting('subtitleBgOpacity', v)
          }
        }}
      />
      <SwatchRow
        label="Text Color"
        colors={TEXT_COLOR_PRESETS}
        value={subtitleTextColor}
        onChange={(c) => {
          setSubtitleTextColor(c)
          persistSubtitleSetting('subtitleTextColor', c)
        }}
      />
      <SwatchRow
        label="Background Color"
        colors={BG_COLOR_PRESETS}
        value={subtitleBgColor}
        onChange={(c) => {
          setSubtitleBgColor(c)
          persistSubtitleSetting('subtitleBgColor', c)
        }}
      />
      <SegmentedRow
        label="Text Edge"
        options={['shadow', 'outline', 'none'] as const}
        value={subtitleEdge}
        onChange={(edge) => {
          setSubtitleEdge(edge)
          persistSubtitleSetting('subtitleEdge', edge)
        }}
      />
      <button
        className={`${styles.menuItem} ${subtitleBold ? styles.active : ''}`}
        onClick={() => {
          setSubtitleBold(!subtitleBold)
          persistSubtitleSetting('subtitleBold', !subtitleBold)
        }}
      >
        <span>Bold Text</span>
        {subtitleBold && <FaCheck size={12} />}
      </button>
      <button
        className={styles.menuItem}
        onClick={() => {
          setSubtitleFontSize(DEFAULT_SUBTITLE_STYLE.fontSize)
          persistSubtitleSetting('subtitleFontSize', DEFAULT_SUBTITLE_STYLE.fontSize)
          setSubtitlePosition(DEFAULT_SUBTITLE_STYLE.position)
          persistSubtitleSetting('subtitlePosition', DEFAULT_SUBTITLE_STYLE.position)
          setSubtitleBgOpacity(DEFAULT_SUBTITLE_STYLE.bgOpacity)
          persistSubtitleSetting('subtitleBgOpacity', DEFAULT_SUBTITLE_STYLE.bgOpacity)
          setSubtitleBgColor(DEFAULT_SUBTITLE_STYLE.bgColor)
          persistSubtitleSetting('subtitleBgColor', DEFAULT_SUBTITLE_STYLE.bgColor)
          setSubtitleTextColor(DEFAULT_SUBTITLE_STYLE.textColor)
          persistSubtitleSetting('subtitleTextColor', DEFAULT_SUBTITLE_STYLE.textColor)
          setSubtitleEdge(DEFAULT_SUBTITLE_STYLE.edge)
          persistSubtitleSetting('subtitleEdge', DEFAULT_SUBTITLE_STYLE.edge)
          setSubtitleBold(DEFAULT_SUBTITLE_STYLE.bold)
          persistSubtitleSetting('subtitleBold', DEFAULT_SUBTITLE_STYLE.bold)
        }}
      >
        <span>Reset to Defaults</span>
      </button>
    </>
  )

  const renderAudioSettings = () =>
    audioTracks.map((track, i) => (
      <button
        key={i}
        className={`${styles.menuItem} ${i === selectedAudioTrack ? styles.active : ''}`}
        onClick={() => onAudioTrackChange(i)}
      >
        <span>{track.label || track.language}</span>
        {i === selectedAudioTrack && <FaCheck size={12} />}
      </button>
    ))

  const renderServerSettings = () => (
    <>
      {movyServers.map((city) => (
        <button
          key={city}
          className={`${styles.menuItem} ${selectedMovyServer === city ? styles.active : ''}`}
          onClick={() => onMovyServerSelect?.(city)}
        >
          <span style={{ textTransform: 'capitalize' }}>{city}</span>
          {selectedMovyServer === city && <FaCheck size={12} />}
        </button>
      ))}
    </>
  )

  const renderAvSyncSettings = () => (
    <>
      <button
        className={`${styles.menuItem} ${videoDelayEnabled ? styles.active : ''}`}
        onClick={() => onVideoDelayToggle?.(!videoDelayEnabled)}
      >
        <span>Video delay</span>
        {videoDelayEnabled && <FaCheck size={12} />}
      </button>
      <MenuSlider
        label="Video delay"
        display={`${shownDelayMs}ms`}
        min={0}
        max={500}
        step={5}
        value={shownDelayMs}
        percent={(shownDelayMs / 500) * 100}
        onChange={(v) => setPendingDelayMs(Math.round(v))}
        onCommit={commitDelay}
      />
      <div className={styles.menuNote}>
        For Bluetooth headsets where audio arrives late. Video is held back via canvas; audio plays
        untouched.
      </div>
      <button className={styles.menuItem} onClick={() => onCalibrateAvSync?.()}>
        <span>Calibrate…</span>
      </button>
    </>
  )

  return (
    <div ref={containerRef} className={styles.container} onClick={handleContainerClick}>
      {children}
      <div
        ref={controlsRef}
        className={`${styles.controlsOverlay} ${!showControls && !settingsView ? styles.hidden : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.topControls}>
          <button className={styles.backBtn} onClick={onBack} title="Back" aria-label="Back">
            <FaChevronLeft />
          </button>
          <div className={styles.videoTitleInfo}>
            <span className={styles.animeTitle}>{title}</span>
          </div>
        </div>

        <div className={styles.centerControls}>
          <button
            className={styles.centerSkipBtn}
            onClick={() => {
              const v = videoRef.current
              if (v) v.currentTime = Math.max(0, v.currentTime - 10)
            }}
            title="Skip back 10s"
          >
            <MdReplay10 />
          </button>
          <button
            className={styles.centerPlayPause}
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <FaPause /> : <FaPlay className={styles.playIconOffset} />}
          </button>
          <button
            className={styles.centerSkipBtn}
            onClick={() => {
              const v = videoRef.current
              if (v) v.currentTime = Math.min(duration, v.currentTime + 10)
            }}
            title="Skip forward 10s"
          >
            <MdForward10 />
          </button>
        </div>

        <div className={styles.bottomControls}>
          <div
            className={`${styles.progressBarContainer} ${isScrubbing ? styles.scrubbing : ''}`}
            ref={progressBarRef}
            onClick={handleProgressClick}
            onMouseMove={handleProgressMouseMove}
            onMouseLeave={() => {
              if (!isScrubbing) setHoverTime({ time: 0, position: null })
            }}
          >
            {hoverTime.position !== null && (
              <div className={styles.timeBubble} style={{ left: hoverTime.position }}>
                {formatTime(hoverTime.time)}
              </div>
            )}
            <div className={styles.progressBar}>
              <div className={styles.bufferedBar} style={{ width: '100%' }} />
              <div className={styles.watchedBar} style={{ width: `${progressPercent}%` }} />
              <div
                className={styles.thumb}
                style={{ left: `${progressPercent}%` }}
                onMouseDown={handleThumbMouseDown}
              />
            </div>
          </div>

          <div className={styles.bottomControlsRow}>
            <div className={styles.leftControls}>
              <button
                className={styles.controlBtn}
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <FaPause /> : <FaPlay />}
              </button>
              <div className={styles.volumeContainer}>
                <button
                  className={styles.controlBtn}
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <FaVolumeMute /> : volume < 0.5 ? <FaVolumeDown /> : <FaVolumeUp />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className={styles.volumeSlider}
                  style={
                    {
                      '--volume-percent': `${(isMuted ? 0 : volume) * 100}%`,
                    } as React.CSSProperties
                  }
                />
              </div>
              <span className={styles.timeDisplay}>
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className={styles.rightControls}>
              {hasSubtitles && (
                <button
                  className={`${styles.controlBtn} ${isSubtitleActive ? styles.active : ''}`}
                  onClick={toggleSubtitles}
                  aria-label={isSubtitleActive ? 'Turn subtitles off' : 'Turn subtitles on'}
                >
                  <FaClosedCaptioning />
                </button>
              )}
              <button
                className={`${styles.controlBtn} ${settingsView ? styles.active : ''}`}
                onClick={() => (settingsView ? closeSettings() : openSettings())}
                aria-label="Settings"
              >
                <FaCog />
              </button>
              <button
                className={styles.controlBtn}
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <FaCompress /> : <FaExpand />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {settingsView && (
        <div className={styles.settingsPanel}>
          <div className={styles.settingsHeader}>
            <button
              className={styles.settingsBackBtn}
              onClick={() => (settingsView === 'main' ? closeSettings() : setSettingsView('main'))}
            >
              <FaChevronLeft />
            </button>
            <span className={styles.settingsTitle}>
              {settingsView === 'main'
                ? 'Settings'
                : settingsView === 'subtitle-style'
                  ? 'Subtitle Style'
                  : settingsView === 'audio'
                    ? 'Audio Track'
                    : settingsView === 'server'
                      ? 'Movy Server'
                      : settingsView === 'av-sync'
                        ? 'A/V Sync'
                        : settingsView.charAt(0).toUpperCase() + settingsView.slice(1)}
            </span>
          </div>
          <div className={styles.settingsContent}>
            {settingsView === 'main' && renderMainSettings()}
            {settingsView === 'quality' && renderQualitySettings()}
            {settingsView === 'subtitles' && renderSubtitleSettings()}
            {settingsView === 'subtitle-style' && renderSubtitleStyleSettings()}
            {settingsView === 'audio' && renderAudioSettings()}
            {settingsView === 'server' && renderServerSettings()}
            {settingsView === 'av-sync' && renderAvSyncSettings()}
          </div>
        </div>
      )}
    </div>
  )
}

export default TvPlayerControls

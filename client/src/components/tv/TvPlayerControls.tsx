import React, { useState, useEffect, useRef, useCallback } from 'react'
import Icon from '../common/Icon'
import styles from './TvPlayerControls.module.css'
import CenterControls from '../player/CenterControls'
import { formatTime } from '../../lib/utils'
import { pickSubtitleIndex } from '../../lib/subtitles'
import SeekBar from '../player/SeekBar'
import VolumeControl from '../player/VolumeControl'
import SettingsShell from '../player/SettingsShell'
import SubtitleStyleMenu, { type SubtitleStyleKey } from '../player/SubtitleStyleMenu'
import AvSyncMenu from '../player/AvSyncMenu'
import AudioTrackMenu from '../player/AudioTrackMenu'
import OptionListMenu from '../player/OptionListMenu'
import {
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
  const [isScrubbing, setIsScrubbing] = useState(false)
  const timeLabelRef = useRef<HTMLSpanElement>(null)
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
  const handleSubtitleStyleChange = (key: SubtitleStyleKey, value: number | string | boolean) => {
    switch (key) {
      case 'fontSize':
        if (typeof value === 'number') {
          setSubtitleFontSize(value)
          persistSubtitleSetting('subtitleFontSize', value)
        }
        break
      case 'position':
        if (typeof value === 'number') {
          setSubtitlePosition(value)
          persistSubtitleSetting('subtitlePosition', value)
        }
        break
      case 'bgOpacity':
        if (typeof value === 'number') {
          setSubtitleBgOpacity(value)
          persistSubtitleSetting('subtitleBgOpacity', value)
        }
        break
      case 'bgColor':
        if (typeof value === 'string') {
          setSubtitleBgColor(value)
          persistSubtitleSetting('subtitleBgColor', value)
        }
        break
      case 'textColor':
        if (typeof value === 'string') {
          setSubtitleTextColor(value)
          persistSubtitleSetting('subtitleTextColor', value)
        }
        break
      case 'edge':
        if (value === 'shadow' || value === 'outline' || value === 'none') {
          setSubtitleEdge(value)
          persistSubtitleSetting('subtitleEdge', value)
        }
        break
      case 'bold':
        if (typeof value === 'boolean') {
          setSubtitleBold(value)
          persistSubtitleSetting('subtitleBold', value)
        }
        break
    }
  }
  const inactivityTimer = useRef<number | null>(null)
  const lastInteractionTimeRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)
  const clickCountRef = useRef(0)
  const clickTimerRef = useRef<number | null>(null)
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

  const handleSeek = (percent: number) => {
    const video = videoRef.current
    if (!video || isNaN(duration) || duration === 0) return
    video.currentTime = percent * duration
  }

  const handleScrubStart = () => {
    setIsScrubbing(true)
    videoRef.current?.pause()
  }

  const handleScrubMove = (percent: number) => {
    const video = videoRef.current
    if (video && duration) video.currentTime = percent * duration
  }

  const handleScrubEnd = () => {
    setIsScrubbing(false)
    videoRef.current?.play().catch(() => {})
  }

  const handleVolumeChange = (newVolume: number) => {
    const video = videoRef.current
    if (!video) return
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
            <Icon name="server" size={12} /> Movy Server
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

  const renderQualitySettings = () => (
    <OptionListMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      options={streams.map((s, i) => ({
        key: String(i),
        label: s.quality,
        selected: i === qualityIdx,
      }))}
      onSelect={(key) => onQualityChange(Number(key))}
    />
  )

  const renderSubtitleSettings = () => (
    <OptionListMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      options={[
        { key: 'off', label: 'Off', selected: !isSubtitleActive },
        ...subtitles.map((track, i) => ({
          key: String(i),
          label: track.label || track.language,
          selected: i === selectedSubtitle,
        })),
      ]}
      onSelect={(key) => onSubtitleChange(key === 'off' ? -1 : Number(key))}
    />
  )

  const renderSubtitleStyleSettings = () => (
    <SubtitleStyleMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      values={{
        fontSize: subtitleFontSize,
        position: subtitlePosition,
        bgOpacity: subtitleBgOpacity,
        bgColor: subtitleBgColor,
        textColor: subtitleTextColor,
        edge: subtitleEdge,
        bold: subtitleBold,
      }}
      onChange={handleSubtitleStyleChange}
    />
  )

  const renderAudioSettings = () => (
    <AudioTrackMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      tracks={audioTracks}
      selected={selectedAudioTrack}
      onChange={onAudioTrackChange}
    />
  )

  const renderServerSettings = () => (
    <OptionListMenu
      classes={{ item: styles.menuItem, active: styles.active }}
      options={movyServers.map((city) => ({
        key: city,
        label: <span style={{ textTransform: 'capitalize' }}>{city}</span>,
        selected: selectedMovyServer === city,
      }))}
      onSelect={(city) => onMovyServerSelect?.(city)}
    />
  )

  const renderAvSyncSettings = () => (
    <AvSyncMenu
      classes={{ item: styles.menuItem, active: styles.active, note: styles.menuNote }}
      enabled={videoDelayEnabled}
      delayMs={videoDelayMs}
      onToggle={(v) => onVideoDelayToggle?.(v)}
      onDelayChange={(ms) => onVideoDelayChange?.(ms)}
      onCalibrate={onCalibrateAvSync}
    />
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
            <Icon name="chevron-left" />
          </button>
          <div className={styles.videoTitleInfo}>
            <span className={styles.animeTitle}>{title}</span>
          </div>
        </div>

        <CenterControls
          isPlaying={isPlaying}
          onTogglePlay={togglePlay}
          onSkipBack={() => {
            const v = videoRef.current
            if (v) v.currentTime = Math.max(0, v.currentTime - 10)
          }}
          onSkipForward={() => {
            const v = videoRef.current
            if (v) v.currentTime = Math.min(duration, v.currentTime + 10)
          }}
        />

        <div className={styles.bottomControls}>
          <SeekBar
            classes={{
              container: styles.progressBarContainer,
              scrubbing: styles.scrubbing,
              timeBubble: styles.timeBubble,
              bar: styles.progressBar,
              buffered: styles.bufferedBar,
              watched: styles.watchedBar,
              thumb: styles.thumb,
            }}
            videoRef={videoRef}
            duration={duration}
            formatTime={formatTime}
            isScrubbing={isScrubbing}
            buffered="full"
            onSeek={handleSeek}
            onScrubStart={handleScrubStart}
            onScrubMove={handleScrubMove}
            onScrubEnd={handleScrubEnd}
            timeLabelRef={timeLabelRef}
          />

          <div className={styles.bottomControlsRow}>
            <div className={styles.leftControls}>
              <button
                className={styles.controlBtn}
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Icon name="pause" /> : <Icon name="play" />}
              </button>
              <VolumeControl
                classes={{
                  container: styles.volumeContainer,
                  button: styles.controlBtn,
                  slider: styles.volumeSlider,
                }}
                muted={isMuted}
                volume={volume}
                volumeIcon={
                  isMuted ? (
                    <Icon name="volume-mute" />
                  ) : volume < 0.5 ? (
                    <Icon name="volume-down" />
                  ) : (
                    <Icon name="volume-up" />
                  )
                }
                onToggleMute={toggleMute}
                onVolumeChange={handleVolumeChange}
              />
              <span className={styles.timeDisplay} ref={timeLabelRef}>
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
                  <Icon name="closed-captioning" />
                </button>
              )}
              <button
                className={`${styles.controlBtn} ${settingsView ? styles.active : ''}`}
                onClick={() => (settingsView ? closeSettings() : openSettings())}
                aria-label="Settings"
              >
                <Icon name="cog" />
              </button>
              <button
                className={styles.controlBtn}
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              >
                {isFullscreen ? <Icon name="compress" /> : <Icon name="expand" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {settingsView && (
        <SettingsShell
          classes={{
            panel: styles.settingsPanel,
            header: styles.settingsHeader,
            backBtn: styles.settingsBackBtn,
            title: styles.settingsTitle,
            content: styles.settingsContent,
          }}
          title={
            settingsView === 'main'
              ? 'Settings'
              : settingsView === 'subtitle-style'
                ? 'Subtitle Style'
                : settingsView === 'audio'
                  ? 'Audio Track'
                  : settingsView === 'server'
                    ? 'Movy Server'
                    : settingsView === 'av-sync'
                      ? 'A/V Sync'
                      : settingsView.charAt(0).toUpperCase() + settingsView.slice(1)
          }
          onBack={() => (settingsView === 'main' ? closeSettings() : setSettingsView('main'))}
        >
          {settingsView === 'main' && renderMainSettings()}
          {settingsView === 'quality' && renderQualitySettings()}
          {settingsView === 'subtitles' && renderSubtitleSettings()}
          {settingsView === 'subtitle-style' && renderSubtitleStyleSettings()}
          {settingsView === 'audio' && renderAudioSettings()}
          {settingsView === 'server' && renderServerSettings()}
          {settingsView === 'av-sync' && renderAvSyncSettings()}
        </SettingsShell>
      )}
    </div>
  )
}

export default TvPlayerControls

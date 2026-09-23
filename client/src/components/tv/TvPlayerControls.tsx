import React, { useState, useEffect, useRef } from 'react'
import Icon from '../common/Icon'
import styles from './TvPlayerControls.module.css'
import CenterControls from '../player/CenterControls'
import UnifiedVideoShell from '../player/UnifiedVideoShell'
import UnifiedVolumeControl from '../player/UnifiedVolumeControl'
import { formatTime } from '../../lib/utils'
import { pickSubtitleIndex } from '../../lib/subtitles'
import SeekBar from '../player/SeekBar'
import SettingsShell from '../player/SettingsShell'
import SubtitleStyleMenu, { type SubtitleStyleKey } from '../player/SubtitleStyleMenu'
import AvSyncMenu from '../player/AvSyncMenu'
import AudioTrackMenu from '../player/AudioTrackMenu'
import OptionListMenu from '../player/OptionListMenu'
import type useVideoPlayer from '../../hooks/useVideoPlayer'
import { buildCueCss, fitSubtitleSize, type SubtitleStyleSettings } from '../../lib/subtitleStyle'

type SettingsView =
  'main' | 'quality' | 'subtitles' | 'subtitle-style' | 'audio' | 'server' | 'av-sync' | null

interface TvPlayerControlsProps {
  player: ReturnType<typeof useVideoPlayer>
  title: string
  episodeLabel?: string
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
  player,
  title,
  episodeLabel,
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
  const { state, refs, actions } = player
  const videoRef = refs.videoRef
  const {
    subtitleFontSize,
    subtitlePosition,
    subtitleBgOpacity,
    subtitleBgColor,
    subtitleTextColor,
    subtitleEdge,
    subtitleBold,
  } = state
  const [settingsView, setSettingsView] = useState<SettingsView>(null)
  const timeLabelRef = useRef<HTMLSpanElement>(null)
  const [videoBoxH, setVideoBoxH] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const update = () => setVideoBoxH(video.clientHeight || 0)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(video)
    return () => observer.disconnect()
  }, [videoRef, streams])
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
          actions.setSubtitleFontSize(value)
          persistSubtitleSetting('subtitleFontSize', value)
        }
        break
      case 'position':
        if (typeof value === 'number') {
          actions.setSubtitlePosition(value)
          persistSubtitleSetting('subtitlePosition', value)
        }
        break
      case 'bgOpacity':
        if (typeof value === 'number') {
          actions.setSubtitleBgOpacity(value)
          persistSubtitleSetting('subtitleBgOpacity', value)
        }
        break
      case 'bgColor':
        if (typeof value === 'string') {
          actions.setSubtitleBgColor(value)
          persistSubtitleSetting('subtitleBgColor', value)
        }
        break
      case 'textColor':
        if (typeof value === 'string') {
          actions.setSubtitleTextColor(value)
          persistSubtitleSetting('subtitleTextColor', value)
        }
        break
      case 'edge':
        if (value === 'shadow' || value === 'outline' || value === 'none') {
          actions.setSubtitleEdge(value)
          persistSubtitleSetting('subtitleEdge', value)
        }
        break
      case 'bold':
        if (typeof value === 'boolean') {
          actions.setSubtitleBold(value)
          persistSubtitleSetting('subtitleBold', value)
        }
        break
    }
  }

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
    const video = videoRef.current
    const fittedSize = fitSubtitleSize(subtitleFontSize, videoBoxH || video?.clientHeight || 720)
    styleTag.textContent = buildCueCss({ ...subtitleStyle, fontSize: fittedSize })

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
        const px = fittedSize * 16
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
    videoBoxH,
  ])

  const handleSeek = (percent: number) => {
    const video = videoRef.current
    if (!video || isNaN(state.duration) || state.duration === 0) return
    video.currentTime = percent * state.duration
  }

  const handleScrubStart = () => {
    if (!videoRef.current) return
    actions.setIsScrubbing(true)
    actions.wasPlayingBeforeScrub.current = !videoRef.current.paused
    videoRef.current.pause()
  }

  const handleScrubMove = (percent: number) => {
    const video = videoRef.current
    if (video && state.duration) video.currentTime = percent * state.duration
  }

  const handleScrubEnd = () => {
    actions.setIsScrubbing(false)
    if (actions.wasPlayingBeforeScrub.current) {
      videoRef.current?.play().catch(() => {})
    }
  }

  const handleVolumeChange = (newVolume: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = newVolume
    video.muted = newVolume === 0
    localStorage.setItem('playerVolume', newVolume.toString())
  }

  const toggleMute = () => {
    actions.toggleMute()
  }

  const hasSubtitles = subtitles.length > 0
  const isSubtitleActive = selectedSubtitle >= 0

  const openSettings = () => {
    setSettingsView('main')
    actions.setShowControls(true)
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
      onCalibrate={() => {
        setSettingsView(null)
        onCalibrateAvSync?.()
      }}
    />
  )

  const volumeIcon = state.isMuted ? (
    <Icon name="volume-mute" />
  ) : state.volume < 0.5 ? (
    <Icon name="volume-down" />
  ) : (
    <Icon name="volume-up" />
  )

  const topBar = (
    <div
      className={`${styles.controlsOverlay} ${!state.showControls && !settingsView ? styles.hidden : ''}`}
      data-speed-boost-ignore="true"
      style={{ pointerEvents: 'none', background: 'none' }}
    >
      <div className={styles.topControls} onClick={(e) => e.stopPropagation()}>
        <button className={styles.backBtn} onClick={onBack} title="Back" aria-label="Back">
          <Icon name="chevron-left" />
        </button>
        <div className={styles.videoTitleInfo}>
          <span className={styles.animeTitle}>{title}</span>
          {episodeLabel && <span className={styles.episodeLabel}>{episodeLabel}</span>}
        </div>
      </div>
    </div>
  )

  const center = (
    <CenterControls
      isPlaying={state.isPlaying}
      onTogglePlay={actions.togglePlay}
      onSkipBack={() => actions.seek(-10)}
      onSkipForward={() => actions.seek(10)}
    />
  )

  const bottomBar = (
    <div
      className={`${styles.controlsOverlay} ${!state.showControls && !settingsView ? styles.hidden : ''}`}
      data-speed-boost-ignore="true"
      style={{ pointerEvents: 'none', background: 'none', justifyContent: 'flex-end' }}
    >
      <div className={styles.bottomControls} onClick={(e) => e.stopPropagation()}>
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
          duration={state.duration}
          formatTime={formatTime}
          isScrubbing={state.isScrubbing}
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
              onClick={actions.togglePlay}
              aria-label={state.isPlaying ? 'Pause' : 'Play'}
            >
              {state.isPlaying ? <Icon name="pause" /> : <Icon name="play" />}
            </button>
            <UnifiedVolumeControl
              muted={state.isMuted}
              volume={state.volume}
              volumeIcon={volumeIcon}
              buttonClassName={styles.controlBtn}
              onToggleMute={toggleMute}
              onVolumeChange={handleVolumeChange}
              onExpandedChange={(v) => actions.setShowVolumeSlider(v)}
            />
            <span className={styles.timeDisplay} ref={timeLabelRef}>
              {formatTime(0)} / {formatTime(state.duration)}
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
              onClick={actions.toggleFullscreen}
              aria-label={state.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {state.isFullscreen ? <Icon name="compress" /> : <Icon name="expand" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )

  const settingsNode = settingsView ? (
    <div data-speed-boost-ignore="true" onClick={(e) => e.stopPropagation()}>
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
    </div>
  ) : null

  const overlays = state.isSpeedBoostActive ? (
    <div className={styles.speedBoostBadge} aria-hidden="true">
      <span>2x</span>
      <Icon name="forward" size={12} />
    </div>
  ) : null

  return (
    <UnifiedVideoShell
      player={player}
      topBar={topBar}
      centerControls={center}
      bottomBar={bottomBar}
      settingsPanel={settingsNode}
      overlays={overlays}
      isInteracting={!!settingsView}
      className={state.isFullscreen ? styles.fullscreenFlat : ''}
    >
      {children}
    </UnifiedVideoShell>
  )
}

export default TvPlayerControls

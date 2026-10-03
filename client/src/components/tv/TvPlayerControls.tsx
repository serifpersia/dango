import React, { useState, useEffect, useRef } from 'react'
import Icon from '../common/Icon'
import styles from './TvPlayerControls.module.css'
import CenterControls from '../player/CenterControls'
import ControlTopBar from '../player/ControlTopBar'
import TvBottomBar from './TvBottomBar'
import TvSettings, { type TvSettingsView } from './TvSettings'
import UnifiedVideoShell from '../player/UnifiedVideoShell'
import { type SubtitleStyleKey } from '../player/SubtitleStyleMenu'
import type { AmbientLightSettings } from '../../hooks/useAmbientLight'
import type useVideoPlayer from '../../hooks/useVideoPlayer'
import { buildCueCss, fitSubtitleSize, type SubtitleStyleSettings } from '../../lib/subtitleStyle'

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
  subtitleDelayMs?: number
  onSubtitleDelayChange?: (ms: number) => void
  showNextEpisodeButton?: boolean
  onNextEpisode?: () => void
  isLoading?: boolean
  isTheaterMode: boolean
  onTheaterModeToggle: () => void
  ambientSettings?: AmbientLightSettings
  onAmbientChange?: (patch: Partial<AmbientLightSettings>) => void
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
  subtitleDelayMs = 0,
  onSubtitleDelayChange,
  showNextEpisodeButton = false,
  onNextEpisode,
  isLoading = false,
  isTheaterMode,
  onTheaterModeToggle,
  ambientSettings,
  onAmbientChange,
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
  const [settingsView, setSettingsView] = useState<TvSettingsView>(null)
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

  const hasSubtitles = subtitles.length > 0
  const isSubtitleActive = selectedSubtitle >= 0

  const openSettings = () => {
    setSettingsView('main')
    actions.setShowControls(true)
  }

  const closeSettings = () => {
    setSettingsView(null)
  }

  const controlsVisible = state.showControls || !!settingsView

  const topBar = (
    <ControlTopBar
      visible={controlsVisible}
      title={title}
      episode={episodeLabel}
      onBack={onBack}
      classes={{
        overlay: styles.controlsOverlay,
        hidden: styles.hidden,
        top: styles.topControls,
        backBtn: styles.backBtn,
        titleInfo: styles.videoTitleInfo,
        title: styles.animeTitle,
        episode: styles.episodeLabel,
      }}
    />
  )

  const center =
    !isLoading && !state.isBuffering && state.duration > 0 ? (
      <CenterControls
        isPlaying={state.isPlaying}
        onTogglePlay={actions.togglePlay}
        onSkipBack={() => actions.seek(-10)}
        onSkipForward={() => actions.seek(10)}
      />
    ) : null

  const bottomBar = (
    <TvBottomBar
      player={player}
      visible={controlsVisible}
      settingsOpen={!!settingsView}
      onOpenSettings={openSettings}
      onCloseSettings={closeSettings}
      hasSubtitles={hasSubtitles}
      isSubtitleActive={isSubtitleActive}
      subtitles={subtitles}
      onSubtitleChange={onSubtitleChange}
      showNextEpisodeButton={showNextEpisodeButton}
      onNextEpisode={onNextEpisode}
      isTheaterMode={isTheaterMode}
      onTheaterModeToggle={onTheaterModeToggle}
      timeLabelRef={timeLabelRef}
    />
  )

  const settingsNode = settingsView ? (
    <TvSettings
      view={settingsView}
      onSelectView={setSettingsView}
      onClose={closeSettings}
      player={player}
      onSubtitleStyleChange={handleSubtitleStyleChange}
      streams={streams}
      qualityIdx={qualityIdx}
      onQualityChange={onQualityChange}
      isMovySource={isMovySource}
      movyServers={movyServers}
      selectedMovyServer={selectedMovyServer}
      onMovyServerSelect={onMovyServerSelect}
      hasSubtitles={hasSubtitles}
      subtitles={subtitles}
      selectedSubtitle={selectedSubtitle}
      isSubtitleActive={isSubtitleActive}
      onSubtitleChange={onSubtitleChange}
      audioTracks={audioTracks}
      selectedAudioTrack={selectedAudioTrack}
      onAudioTrackChange={onAudioTrackChange}
      videoDelayEnabled={videoDelayEnabled}
      onVideoDelayToggle={onVideoDelayToggle}
      videoDelayMs={videoDelayMs}
      onVideoDelayChange={onVideoDelayChange}
      onCalibrate={() => {
        setSettingsView(null)
        onCalibrateAvSync?.()
      }}
      subtitleDelayMs={subtitleDelayMs}
      onSubtitleDelayChange={onSubtitleDelayChange}
      ambientSettings={ambientSettings}
      onAmbientChange={onAmbientChange}
    />
  ) : null

  const overlays = (
    <>
      {isLoading && (
        <div className={styles.loadingOverlay} aria-hidden="true">
          <div className={styles.loadingDots}>
            <div className={styles.dot}></div>
            <div className={styles.dot}></div>
            <div className={styles.dot}></div>
          </div>
        </div>
      )}
      {state.isBuffering && !isLoading && (
        <div className={styles.bufferingOverlay} aria-hidden="true">
          <div className={styles.bufferingSpinner}></div>
        </div>
      )}
      {state.isSpeedBoostActive && (
        <div className={styles.speedBoostBadge} aria-hidden="true">
          <span>2x</span>
          <Icon name="forward" size={12} />
        </div>
      )}
    </>
  )

  return (
    <UnifiedVideoShell
      player={player}
      topBar={topBar}
      centerControls={center}
      bottomBar={!isLoading && state.duration > 0 ? bottomBar : null}
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

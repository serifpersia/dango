import React, { useEffect, Suspense, lazy } from 'react'
import CenterControls from './CenterControls'
import ControlTopBar from './ControlTopBar'
import PlayerBottomBar from './PlayerBottomBar'
import UnifiedVideoShell from './UnifiedVideoShell'
import styles from './PlayerControls.module.css'
import type { VideoSource, VideoLink, SkipInterval } from '../../types/player'
import type useVideoPlayer from '../../hooks/useVideoPlayer'
import type { Anime4KProfile } from '../../hooks/useAnime4K'
import { useControlHandlers } from '../../hooks/useControlHandlers'
import type { FallbackChoice } from '../../lib/fallbackChoice'
import type { AmbientLightSettings } from '../../hooks/useAmbientLight'

const PlayerSettings = lazy(() => import('./PlayerSettings'))

interface PlayerControlsProps {
  player: ReturnType<typeof useVideoPlayer>
  isAutoplayEnabled: boolean
  onAutoplayChange: (checked: boolean) => void
  showNextEpisodeButton: boolean
  onNextEpisode: () => void
  videoSources: VideoSource[]
  selectedSource: VideoSource | null
  selectedLink: VideoLink | null
  onSourceChange: (source: VideoSource, link: VideoLink) => void
  loadingVideo: boolean
  skipIntervals: SkipInterval[]
  animeTitle: string
  episodeNumber: string | undefined
  isTheaterMode: boolean
  onTheaterModeToggle: () => void
  anime4kEnabled: boolean
  onAnime4kToggle: (value: boolean) => void
  anime4kSupported: boolean
  anime4kProfile: Anime4KProfile
  onAnime4kProfileChange: (profile: Anime4KProfile) => void
  anime4kInitializing: boolean
  anime4kError: string | null
  videoDelayEnabled: boolean
  onVideoDelayToggle: (value: boolean) => void
  videoDelayMs: number
  onVideoDelayChange: (ms: number) => void
  onCalibrateAvSync: () => void
  fallbackChoice: FallbackChoice
  onFallbackChoiceChange: (value: FallbackChoice) => void
  ambientSettings: AmbientLightSettings
  onAmbientChange: (patch: Partial<AmbientLightSettings>) => void
  children?: React.ReactNode
  overlays?: React.ReactNode
  isInteractingExtra?: boolean
  className?: string
  hideChrome?: boolean
}

const PlayerControls: React.FC<PlayerControlsProps> = ({
  player,
  isAutoplayEnabled,
  onAutoplayChange,
  showNextEpisodeButton,
  onNextEpisode,
  videoSources,
  selectedSource,
  selectedLink,
  onSourceChange,
  loadingVideo,
  skipIntervals,
  animeTitle,
  episodeNumber,
  isTheaterMode,
  onTheaterModeToggle,
  anime4kEnabled,
  onAnime4kToggle,
  anime4kSupported,
  anime4kProfile,
  onAnime4kProfileChange,
  anime4kInitializing,
  anime4kError,
  videoDelayEnabled,
  onVideoDelayToggle,
  videoDelayMs,
  onVideoDelayChange,
  onCalibrateAvSync,
  fallbackChoice,
  onFallbackChoiceChange,
  ambientSettings,
  onAmbientChange,
  children,
  overlays,
  isInteractingExtra = false,
  className,
  hideChrome = false,
}) => {
  const { state, actions } = player
  const { showSettings } = state
  const { setShowSettings } = actions
  const handlers = useControlHandlers(player)

  const settingsRef = React.useRef<HTMLDivElement>(null)
  const settingsBtnRef = React.useRef<HTMLButtonElement>(null)
  const timeDisplayRef = React.useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(event.target as Node) &&
        settingsBtnRef.current &&
        !settingsBtnRef.current.contains(event.target as Node) &&
        showSettings
      ) {
        setShowSettings(false)
      }
    }

    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSettings, setShowSettings])

  const controlsVisible = state.showControls || showSettings || state.isScrubbing

  const topBar = (
    <ControlTopBar
      visible={controlsVisible}
      title={animeTitle}
      episode={episodeNumber ? `Episode ${episodeNumber}` : undefined}
      onBack={() => window.history.back()}
      classes={{
        overlay: styles.controlsOverlay,
        hidden: styles.hidden,
        top: styles.topControls,
        backBtn: styles.backBtn,
        titleInfo: styles.videoTitleInfo,
        title: styles.animeTitle,
        episode: styles.episodeNumber,
      }}
    />
  )

  const center =
    !loadingVideo && !state.isBuffering && state.duration > 0 ? (
      <CenterControls
        isPlaying={state.isPlaying}
        onTogglePlay={actions.togglePlay}
        onSkipBack={() => actions.seek(-10)}
        onSkipForward={() => actions.seek(10)}
      />
    ) : null

  const bottomBar = (
    <PlayerBottomBar
      player={player}
      handlers={handlers}
      visible={controlsVisible}
      skipIntervals={skipIntervals}
      showNextEpisodeButton={showNextEpisodeButton}
      onNextEpisode={onNextEpisode}
      isTheaterMode={isTheaterMode}
      onTheaterModeToggle={onTheaterModeToggle}
      settingsBtnRef={settingsBtnRef}
      timeDisplayRef={timeDisplayRef}
    />
  )

  const settingsNode = (
    <Suspense fallback={null}>
      <PlayerSettings
        ref={settingsRef}
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        videoSources={videoSources}
        currentSource={selectedSource}
        currentLink={selectedLink}
        onSourceChange={onSourceChange}
        subtitles={state.availableSubtitles}
        activeSubtitleTrack={state.activeSubtitleTrack}
        onSubtitleChange={handlers.handleSubtitleSelection}
        subtitleSettings={{
          fontSize: state.subtitleFontSize,
          position: state.subtitlePosition,
          bgOpacity: state.subtitleBgOpacity,
          bgColor: state.subtitleBgColor,
          textColor: state.subtitleTextColor,
          edge: state.subtitleEdge,
          bold: state.subtitleBold,
        }}
        onSubtitleSettingsChange={(key, value) => {
          const persist = (storageKey: string, v: string | number | boolean) => {
            try {
              localStorage.setItem(storageKey, String(v))
            } catch {
              // ignore
            }
          }
          switch (key) {
            case 'fontSize':
              actions.setSubtitleFontSize(value as number)
              persist('subtitleFontSize', value as number)
              break
            case 'position':
              actions.setSubtitlePosition(value as number)
              persist('subtitlePosition', value as number)
              break
            case 'bgOpacity':
              actions.setSubtitleBgOpacity(value as number)
              persist('subtitleBgOpacity', value as number)
              break
            case 'bgColor':
              actions.setSubtitleBgColor(value as string)
              persist('subtitleBgColor', value as string)
              break
            case 'textColor':
              actions.setSubtitleTextColor(value as string)
              persist('subtitleTextColor', value as string)
              break
            case 'edge':
              actions.setSubtitleEdge(value as 'shadow' | 'outline' | 'none')
              persist('subtitleEdge', value as string)
              break
            case 'bold':
              actions.setSubtitleBold(value as boolean)
              persist('subtitleBold', value as boolean)
              break
          }
        }}
        useNativeControls={state.useNativeControls}
        onNativeControlsToggle={actions.setUseNativeControls}
        anime4kEnabled={anime4kEnabled}
        onAnime4kToggle={onAnime4kToggle}
        anime4kSupported={anime4kSupported}
        anime4kProfile={anime4kProfile}
        onAnime4kProfileChange={onAnime4kProfileChange}
        anime4kInitializing={anime4kInitializing}
        anime4kError={anime4kError}
        videoDelayEnabled={videoDelayEnabled}
        onVideoDelayToggle={onVideoDelayToggle}
        videoDelayMs={videoDelayMs}
        onVideoDelayChange={onVideoDelayChange}
        onCalibrateAvSync={onCalibrateAvSync}
        isAutoSkipEnabled={state.isAutoSkipEnabled}
        onAutoSkipChange={(value) => {
          actions.setIsAutoSkipEnabled(value)
          try {
            localStorage.setItem('autoSkipEnabled', value.toString())
          } catch {
            // ignore
          }
        }}
        isAutoplayEnabled={isAutoplayEnabled}
        onAutoplayChange={onAutoplayChange}
        fallbackChoice={fallbackChoice}
        onFallbackChoiceChange={onFallbackChoiceChange}
        isTheaterMode={isTheaterMode}
        ambientSettings={ambientSettings}
        onAmbientChange={onAmbientChange}
      />
    </Suspense>
  )

  const settingsNodeWithGuard = showSettings ? (
    <div data-speed-boost-ignore="true" onClick={(e) => e.stopPropagation()}>
      {settingsNode}
    </div>
  ) : null

  return (
    <UnifiedVideoShell
      player={player}
      topBar={topBar}
      centerControls={center}
      bottomBar={!loadingVideo && state.duration > 0 ? bottomBar : null}
      settingsPanel={settingsNodeWithGuard}
      overlays={overlays}
      isInteracting={isInteractingExtra}
      className={className}
      chromeDisabled={hideChrome}
    >
      {children}
    </UnifiedVideoShell>
  )
}

export default PlayerControls

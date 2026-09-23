import React, { useEffect, Suspense, lazy } from 'react'
import styles from './PlayerControls.module.css'
import Icon from '../common/Icon'
import CenterControls from './CenterControls'
import SeekBar from './SeekBar'
import UnifiedVideoShell from './UnifiedVideoShell'
import UnifiedVolumeControl from './UnifiedVolumeControl'
import type { VideoSource, VideoLink, SkipInterval } from '../../types/player'
import type useVideoPlayer from '../../hooks/useVideoPlayer'
import type { Anime4KProfile } from '../../hooks/useAnime4K'
import { pickSubtitleIndex, subtitleKey } from '../../lib/subtitles'
import type { FallbackChoice } from '../../lib/fallbackChoice'

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
  children,
  overlays,
  isInteractingExtra = false,
  className,
  hideChrome = false,
}) => {
  const { state, refs, actions } = player
  const { showSettings } = state
  const { setShowSettings, setShowVolumeSlider } = actions

  const settingsRef = React.useRef<HTMLDivElement>(null)
  const settingsBtnRef = React.useRef<HTMLButtonElement>(null)

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

  const timeDisplayRef = React.useRef<HTMLSpanElement>(null)

  const handleVolumeChange = (newVolume: number) => {
    if (!refs.videoRef.current) return
    refs.videoRef.current.volume = newVolume
    refs.videoRef.current.muted = newVolume === 0
    localStorage.setItem('playerVolume', newVolume.toString())
  }

  const handleSeek = (percent: number) => {
    if (!refs.videoRef.current || isNaN(state.duration) || state.duration === 0) return
    refs.videoRef.current.currentTime = percent * state.duration
    actions.sendProgressUpdate(false, true)
  }

  const handleScrubStart = () => {
    if (!refs.videoRef.current) return
    actions.setIsScrubbing(true)
    actions.wasPlayingBeforeScrub.current = !refs.videoRef.current.paused
    refs.videoRef.current.pause()
  }

  const handleScrubMove = (percent: number) => {
    if (!refs.videoRef.current || !state.duration) return
    refs.videoRef.current.currentTime = percent * state.duration
  }

  const handleScrubEnd = () => {
    actions.setIsScrubbing(false)
    if (actions.wasPlayingBeforeScrub.current) {
      refs.videoRef.current?.play()
    }
  }

  const handleSubtitleSelection = (trackId: string | null) => {
    if (!refs.videoRef.current) return
    actions.setActiveSubtitleTrack(trackId)
    try {
      if (trackId === null || trackId === 'off') {
        localStorage.setItem('playerSubtitlesEnabled', 'false')
      } else {
        localStorage.setItem('playerSubtitlesEnabled', 'true')
        const chosen = state.availableSubtitles.find(
          (t) => t.label === trackId || t.lang === trackId
        )
        if (chosen) localStorage.setItem('playerLastSubtitle', subtitleKey(chosen))
        else localStorage.setItem('playerLastSubtitle', trackId)
      }
    } catch {
      // ignore
    }
    let matched = false
    Array.from(refs.videoRef.current.textTracks).forEach((track) => {
      const isMatch =
        trackId !== null &&
        trackId !== 'off' &&
        (track.language === trackId || track.label === trackId)
      const shouldShow = isMatch && !matched
      track.mode = shouldShow ? 'showing' : 'hidden'
      if (shouldShow) matched = true
    })
  }

  const isSubtitleActive = state.activeSubtitleTrack !== null && state.activeSubtitleTrack !== 'off'

  const handleCCToggle = () => {
    if (!refs.videoRef.current) return
    if (isSubtitleActive) {
      handleSubtitleSelection('off')
      return
    }
    if (state.availableSubtitles.length === 0) return
    let lastKey: string | null = null
    try {
      lastKey = localStorage.getItem('playerLastSubtitle')
    } catch {
      // ignore
    }
    const idx = pickSubtitleIndex(state.availableSubtitles, { lastKey, enabled: true })
    if (idx < 0) return
    const trackToActivate = state.availableSubtitles[idx]
    handleSubtitleSelection(trackToActivate.label || trackToActivate.lang)
  }

  const renderVolumeIcon = () => {
    if (state.isMuted || state.volume === 0) return <Icon name="volume-mute" />
    if (state.volume < 0.5) return <Icon name="volume-down" />
    return <Icon name="volume-up" />
  }

  const topBar = (
    <div
      className={`${styles.controlsOverlay} ${!state.showControls && !showSettings && !state.isScrubbing ? styles.hidden : ''} `}
      data-speed-boost-ignore="true"
      style={{ pointerEvents: 'none', background: 'none' }}
    >
      <div className={styles.topControls} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.backBtn}
          onClick={(e) => {
            e.stopPropagation()
            window.history.back()
          }}
          title="Back"
          aria-label="Back"
        >
          <Icon name="chevron-left" />
        </button>
        <div className={styles.videoTitleInfo}>
          <span className={styles.animeTitle}>{animeTitle}</span>
          {episodeNumber && <span className={styles.episodeNumber}>Episode {episodeNumber}</span>}
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
      className={`${styles.controlsOverlay} ${!state.showControls && !showSettings && !state.isScrubbing ? styles.hidden : ''} `}
      data-speed-boost-ignore="true"
      style={{ pointerEvents: 'none', background: 'none', justifyContent: 'flex-end' }}
    >
      <div
        className={styles.bottomControls}
        data-speed-boost-ignore="true"
        onClick={(e) => e.stopPropagation()}
      >
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
          videoRef={refs.videoRef}
          duration={state.duration}
          formatTime={actions.formatTime}
          isScrubbing={state.isScrubbing}
          onSeek={handleSeek}
          onScrubStart={handleScrubStart}
          onScrubMove={handleScrubMove}
          onScrubEnd={handleScrubEnd}
          timeLabelRef={timeDisplayRef}
        >
          {state.duration > 0 && player.state.currentSkipInterval && (
            <div
              className={`${styles.skipSegment} ${styles[player.state.currentSkipInterval.skip_type]} `}
              style={{
                left: `${(player.state.currentSkipInterval.start_time / state.duration) * 100}% `,
                width: `${((player.state.currentSkipInterval.end_time - player.state.currentSkipInterval.start_time) / state.duration) * 100}% `,
              }}
            ></div>
          )}
          {skipIntervals.map((interval) => {
            const startPercent = (interval.start_time / state.duration) * 100
            const widthPercent = ((interval.end_time - interval.start_time) / state.duration) * 100
            return (
              <div
                key={interval.skip_id}
                className={`${styles.skipSegment} ${styles[interval.skip_type]} `}
                style={{ left: `${startPercent}% `, width: `${widthPercent}% ` }}
                title={interval.skip_type.toUpperCase()}
              />
            )
          })}
        </SeekBar>

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
              volumeIcon={renderVolumeIcon()}
              buttonClassName={styles.controlBtn}
              onToggleMute={actions.toggleMute}
              onVolumeChange={handleVolumeChange}
              onExpandedChange={(v) => setShowVolumeSlider(v)}
            />

            <span className={styles.timeDisplay} ref={timeDisplayRef}>
              {actions.formatTime(0)} / {actions.formatTime(state.duration)}
            </span>

            {state.currentSkipInterval && !state.isAutoSkipEnabled && (
              <button
                className={styles.controlBtn}
                onClick={() => {
                  if (refs.videoRef.current && state.currentSkipInterval) {
                    refs.videoRef.current.currentTime = state.currentSkipInterval.end_time
                    actions.setCurrentSkipInterval(null)
                  }
                }}
              >
                Skip {state.currentSkipInterval.skip_type === 'op' ? 'Opening' : 'Ending'}
              </button>
            )}
          </div>

          <div className={styles.rightControls}>
            <div className={styles.skipControls}>
              {showNextEpisodeButton && (
                <button
                  className={styles.nextEpisodeBtn}
                  onClick={onNextEpisode}
                  title="Play next episode"
                >
                  Next EP
                </button>
              )}
            </div>

            <button
              className={`${styles.controlBtn} ${isSubtitleActive ? styles.active : ''}`}
              onClick={handleCCToggle}
              title={isSubtitleActive ? 'Disable Subtitles' : 'Enable Subtitles'}
              aria-label="Toggle Subtitles"
            >
              <Icon name="closed-captioning" size={22} />
            </button>

            <button
              ref={settingsBtnRef}
              className={`${styles.controlBtn} ${showSettings ? styles.active : ''} `}
              onClick={() => setShowSettings(!showSettings)}
              aria-label="Settings"
            >
              <Icon name="cog" />
            </button>

            <button
              className={`${styles.controlBtn} ${styles.theaterBtn} ${isTheaterMode ? styles.active : ''} `}
              onClick={(e) => {
                e.stopPropagation()
                onTheaterModeToggle()
              }}
              title={isTheaterMode ? 'Exit Theater Mode' : 'Theater Mode'}
              aria-label={isTheaterMode ? 'Exit Theater Mode' : 'Theater Mode'}
            >
              <Icon name="tv" />
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
        onSubtitleChange={handleSubtitleSelection}
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
      />
    </Suspense>
  )

  return (
    <UnifiedVideoShell
      player={player}
      topBar={topBar}
      centerControls={center}
      bottomBar={bottomBar}
      settingsPanel={settingsNode}
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

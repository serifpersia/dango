import React, { useEffect, Suspense, lazy } from 'react'
import styles from './PlayerControls.module.css'
import {
  FaPlay,
  FaPause,
  FaVolumeUp,
  FaVolumeMute,
  FaVolumeDown,
  FaVolumeOff,
  FaExpand,
  FaCompress,
  FaCog,
  FaTv,
  FaChevronLeft,
  FaClosedCaptioning,
} from 'react-icons/fa'
import CenterControls from './CenterControls'
import type { VideoSource, VideoLink, SkipInterval } from '../../types/player'
import type useVideoPlayer from '../../hooks/useVideoPlayer'
import type { Anime4KProfile } from '../../hooks/useAnime4K'
import { pickSubtitleIndex, subtitleKey } from '../../lib/subtitles'

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
}) => {
  const { state, refs, actions } = player
  const { showSettings, showVolumeSlider } = state
  const { setShowSettings, setShowVolumeSlider } = actions

  const settingsRef = React.useRef<HTMLDivElement>(null)
  const settingsBtnRef = React.useRef<HTMLButtonElement>(null)
  const volumeRef = React.useRef<HTMLDivElement>(null)

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

      if (
        volumeRef.current &&
        !volumeRef.current.contains(event.target as Node) &&
        showVolumeSlider
      ) {
        setShowVolumeSlider(false)
      }
    }

    if (showSettings || showVolumeSlider) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showSettings, showVolumeSlider, setShowSettings, setShowVolumeSlider])

  const watchedBarRef = React.useRef<HTMLDivElement>(null)
  const thumbRef = React.useRef<HTMLDivElement>(null)
  const bufferedBarRef = React.useRef<HTMLDivElement>(null)
  const timeDisplayRef = React.useRef<HTMLSpanElement>(null)

  const currentTimeRef = React.useRef(0)

  useEffect(() => {
    const video = refs.videoRef.current
    if (!video) return

    const handleTimeUpdate = () => {
      if (!state.isScrubbing) {
        const time = video.currentTime
        currentTimeRef.current = time
        const percent = (time / state.duration) * 100 || 0
        if (watchedBarRef.current) watchedBarRef.current.style.width = `${percent}%`
        if (thumbRef.current) thumbRef.current.style.left = `${percent}%`
        if (timeDisplayRef.current) {
          timeDisplayRef.current.innerText = `${actions.formatTime(time)} / ${actions.formatTime(state.duration)}`
        }
      }
    }

    const handleProgress = () => {
      if (video.buffered.length > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1)
        const percent = (bufferedEnd / state.duration) * 100 || 0
        if (bufferedBarRef.current) bufferedBarRef.current.style.width = `${percent}%`
      }
    }

    handleTimeUpdate()
    handleProgress()

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('progress', handleProgress)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('progress', handleProgress)
    }
  }, [refs.videoRef, state.isScrubbing, state.duration, actions])

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!refs.videoRef.current) return
    const newVolume = parseFloat(e.target.value)
    refs.videoRef.current.volume = newVolume
    refs.videoRef.current.muted = newVolume === 0
    localStorage.setItem('playerVolume', newVolume.toString())
  }

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      !refs.videoRef.current ||
      !refs.progressBarRef.current ||
      isNaN(state.duration) ||
      state.duration === 0
    )
      return
    const rect = refs.progressBarRef.current.getBoundingClientRect()
    const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    refs.videoRef.current.currentTime = percent * state.duration
    actions.sendProgressUpdate(false, true)
  }

  const handleProgressBarMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!refs.progressBarRef.current || !state.duration) return
    const rect = refs.progressBarRef.current.getBoundingClientRect()
    const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const time = percent * state.duration
    actions.setHoverTime({ time, position: e.clientX - rect.left })
  }

  const handleThumbMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!refs.videoRef.current) return
    actions.setIsScrubbing(true)
    actions.wasPlayingBeforeScrub.current = !refs.videoRef.current.paused
    refs.videoRef.current.pause()
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
    if (state.isMuted) return <FaVolumeMute />
    if (state.volume === 0) return <FaVolumeOff />
    if (state.volume < 0.5) return <FaVolumeDown />
    return <FaVolumeUp />
  }

  useEffect(() => {
    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (
        !state.isScrubbing ||
        !refs.videoRef.current ||
        !refs.progressBarRef.current ||
        !state.duration
      )
        return
      const rect = refs.progressBarRef.current.getBoundingClientRect()
      const percent = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
      const scrubTime = percent * state.duration
      refs.videoRef.current.currentTime = scrubTime
      const percent100 = (scrubTime / state.duration) * 100 || 0
      if (watchedBarRef.current) watchedBarRef.current.style.width = `${percent100}%`
      if (thumbRef.current) thumbRef.current.style.left = `${percent100}%`
      if (timeDisplayRef.current) {
        timeDisplayRef.current.innerText = `${actions.formatTime(scrubTime)} / ${actions.formatTime(state.duration)}`
      }
      actions.setHoverTime({ time: scrubTime, position: e.clientX - rect.left })
    }
    const handleDocumentMouseUp = () => {
      if (state.isScrubbing) {
        actions.setIsScrubbing(false)
        actions.setHoverTime({ time: 0, position: null })
        if (actions.wasPlayingBeforeScrub.current) {
          refs.videoRef.current?.play()
        }
      }
    }
    document.addEventListener('mousemove', handleDocumentMouseMove)
    document.addEventListener('mouseup', handleDocumentMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove)
      document.removeEventListener('mouseup', handleDocumentMouseUp)
    }
  }, [state.isScrubbing, state.duration, refs.videoRef, refs.progressBarRef, actions])

  return (
    <div
      className={`${styles.controlsOverlay} ${!state.showControls && !showSettings && !showVolumeSlider && !state.isScrubbing ? styles.hidden : ''} `}
      data-speed-boost-ignore="true"
      onDoubleClick={(e) => e.stopPropagation()}
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
          <FaChevronLeft />
        </button>
        <div className={styles.videoTitleInfo}>
          <span className={styles.animeTitle}>{animeTitle}</span>
          {episodeNumber && <span className={styles.episodeNumber}>Episode {episodeNumber}</span>}
        </div>
      </div>

      <CenterControls
        isPlaying={state.isPlaying}
        onTogglePlay={actions.togglePlay}
        onSkipBack={() => actions.seek(-10)}
        onSkipForward={() => actions.seek(10)}
      />

      <div
        className={styles.bottomControls}
        data-speed-boost-ignore="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`${styles.progressBarContainer} ${state.isScrubbing ? styles.scrubbing : ''} `}
          ref={refs.progressBarRef}
          onClick={handleProgressBarClick}
          onMouseMove={handleProgressBarMouseMove}
          onMouseLeave={() => {
            if (!state.isScrubbing) actions.setHoverTime({ time: 0, position: null })
          }}
        >
          {state.hoverTime.position !== null && (
            <div className={styles.timeBubble} style={{ left: state.hoverTime.position }}>
              {actions.formatTime(state.hoverTime.time)}
            </div>
          )}
          <div className={styles.progressBar}>
            {state.duration > 0 && player.state.currentSkipInterval && (
              <div
                className={`${styles.skipSegment} ${styles[player.state.currentSkipInterval.skip_type]} `}
                style={{
                  left: `${(player.state.currentSkipInterval.start_time / state.duration) * 100}% `,
                  width: `${((player.state.currentSkipInterval.end_time - player.state.currentSkipInterval.start_time) / state.duration) * 100}% `,
                }}
              ></div>
            )}
            <div className={styles.bufferedBar} ref={bufferedBarRef}></div>
            <div className={styles.watchedBar} ref={watchedBarRef}></div>
            <div className={styles.thumb} ref={thumbRef} onMouseDown={handleThumbMouseDown}></div>

            {skipIntervals.map((interval) => {
              const startPercent = (interval.start_time / state.duration) * 100
              const widthPercent =
                ((interval.end_time - interval.start_time) / state.duration) * 100
              return (
                <div
                  key={interval.skip_id}
                  className={`${styles.skipSegment} ${styles[interval.skip_type]} `}
                  style={{ left: `${startPercent}% `, width: `${widthPercent}% ` }}
                  title={interval.skip_type.toUpperCase()}
                />
              )
            })}
          </div>
        </div>

        <div className={styles.bottomControlsRow}>
          <div className={styles.leftControls}>
            <button
              className={styles.controlBtn}
              onClick={actions.togglePlay}
              aria-label={state.isPlaying ? 'Pause' : 'Play'}
            >
              {state.isPlaying ? <FaPause /> : <FaPlay />}
            </button>

            <div
              className={`${styles.volumeContainer} ${showVolumeSlider ? styles.visible : ''}`}
              ref={volumeRef}
            >
              <button
                className={styles.controlBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.innerWidth <= 768) {
                    setShowVolumeSlider(!showVolumeSlider)
                  } else {
                    actions.toggleMute()
                  }
                }}
                aria-label={state.isMuted ? 'Unmute' : 'Mute'}
              >
                {renderVolumeIcon()}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={state.isMuted ? 0 : state.volume}
                onChange={handleVolumeChange}
                className={styles.volumeSlider}
                style={
                  {
                    '--volume-percent': `${(state.isMuted ? 0 : state.volume) * 100}% `,
                  } as React.CSSProperties
                }
              />
            </div>

            <span className={styles.timeDisplay} ref={timeDisplayRef}>
              {actions.formatTime(currentTimeRef.current)} / {actions.formatTime(state.duration)}
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
              <FaClosedCaptioning size={22} />
            </button>

            <button
              ref={settingsBtnRef}
              className={`${styles.controlBtn} ${showSettings ? styles.active : ''} `}
              onClick={() => setShowSettings(!showSettings)}
              aria-label="Settings"
            >
              <FaCog />
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
              <FaTv />
            </button>

            <button
              className={styles.controlBtn}
              onClick={actions.toggleFullscreen}
              aria-label={state.isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {state.isFullscreen ? <FaCompress /> : <FaExpand />}
            </button>
          </div>
        </div>
      </div>

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
        />
      </Suspense>
    </div>
  )
}

export default PlayerControls

import React, { useEffect, useState, Suspense, lazy } from 'react'
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
  FaForward,
  FaClosedCaptioning,
} from 'react-icons/fa'
import { MdReplay10, MdForward10, MdFastForward, MdSkipNext } from 'react-icons/md'
import type { VideoSource, VideoLink, SkipInterval } from '../../types/player'
import type useVideoPlayer from '../../hooks/useVideoPlayer'

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
    Array.from(refs.videoRef.current.textTracks).forEach((track) => {
      track.mode =
        trackId !== null &&
        trackId !== 'off' &&
        (track.language === trackId || track.label === trackId)
          ? 'showing'
          : 'hidden'
    })
  }

  const isSubtitleActive = state.activeSubtitleTrack !== null && state.activeSubtitleTrack !== 'off'

  const handleCCToggle = () => {
    if (!refs.videoRef.current) return
    if (isSubtitleActive) {
      handleSubtitleSelection('off')
      localStorage.setItem('playerSubtitlesEnabled', 'false')
      return
    }
    if (state.availableSubtitles.length === 0) return
    const englishTrack = state.availableSubtitles.find(
      (t) => t.lang === 'en' || t.label === 'English'
    )
    const trackToActivate = englishTrack || state.availableSubtitles[0]
    handleSubtitleSelection(trackToActivate.label || trackToActivate.lang)
    localStorage.setItem('playerSubtitlesEnabled', 'true')
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
      {/* Netflix Style Top Bar Overlay */}
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

      <div className={styles.centerControls} onClick={(e) => e.stopPropagation()}>
        <button
          className={styles.centerSkipBtn}
          onClick={() => actions.seek(-10)}
          title="Skip back 10s"
          aria-label="Skip back 10 seconds"
        >
          <MdReplay10 />
        </button>
        <button
          className={styles.centerPlayPause}
          data-speed-boost-ignore="true"
          onClick={actions.togglePlay}
          aria-label={state.isPlaying ? 'Pause' : 'Play'}
        >
          {state.isPlaying ? <FaPause /> : <FaPlay className={styles.playIconOffset} />}
        </button>
        <button
          className={styles.centerSkipBtn}
          onClick={() => actions.seek(10)}
          title="Skip forward 10s"
          aria-label="Skip forward 10 seconds"
        >
          <MdForward10 />
        </button>
      </div>

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
          onMouseLeave={() => actions.setHoverTime({ time: 0, position: null })}
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
              className={`${styles.controlBtn} ${state.isAutoSkipEnabled ? styles.active : ''}`}
              onClick={() => {
                const newValue = !state.isAutoSkipEnabled
                actions.setIsAutoSkipEnabled(newValue)
                localStorage.setItem('autoSkipEnabled', newValue.toString())
              }}
              title={state.isAutoSkipEnabled ? 'Disable Auto Skip' : 'Enable Auto Skip'}
              aria-label="Auto Skip"
            >
              <MdFastForward size={22} />
            </button>

            <button
              className={`${styles.controlBtn} ${isAutoplayEnabled ? styles.active : ''}`}
              onClick={() => onAutoplayChange(!isAutoplayEnabled)}
              title={isAutoplayEnabled ? 'Disable Autoplay' : 'Enable Autoplay'}
              aria-label="Autoplay"
            >
              <MdSkipNext size={24} />
            </button>

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
              className={`${styles.controlBtn} ${isTheaterMode ? styles.active : ''} `}
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
          }}
          onSubtitleSettingsChange={(key, value) => {
            if (key === 'fontSize') {
              actions.setSubtitleFontSize(value)
              localStorage.setItem('subtitleFontSize', value.toString())
            } else {
              actions.setSubtitlePosition(value)
              localStorage.setItem('subtitlePosition', value.toString())
            }
          }}
          useNativeControls={state.useNativeControls}
          onNativeControlsToggle={actions.setUseNativeControls}
        />
      </Suspense>
    </div>
  )
}

export default PlayerControls

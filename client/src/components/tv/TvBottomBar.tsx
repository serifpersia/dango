import React from 'react'
import Icon from '../common/Icon'
import styles from './TvPlayerControls.module.css'
import SeekBar from '../player/SeekBar'
import UnifiedVolumeControl from '../player/UnifiedVolumeControl'
import { formatTime } from '../../lib/utils'
import { pickSubtitleIndex } from '../../lib/subtitles'
import type useVideoPlayer from '../../hooks/useVideoPlayer'

interface TvBottomBarProps {
  player: ReturnType<typeof useVideoPlayer>
  visible: boolean
  settingsOpen: boolean
  onOpenSettings: () => void
  onCloseSettings: () => void
  hasSubtitles: boolean
  isSubtitleActive: boolean
  subtitles: { language: string; label: string; url: string }[]
  onSubtitleChange: (index: number) => void
  showNextEpisodeButton: boolean
  onNextEpisode?: () => void
  isTheaterMode: boolean
  onTheaterModeToggle: () => void
  timeLabelRef: React.RefObject<HTMLSpanElement | null>
}

const TvBottomBar: React.FC<TvBottomBarProps> = ({
  player,
  visible,
  settingsOpen,
  onOpenSettings,
  onCloseSettings,
  hasSubtitles,
  isSubtitleActive,
  subtitles,
  onSubtitleChange,
  showNextEpisodeButton,
  onNextEpisode,
  isTheaterMode,
  onTheaterModeToggle,
  timeLabelRef,
}) => {
  const { state, refs, actions } = player
  const videoRef = refs.videoRef

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

  const volumeIcon = state.isMuted ? (
    <Icon name="volume-mute" />
  ) : state.volume < 0.5 ? (
    <Icon name="volume-down" />
  ) : (
    <Icon name="volume-up" />
  )

  return (
    <div
      className={`${styles.controlsOverlay} ${!visible ? styles.hidden : ''}`}
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
              onToggleMute={actions.toggleMute}
              onVolumeChange={handleVolumeChange}
              onExpandedChange={(v) => actions.setShowVolumeSlider(v)}
            />
            <span className={styles.timeDisplay} ref={timeLabelRef}>
              {formatTime(0)} / {formatTime(state.duration)}
            </span>
          </div>

          <div className={styles.rightControls}>
            {showNextEpisodeButton && (
              <button
                className={styles.nextEpisodeBtn}
                onClick={onNextEpisode}
                title="Play next episode"
              >
                Next EP
              </button>
            )}
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
              className={`${styles.controlBtn} ${settingsOpen ? styles.active : ''}`}
              onClick={() => (settingsOpen ? onCloseSettings() : onOpenSettings())}
              aria-label="Settings"
            >
              <Icon name="cog" />
            </button>
            <button
              className={`${styles.controlBtn} ${isTheaterMode ? styles.active : ''}`}
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
}

export default TvBottomBar

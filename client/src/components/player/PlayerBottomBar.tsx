import React from 'react'
import styles from './PlayerControls.module.css'
import Icon from '../common/Icon'
import SeekBar from './SeekBar'
import UnifiedVolumeControl from './UnifiedVolumeControl'
import type { SkipInterval } from '../../types/player'
import type useVideoPlayer from '../../hooks/useVideoPlayer'
import type { useControlHandlers } from '../../hooks/useControlHandlers'

interface PlayerBottomBarProps {
  player: ReturnType<typeof useVideoPlayer>
  handlers: ReturnType<typeof useControlHandlers>
  visible: boolean
  skipIntervals: SkipInterval[]
  showNextEpisodeButton: boolean
  onNextEpisode: () => void
  isTheaterMode: boolean
  onTheaterModeToggle: () => void
  settingsBtnRef: React.RefObject<HTMLButtonElement | null>
  timeDisplayRef: React.RefObject<HTMLSpanElement | null>
}

const PlayerBottomBar: React.FC<PlayerBottomBarProps> = ({
  player,
  handlers,
  visible,
  skipIntervals,
  showNextEpisodeButton,
  onNextEpisode,
  isTheaterMode,
  onTheaterModeToggle,
  settingsBtnRef,
  timeDisplayRef,
}) => {
  const { state, refs, actions } = player
  const { showSettings } = state

  const renderVolumeIcon = () => {
    if (state.isMuted || state.volume === 0) return <Icon name="volume-mute" />
    if (state.volume < 0.5) return <Icon name="volume-down" />
    return <Icon name="volume-up" />
  }

  return (
    <div
      className={`${styles.controlsOverlay} ${!visible ? styles.hidden : ''} `}
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
          onSeek={handlers.handleSeek}
          onScrubStart={handlers.handleScrubStart}
          onScrubMove={handlers.handleScrubMove}
          onScrubEnd={handlers.handleScrubEnd}
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
              onVolumeChange={handlers.handleVolumeChange}
              onExpandedChange={(v) => actions.setShowVolumeSlider(v)}
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
              className={`${styles.controlBtn} ${handlers.isSubtitleActive ? styles.active : ''}`}
              onClick={handlers.handleCCToggle}
              title={handlers.isSubtitleActive ? 'Disable Subtitles' : 'Enable Subtitles'}
              aria-label="Toggle Subtitles"
            >
              <Icon name="closed-captioning" size={22} />
            </button>

            <button
              ref={settingsBtnRef}
              className={`${styles.controlBtn} ${showSettings ? styles.active : ''} `}
              onClick={() => actions.setShowSettings(!showSettings)}
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
}

export default PlayerBottomBar

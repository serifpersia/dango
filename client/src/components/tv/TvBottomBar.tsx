import React from 'react'
import Icon from '../common/Icon'
import styles from './TvPlayerControls.module.css'
import {
  PlayerTimeline,
  PlayPauseButton,
  PlayerVolume,
  FullscreenButton,
} from '../player/PlaybackControls'
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
  timeLabelRef: React.RefObject<HTMLSpanElement>
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
  const { state, actions } = player
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

  return (
    <div
      className={`${styles.controlsOverlay} ${!visible ? styles.hidden : ''}`}
      data-speed-boost-ignore="true"
      style={{ pointerEvents: 'none', background: 'none', justifyContent: 'flex-end' }}
    >
      <div className={styles.bottomControls} onClick={(e) => e.stopPropagation()}>
        <PlayerTimeline
          classes={{
            container: styles.progressBarContainer,
            scrubbing: styles.scrubbing,
            timeBubble: styles.timeBubble,
            bar: styles.progressBar,
            buffered: styles.bufferedBar,
            watched: styles.watchedBar,
            thumb: styles.thumb,
          }}
          timeLabelRef={timeLabelRef}
        />

        <div className={styles.bottomControlsRow}>
          <div className={styles.leftControls}>
            <PlayPauseButton className={styles.controlBtn} />
            <PlayerVolume
              buttonClassName={styles.controlBtn}
              onExpandedChange={actions.setShowVolumeSlider}
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
            <FullscreenButton className={styles.controlBtn} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default TvBottomBar

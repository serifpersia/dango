import React from 'react'
import Icon from '../common/Icon'

import styles from './CenterControls.module.css'

interface CenterControlsProps {
  isPlaying: boolean
  onTogglePlay: () => void
  onSkipBack: () => void
  onSkipForward: () => void
  skipSeconds?: number
}

const CenterControls: React.FC<CenterControlsProps> = ({
  isPlaying,
  onTogglePlay,
  onSkipBack,
  onSkipForward,
  skipSeconds = 10,
}) => {
  return (
    <div className={styles.centerControls} onClick={(e) => e.stopPropagation()}>
      <button
        className={styles.centerSkipBtn}
        onClick={onSkipBack}
        title={`Skip back ${skipSeconds}s`}
        aria-label={`Skip back ${skipSeconds} seconds`}
      >
        <Icon name="replay-10" />
      </button>
      <button
        className={styles.centerPlayPause}
        data-speed-boost-ignore="true"
        onClick={onTogglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <Icon name="pause" /> : <Icon name="play" className={styles.playIconOffset} />}
      </button>
      <button
        className={styles.centerSkipBtn}
        onClick={onSkipForward}
        title={`Skip forward ${skipSeconds}s`}
        aria-label={`Skip forward ${skipSeconds} seconds`}
      >
        <Icon name="forward-10" />
      </button>
    </div>
  )
}

export default CenterControls
